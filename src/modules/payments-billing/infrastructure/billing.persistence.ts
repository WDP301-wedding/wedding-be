import { randomUUID } from 'node:crypto';

import { createBookingBoundaryUnitOfWork } from '../../../core/database/booking-unit-of-work.js';
import { AppError, NotFoundError } from '../../../core/errors/app-error.js';
import {
  Prisma,
  type PrismaClient,
  type BillingLedgerEntry as StoredEntry,
  type BillingPaymentAttempt as StoredAttempt,
} from '../../../generated/prisma/client.js';
import {
  ledgerFactSchema,
  newPaymentAttemptSchema,
  issueInvoiceSchema,
  invoiceSnapshotSchema,
  type BillingLedgerRepository,
  type LedgerEntry,
  type LedgerSnapshot,
  type NewLedgerFact,
  type PaymentAttempt,
  type InvoiceRecord,
} from '../application/billing-ledger.port.js';
import type { ContractContext } from '../application/payments-billing.providers.js';
import { createContractFinancialReader } from '../../booking-lifecycle/infrastructure/contract-financial.reader.js';
import { createEffectiveCommercialReader } from '../../booking-lifecycle/infrastructure/effective-commercial.reader.js';
import {
  calculateBillingTotals,
  transitionPaymentAttempt,
  validateRefund,
} from '../domain/billing-policy.js';

export class BillingPersistenceConflict extends AppError {
  constructor(code: string) {
    super({
      status: 409,
      code,
      message: 'The billing command conflicts with its persisted evidence.',
    });
  }
}

type Scope = ReturnType<typeof createBookingBoundaryUnitOfWork>;
type Transaction = Prisma.TransactionClient;

export function createPrismaBillingPersistence(
  prisma: PrismaClient,
  scope: Scope = createBookingBoundaryUnitOfWork(prisma),
) {
  async function transact<T>(
    bookingId: string,
    context: ContractContext | undefined,
    work: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    return scope.withClient(bookingId, context, async (client) => {
      // Retry only standalone transactions. An enlisted owner must let the outer
      // boundary roll back and retry all participants together.
      const attempts = context?.transactionScopeId === undefined ? 3 : 1;
      for (let attempt = 1; ; attempt++) {
        try {
          return await client.$transaction(
            async (tx) => {
              await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${bookingId}))`;
              return work(tx);
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
          );
        } catch (error) {
          if (
            !(error instanceof Prisma.PrismaClientKnownRequestError) ||
            !['P2034', 'P2002'].includes(error.code) ||
            attempt >= attempts
          )
            throw error;
        }
      }
    });
  }

  const repository: BillingLedgerRepository = Object.freeze({
    isDepositApplied(bookingId: string, paymentId: string, context: ContractContext) {
      return transact(bookingId, context, async (tx) => {
        const entry = await tx.billingLedgerEntry.findUnique({ where: { id: paymentId } });
        if (entry === null || entry.bookingId !== bookingId || entry.kind !== 'PAYMENT')
          throw new NotFoundError();
        return (await tx.billingDepositApplication.findUnique({ where: { paymentId } })) !== null;
      });
    },
    async markDepositApplied(
      bookingId: string,
      paymentId: string,
      appliedAt: string,
      context: ContractContext,
    ) {
      if (context.transactionScopeId === undefined)
        throw new BillingPersistenceConflict('INVALID_TRANSACTION_SCOPE');
      return transact(bookingId, context, async (tx) => {
        const entry = await tx.billingLedgerEntry.findUnique({ where: { id: paymentId } });
        if (entry === null || entry.bookingId !== bookingId || entry.kind !== 'PAYMENT')
          throw new BillingPersistenceConflict('PAYMENT_EVIDENCE_CONFLICT');
        if ((await tx.billingDepositApplication.findUnique({ where: { paymentId } })) !== null)
          return;
        await tx.billingDepositApplication.create({
          data: { paymentId, appliedAt: new Date(appliedAt) },
        });
        await audit(tx, context, bookingId, paymentId, 'billing.deposit-applied', {});
      });
    },
    findAttemptByCommand(bookingId: string, commandId: string, context: ContractContext) {
      return transact(bookingId, context, async (tx) => {
        const stored = await tx.billingPaymentAttempt.findUnique({ where: { commandId } });
        if (stored !== null && stored.bookingId !== bookingId)
          throw new BillingPersistenceConflict('PAYMENT_EVIDENCE_CONFLICT');
        return stored === null ? null : toAttempt(stored);
      });
    },
    getAttempt(bookingId: string, paymentAttemptId: string, context?: ContractContext) {
      return transact(bookingId, context, async (tx) => {
        const stored = await tx.billingPaymentAttempt.findUnique({
          where: { id: paymentAttemptId },
        });
        if (stored === null || stored.bookingId !== bookingId) throw new NotFoundError();
        return toAttempt(stored);
      });
    },
    getLedger(bookingId: string, context?: ContractContext) {
      return transact(bookingId, context, (tx) => readLedger(tx, bookingId));
    },

    append(input: NewLedgerFact, context: ContractContext) {
      const fact = normalizeFact(ledgerFactSchema.parse(input));
      return transact(fact.bookingId, context, async (tx) => {
        const existing = await tx.billingLedgerEntry.findUnique({
          where: {
            sourceType_sourceRevisionId: {
              sourceType: fact.sourceType,
              sourceRevisionId: fact.sourceRevisionId,
            },
          },
        });
        if (existing !== null) {
          const entry = toEntry(existing);
          if (!sameFact(entry, fact)) throw new BillingPersistenceConflict(sourceConflict(fact));
          return Object.freeze({ entry, replayed: true });
        }
        if ((await tx.billingLedgerEntry.findUnique({ where: { id: fact.id } })) !== null)
          throw new BillingPersistenceConflict(sourceConflict(fact));
        await validateSource(tx, fact);
        const previous = await readLedger(tx, fact.bookingId);
        totalsFrom([...previous.entries, { ...fact, revision: previous.revision + 1 }]);
        const stored = await tx.billingLedgerEntry.create({
          data: { ...fact, occurredAt: new Date(fact.occurredAt), revision: 0 },
        });
        const entry = toEntry(stored);
        await audit(
          tx,
          context,
          fact.bookingId,
          entry.id,
          `billing.${fact.kind.toLowerCase()}-recorded`,
          {
            billingRevision: entry.revision,
            amountVnd: entry.amountVnd,
            sourceRevisionId: entry.sourceRevisionId,
          },
        );
        await appendOutbox(tx, entry, context);
        return Object.freeze({ entry, replayed: false });
      });
    },

    createAttempt(
      input: Parameters<BillingLedgerRepository['createAttempt']>[0],
      context: ContractContext,
    ) {
      const parsed = newPaymentAttemptSchema.parse(input);
      const snapshot = {
        ...parsed,
        contractRevisionId: parsed.contractRevisionId ?? null,
        documentDigest: parsed.documentDigest ?? null,
        createdAt: new Date(parsed.createdAt).toISOString(),
        expiresAt: new Date(parsed.expiresAt).toISOString(),
      };
      return transact(snapshot.bookingId, context, async (tx) => {
        const existing = await tx.billingPaymentAttempt.findUnique({
          where: { commandId: snapshot.commandId },
        });
        if (existing !== null) {
          const attempt = toAttempt(existing);
          if (
            !(Object.keys(snapshot) as (keyof typeof snapshot)[]).every(
              (key) => key === 'id' || attempt[key] === snapshot[key],
            )
          )
            throw new BillingPersistenceConflict('PAYMENT_EVIDENCE_CONFLICT');
          return Object.freeze({ attempt, replayed: true });
        }
        if (
          (await tx.billingPaymentAttempt.findFirst({
            where: {
              bookingId: snapshot.bookingId,
              purpose: snapshot.purpose,
              state: { in: ['CREATED', 'PENDING', 'UNKNOWN'] },
            },
          })) !== null
        )
          throw new BillingPersistenceConflict('PAYMENT_ATTEMPT_ACTIVE');
        const stored = await tx.billingPaymentAttempt.create({
          data: {
            ...snapshot,
            createdAt: new Date(snapshot.createdAt),
            expiresAt: new Date(snapshot.expiresAt),
          },
        });
        await audit(tx, context, snapshot.bookingId, stored.id, 'billing.attempt-created', {
          purpose: snapshot.purpose,
          amountVnd: snapshot.amountVnd,
        });
        return Object.freeze({ attempt: toAttempt(stored), replayed: false });
      });
    },

    transitionAttempt(
      input: Parameters<BillingLedgerRepository['transitionAttempt']>[0],
      context: ContractContext,
    ) {
      return transact(input.bookingId, context, async (tx) => {
        const stored = await tx.billingPaymentAttempt.findUnique({
          where: { id: input.paymentAttemptId },
        });
        if (stored === null || stored.bookingId !== input.bookingId) throw new NotFoundError();
        const state = transitionPaymentAttempt(stored.state, input.evidence);
        const terminal = state === 'SUCCEEDED' || state === 'FAILED';
        if (
          (terminal && input.providerEvidenceId === null) ||
          (!terminal && input.providerEvidenceId !== null)
        )
          throw new BillingPersistenceConflict('PAYMENT_EVIDENCE_CONFLICT');
        if (state === stored.state) {
          if (terminal && stored.terminalEvidenceId !== input.providerEvidenceId)
            throw new BillingPersistenceConflict('PAYMENT_EVIDENCE_CONFLICT');
          return toAttempt(stored);
        }
        const updated = await tx.billingPaymentAttempt.update({
          where: { id: stored.id },
          data: { state, terminalEvidenceId: input.providerEvidenceId },
        });
        await audit(tx, context, input.bookingId, stored.id, 'billing.attempt-transitioned', {
          state,
          providerEvidenceId: input.providerEvidenceId,
        });
        return toAttempt(updated);
      });
    },

    issueInvoice(
      input: Parameters<BillingLedgerRepository['issueInvoice']>[0],
      context: ContractContext,
    ) {
      const parsed = issueInvoiceSchema.parse(input);
      return transact(parsed.bookingId, context, async (tx) => {
        const existing = await tx.billingInvoice.findUnique({ where: { id: parsed.id } });
        if (existing !== null) {
          if (
            existing.bookingId !== parsed.bookingId ||
            existing.invoiceNumber !== parsed.invoiceNumber ||
            existing.sourceBillingRevision !== parsed.expectedBillingRevision ||
            existing.issuedAt.toISOString() !== new Date(parsed.issuedAt).toISOString()
          )
            throw new BillingPersistenceConflict('INVOICE_EVIDENCE_CONFLICT');
          return Object.freeze({
            id: existing.id,
            bookingId: existing.bookingId,
            invoiceNumber: existing.invoiceNumber,
            sourceBillingRevision: existing.sourceBillingRevision,
            issuedAt: existing.issuedAt.toISOString(),
            snapshot: invoiceSnapshotSchema.parse(existing.snapshot),
          });
        }
        const snapshot = await readLedger(tx, parsed.bookingId);
        if (snapshot.revision !== parsed.expectedBillingRevision)
          throw new BillingPersistenceConflict('STALE_BILLING_REVISION');
        if (
          (await tx.billingInvoice.findUnique({
            where: { invoiceNumber: parsed.invoiceNumber },
          })) !== null
        )
          throw new BillingPersistenceConflict('INVOICE_EVIDENCE_CONFLICT');
        await tx.billingInvoice.create({
          data: {
            id: parsed.id,
            bookingId: parsed.bookingId,
            invoiceNumber: parsed.invoiceNumber,
            sourceBillingRevision: snapshot.revision,
            issuedAt: new Date(parsed.issuedAt),
            snapshot: {
              revision: snapshot.revision,
              entries: snapshot.entries.map((entry) => ({ ...entry })),
              totals: { ...snapshot.totals },
            },
          },
        });
        await audit(tx, context, parsed.bookingId, parsed.id, 'billing.invoice-issued', {
          billingRevision: snapshot.revision,
        });
        const invoice: InvoiceRecord = Object.freeze({
          id: parsed.id,
          bookingId: parsed.bookingId,
          invoiceNumber: parsed.invoiceNumber,
          sourceBillingRevision: snapshot.revision,
          issuedAt: new Date(parsed.issuedAt).toISOString(),
          snapshot,
        });
        return invoice;
      });
    },
  });
  return Object.freeze({ repository, boundary: scope.boundary });
}

function normalizeFact(fact: NewLedgerFact): NewLedgerFact {
  return Object.freeze({ ...fact, occurredAt: new Date(fact.occurredAt).toISOString() });
}

function toEntry(row: StoredEntry): LedgerEntry {
  return Object.freeze({
    id: row.id,
    bookingId: row.bookingId,
    kind: row.kind,
    sourceType: row.sourceType,
    sourceRevisionId: row.sourceRevisionId,
    amountVnd: safeNumber(row.amountVnd),
    occurredAt: row.occurredAt.toISOString(),
    sourceEntryId: row.sourceEntryId,
    paymentAttemptId: row.paymentAttemptId,
    decisionId: row.decisionId,
    approvedRefundableVnd:
      row.approvedRefundableVnd === null ? null : safeNumber(row.approvedRefundableVnd),
    reason: row.reason,
    evidenceReference: row.evidenceReference,
    revision: row.revision,
  });
}

function toAttempt(row: StoredAttempt): PaymentAttempt {
  return Object.freeze({
    id: row.id,
    bookingId: row.bookingId,
    commandId: row.commandId,
    purpose: row.purpose,
    provider: row.provider,
    amountVnd: safeNumber(row.amountVnd),
    timelineRevisionId: row.timelineRevisionId,
    contractRevisionId: row.contractRevisionId,
    documentDigest: row.documentDigest,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    state: row.state,
    terminalEvidenceId: row.terminalEvidenceId,
  });
}

function safeNumber(value: Prisma.Decimal): number {
  const amount = value.toNumber();
  if (!Number.isSafeInteger(amount) || amount <= 0)
    throw new BillingPersistenceConflict('BILLING_LEDGER_INCONSISTENT');
  return amount;
}

function sameFact(stored: LedgerEntry, requested: NewLedgerFact): boolean {
  return (Object.keys(requested) as (keyof NewLedgerFact)[]).every(
    (key) => key === 'id' || stored[key] === requested[key],
  );
}

function sourceConflict(fact: NewLedgerFact): string {
  if (fact.kind === 'CHARGE') return 'RECEIVABLE_SOURCE_CONFLICT';
  if (fact.kind === 'CREDIT_ADJUSTMENT') return 'RECEIVABLE_ADJUSTMENT_CONFLICT';
  return 'PAYMENT_EVIDENCE_CONFLICT';
}

async function readLedger(tx: Transaction, bookingId: string): Promise<LedgerSnapshot> {
  const rows = await tx.billingLedgerEntry.findMany({
    where: { bookingId },
    orderBy: { revision: 'asc' },
  });
  const entries = Object.freeze(rows.map(toEntry));
  return Object.freeze({
    revision: entries.at(-1)?.revision ?? 0,
    entries,
    totals: totalsFrom(entries),
  });
}

function totalsFrom(entries: readonly LedgerEntry[]) {
  const amounts = (kind: LedgerEntry['kind'], sourceType?: LedgerEntry['sourceType']) =>
    entries
      .filter(
        (entry) =>
          entry.kind === kind && (sourceType === undefined || entry.sourceType === sourceType),
      )
      .map((entry) => entry.amountVnd);
  return calculateBillingTotals({
    baseChargesVnd: entries
      .filter((e) => e.kind === 'CHARGE' && e.sourceType !== 'PRINT_ORDER')
      .map((e) => e.amountVnd),
    printChargesVnd: amounts('CHARGE', 'PRINT_ORDER'),
    creditAdjustmentsVnd: amounts('CREDIT_ADJUSTMENT'),
    settledPaymentsVnd: amounts('PAYMENT'),
    completedRefundsVnd: amounts('REFUND'),
  });
}

async function validateSource(tx: Transaction, fact: NewLedgerFact) {
  if (fact.sourceType === 'CONTRACT_APPENDIX') {
    const source = await createEffectiveCommercialReader(tx).resolveAppendix(
      fact.bookingId,
      fact.sourceRevisionId,
    );
    if (
      Math.abs(source.document.deltaVnd) !== fact.amountVnd ||
      source.approvedAt !== fact.occurredAt ||
      source.document.reason !== fact.reason ||
      fact.kind !== (source.document.deltaVnd > 0 ? 'CHARGE' : 'CREDIT_ADJUSTMENT')
    )
      throw new BillingPersistenceConflict('FINANCIAL_SOURCE_CONFLICT');
    return;
  }
  if (
    ['BASE_BOOKING', 'PRINT_ORDER'].includes(fact.sourceType) &&
    (await createContractFinancialReader(tx).getModel(fact.bookingId)) === 'FULL_CONTRACT_V1'
  )
    throw new BillingPersistenceConflict('CONTRACT_FULFILLMENT_REQUIRED');
  if (fact.sourceType === 'CONTRACT') {
    const snapshot = await createContractFinancialReader(tx).resolveApproved(
      fact.bookingId,
      fact.sourceRevisionId,
    );
    if (snapshot.contractTotalVnd !== fact.amountVnd || snapshot.approvedAt !== fact.occurredAt)
      throw new BillingPersistenceConflict('FINANCIAL_SOURCE_CONFLICT');
    const incompatible = await tx.billingLedgerEntry.findFirst({
      where: {
        bookingId: fact.bookingId,
        sourceType: { in: ['BASE_BOOKING', 'PRINT_ORDER', 'CONTRACT'] },
      },
    });
    if (incompatible !== null) throw new BillingPersistenceConflict('FINANCIAL_SOURCE_CONFLICT');
  }
  if (fact.kind === 'PAYMENT') {
    const attempt = await tx.billingPaymentAttempt.findUnique({
      where: { id: fact.paymentAttemptId! },
    });
    if (
      attempt === null ||
      attempt.bookingId !== fact.bookingId ||
      attempt.state !== 'SUCCEEDED' ||
      safeNumber(attempt.amountVnd) !== fact.amountVnd ||
      (attempt.provider === 'MANUAL' && (fact.reason === null || fact.evidenceReference === null))
    )
      throw new BillingPersistenceConflict('PAYMENT_EVIDENCE_CONFLICT');
  }
  if (fact.kind !== 'REFUND' && fact.kind !== 'CREDIT_ADJUSTMENT') return;
  const source = await tx.billingLedgerEntry.findUnique({ where: { id: fact.sourceEntryId! } });
  if (
    source === null ||
    source.bookingId !== fact.bookingId ||
    (fact.kind === 'REFUND'
      ? source.kind !== 'PAYMENT'
      : source.kind !== 'CHARGE' || source.sourceType !== 'PRINT_ORDER')
  )
    throw new BillingPersistenceConflict(sourceConflict(fact));
  const adjustments = await tx.billingLedgerEntry.findMany({
    where: { sourceEntryId: source.id, kind: fact.kind },
  });
  const alreadyApplied = adjustments.reduce((total, row) => total + safeNumber(row.amountVnd), 0);
  if (fact.kind === 'CREDIT_ADJUSTMENT') {
    if (alreadyApplied + fact.amountVnd > safeNumber(source.amountVnd))
      throw new BillingPersistenceConflict('RECEIVABLE_ADJUSTMENT_CONFLICT');
    return;
  }
  const priorRefunds = await tx.billingLedgerEntry.findMany({
    where: { decisionId: fact.decisionId },
  });
  if (
    priorRefunds.some(
      (row) =>
        row.bookingId !== fact.bookingId ||
        row.approvedRefundableVnd === null ||
        safeNumber(row.approvedRefundableVnd) !== fact.approvedRefundableVnd,
    )
  )
    throw new BillingPersistenceConflict('PAYMENT_EVIDENCE_CONFLICT');
  validateRefund({
    amountVnd: fact.amountVnd,
    sourceSettledVnd: safeNumber(source.amountVnd),
    alreadyRefundedFromSourceVnd: alreadyApplied,
    approvedRefundableVnd: fact.approvedRefundableVnd!,
    alreadyRefundedForDecisionVnd: priorRefunds.reduce(
      (total, row) => total + safeNumber(row.amountVnd),
      0,
    ),
  });
}

async function audit(
  tx: Transaction,
  context: ContractContext,
  bookingId: string,
  entityId: string,
  action: string,
  metadata: Prisma.InputJsonObject,
) {
  await tx.auditLog.create({
    data: {
      requestId: context.requestId,
      actorType: context.authority === 'SYSTEM' ? 'SYSTEM' : 'USER',
      actorId: context.actorAccountId,
      action,
      entityType: 'billing',
      entityId,
      metadata: { bookingId, ...metadata },
    },
  });
}

async function appendOutbox(tx: Transaction, entry: LedgerEntry, context: ContractContext) {
  let eventType: string;
  let payload: Prisma.InputJsonObject;
  if (entry.kind === 'CHARGE' && entry.sourceType === 'PRINT_ORDER') {
    eventType = 'billing.receivable-charge-accepted';
    payload = {
      bookingId: entry.bookingId,
      receivableChargeId: entry.id,
      sourceType: entry.sourceType,
      sourceRevisionId: entry.sourceRevisionId,
      amountVnd: entry.amountVnd,
      acceptedAt: entry.occurredAt,
    };
  } else if (
    ['CONTRACT_APPENDIX', 'INCIDENTAL_FINALIZATION', 'INVOICE_ADJUSTMENT'].includes(
      entry.sourceType,
    )
  ) {
    eventType = 'billing.commercial-obligation-recorded';
    payload = {
      bookingId: entry.bookingId,
      ledgerEntryId: entry.id,
      sourceType: entry.sourceType,
      sourceRevisionId: entry.sourceRevisionId,
      kind: entry.kind,
      amountVnd: entry.amountVnd,
      occurredAt: entry.occurredAt,
    };
  } else if (entry.kind === 'PAYMENT') {
    const attempt = await tx.billingPaymentAttempt.findUniqueOrThrow({
      where: { id: entry.paymentAttemptId! },
    });
    eventType = 'billing.payment-succeeded';
    payload = {
      bookingId: entry.bookingId,
      paymentId: entry.id,
      purpose: attempt.purpose,
      amountVnd: entry.amountVnd,
      settledAt: entry.occurredAt,
    };
  } else if (entry.kind === 'REFUND') {
    eventType = 'billing.refund-recorded';
    payload = {
      bookingId: entry.bookingId,
      refundId: entry.id,
      sourcePaymentId: entry.sourceEntryId,
      amountVnd: entry.amountVnd,
      recordedAt: entry.occurredAt,
    };
  } else return;
  await tx.billingOutboxEvent.create({
    data: {
      id: randomUUID(),
      ledgerEntryId: entry.id,
      eventType,
      eventVersion: 1,
      correlationId: context.requestId,
      causationId: context.causationId,
      aggregateId: entry.bookingId,
      aggregateRevision: entry.revision,
      occurredAt: new Date(entry.occurredAt),
      payload,
    },
  });
}
