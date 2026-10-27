import { createBookingBoundaryUnitOfWork } from '../../../core/database/booking-unit-of-work.js';
import { NotFoundError } from '../../../core/errors/app-error.js';
import {
  Prisma,
  type PrismaClient,
} from '../../../generated/prisma/client.js';
import {
  issueInvoiceSchema,
  invoiceSnapshotSchema,
  ledgerFactSchema,
  newPaymentAttemptSchema,
  type BillingLedgerRepository,
  type InvoiceRecord,
  type LedgerHistoryQuery,
  type NewLedgerFact,
} from '../application/billing-ledger.port.js';
import type { ContractContext } from '../application/payments-billing.providers.js';
import { transitionPaymentAttempt } from '../domain/billing-policy.js';
import {
  appendOutbox,
  audit,
  BillingPersistenceConflict,
  normalizeFact,
  sameFact,
  sourceConflict,
  toAttempt,
  toEntry,
  totalsFrom,
  type Transaction,
} from './billing-persistence.helpers.js';
import {
  readLedger,
  readLedgerPage,
  readReceivables,
  validateSource,
} from './billing-persistence.queries.js';

export { BillingPersistenceConflict };

type Scope = ReturnType<typeof createBookingBoundaryUnitOfWork>;

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
              // A read-only outer boundary already holds the same booking's
              // shared fence. Never upgrade it through an enlisted ledger read.
              if (!scope.isReadScope())
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
    getReceivables(bookingId: string, context?: ContractContext) {
      return transact(bookingId, context, (tx) => readReceivables(tx, bookingId));
    },
    readLedgerPage(bookingId: string, query: LedgerHistoryQuery, context?: ContractContext) {
      return transact(bookingId, context, (tx) => readLedgerPage(tx, bookingId, query));
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
        invoiceRevisionId: parsed.invoiceRevisionId ?? null,
        invoiceDigest: parsed.invoiceDigest ?? null,
        sourceBillingRevision: parsed.sourceBillingRevision ?? null,
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
        const activeAttempt = await tx.billingPaymentAttempt.findFirst({
          where: {
            bookingId: snapshot.bookingId,
            purpose: snapshot.purpose,
            state: { in: ['CREATED', 'PENDING', 'UNKNOWN'] },
          },
        });
        if (activeAttempt !== null) {
          if (
            (activeAttempt.state === 'CREATED' || activeAttempt.state === 'PENDING') &&
            activeAttempt.expiresAt.getTime() <= new Date().getTime()
          ) {
            await tx.billingPaymentAttempt.update({
              where: { id: activeAttempt.id },
              data: { state: 'FAILED' },
            });
            await audit(tx, context, snapshot.bookingId, activeAttempt.id, 'billing.attempt-expired', {
              purpose: activeAttempt.purpose,
              state: 'FAILED',
            });
          } else {
            throw new BillingPersistenceConflict('PAYMENT_ATTEMPT_ACTIVE');
          }
        }
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
