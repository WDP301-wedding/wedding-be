import { randomUUID } from 'node:crypto';
import { AppError } from '../../../core/errors/app-error.js';
import type {
  Prisma,
  BillingLedgerEntry as StoredEntry,
  BillingPaymentAttempt as StoredAttempt,
} from '../../../generated/prisma/client.js';
import type {
  LedgerEntry,
  NewLedgerFact,
  PaymentAttempt,
} from '../application/billing-ledger.port.js';
import type { ContractContext } from '../application/payments-billing.providers.js';
import { calculateBillingTotals, type BillingTotals } from '../domain/billing-policy.js';

export class BillingPersistenceConflict extends AppError {
  constructor(code: string) {
    super({
      status: 409,
      code,
      message: 'The billing command conflicts with its persisted evidence.',
    });
  }
}

export type Transaction = Prisma.TransactionClient;

export function normalizeFact(fact: NewLedgerFact): NewLedgerFact {
  return Object.freeze({ ...fact, occurredAt: new Date(fact.occurredAt).toISOString() });
}

export function toEntry(row: StoredEntry): LedgerEntry {
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

export function toAttempt(row: StoredAttempt): PaymentAttempt {
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
    invoiceRevisionId: row.invoiceRevisionId,
    invoiceDigest: row.invoiceDigest,
    sourceBillingRevision: row.sourceBillingRevision,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    state: row.state,
    terminalEvidenceId: row.terminalEvidenceId,
  });
}

export function safeNumber(value: Prisma.Decimal): number {
  const amount = value.toNumber();
  if (!Number.isSafeInteger(amount) || amount <= 0)
    throw new BillingPersistenceConflict('BILLING_LEDGER_INCONSISTENT');
  return amount;
}

export function sameFact(stored: LedgerEntry, requested: NewLedgerFact): boolean {
  return (Object.keys(requested) as (keyof NewLedgerFact)[]).every(
    (key) => key === 'id' || stored[key] === requested[key],
  );
}

export function sourceConflict(fact: NewLedgerFact): string {
  if (fact.kind === 'CHARGE') return 'RECEIVABLE_SOURCE_CONFLICT';
  if (fact.kind === 'CREDIT_ADJUSTMENT') return 'RECEIVABLE_ADJUSTMENT_CONFLICT';
  return 'PAYMENT_EVIDENCE_CONFLICT';
}

export function totalsFrom(entries: readonly LedgerEntry[]) {
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

export function safeAggregateSum(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const num =
    typeof value === 'number'
      ? value
      : typeof value === 'bigint'
        ? Number(value)
        : typeof (value as { toNumber?: () => number }).toNumber === 'function'
          ? (value as { toNumber: () => number }).toNumber()
          : Number(value);
  if (!Number.isSafeInteger(num) || num < 0) {
    throw new BillingPersistenceConflict('BILLING_LEDGER_INCONSISTENT');
  }
  return num;
}

export function totalsFromAggregateRow(row: {
  baseChargesVnd: unknown;
  printChargesVnd: unknown;
  creditAdjustmentsVnd: unknown;
  settledPaymentsVnd: unknown;
  completedRefundsVnd: unknown;
}): BillingTotals {
  const base = safeAggregateSum(row.baseChargesVnd);
  const print = safeAggregateSum(row.printChargesVnd);
  const credit = safeAggregateSum(row.creditAdjustmentsVnd);
  const payments = safeAggregateSum(row.settledPaymentsVnd);
  const refunds = safeAggregateSum(row.completedRefundsVnd);

  return calculateBillingTotals({
    baseChargesVnd: base > 0 ? [base] : [],
    printChargesVnd: print > 0 ? [print] : [],
    creditAdjustmentsVnd: credit > 0 ? [credit] : [],
    settledPaymentsVnd: payments > 0 ? [payments] : [],
    completedRefundsVnd: refunds > 0 ? [refunds] : [],
  });
}

export async function audit(
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

export async function appendOutbox(tx: Transaction, entry: LedgerEntry, context: ContractContext) {
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
