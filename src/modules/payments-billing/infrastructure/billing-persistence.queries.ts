import type {
  LedgerHistoryQuery,
  LedgerPageSnapshot,
  LedgerSnapshot,
  NewLedgerFact,
} from '../application/billing-ledger.port.js';
import { createContractFinancialReader } from '../../booking-lifecycle/infrastructure/contract-financial.reader.js';
import { createEffectiveCommercialReader } from '../../booking-lifecycle/infrastructure/effective-commercial.reader.js';
import { finalInvoiceDigest, finalInvoiceDocumentSchema } from '../domain/final-invoice.js';
import { type BillingTotals, validateRefund } from '../domain/billing-policy.js';
import {
  BillingPersistenceConflict,
  safeNumber,
  sourceConflict,
  toEntry,
  totalsFrom,
  totalsFromAggregateRow,
  type Transaction,
} from './billing-persistence.helpers.js';

export async function readLedger(tx: Transaction, bookingId: string): Promise<LedgerSnapshot> {
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

export async function readReceivables(tx: Transaction, bookingId: string): Promise<BillingTotals> {
  const [summary] = await tx.$queryRaw<
    Array<{
      baseChargesVnd: unknown;
      printChargesVnd: unknown;
      creditAdjustmentsVnd: unknown;
      settledPaymentsVnd: unknown;
      completedRefundsVnd: unknown;
    }>
  >`
    SELECT
      COALESCE(SUM(CASE WHEN "kind" = 'CHARGE' AND "sourceType" <> 'PRINT_ORDER' THEN "amountVnd" ELSE 0 END), 0) AS "baseChargesVnd",
      COALESCE(SUM(CASE WHEN "kind" = 'CHARGE' AND "sourceType" = 'PRINT_ORDER' THEN "amountVnd" ELSE 0 END), 0) AS "printChargesVnd",
      COALESCE(SUM(CASE WHEN "kind" = 'CREDIT_ADJUSTMENT' THEN "amountVnd" ELSE 0 END), 0) AS "creditAdjustmentsVnd",
      COALESCE(SUM(CASE WHEN "kind" = 'PAYMENT' THEN "amountVnd" ELSE 0 END), 0) AS "settledPaymentsVnd",
      COALESCE(SUM(CASE WHEN "kind" = 'REFUND' THEN "amountVnd" ELSE 0 END), 0) AS "completedRefundsVnd"
    FROM "BillingLedgerEntry"
    WHERE "bookingId" = ${bookingId}::uuid
  `;
  return totalsFromAggregateRow(
    summary ?? {
      baseChargesVnd: 0,
      printChargesVnd: 0,
      creditAdjustmentsVnd: 0,
      settledPaymentsVnd: 0,
      completedRefundsVnd: 0,
    },
  );
}

export async function readLedgerPage(
  tx: Transaction,
  bookingId: string,
  query: LedgerHistoryQuery,
): Promise<LedgerPageSnapshot> {
  const [summary] = await tx.$queryRaw<
    Array<{
      headRevision: number | bigint | null;
      baseChargesVnd: unknown;
      printChargesVnd: unknown;
      creditAdjustmentsVnd: unknown;
      settledPaymentsVnd: unknown;
      completedRefundsVnd: unknown;
    }>
  >`
    SELECT
      COALESCE(MAX("revision"), 0)::int AS "headRevision",
      COALESCE(SUM(CASE WHEN (${query.throughBillingRevision ?? null}::bigint IS NULL OR "revision" <= ${query.throughBillingRevision ?? null}::bigint) AND "kind" = 'CHARGE' AND "sourceType" <> 'PRINT_ORDER' THEN "amountVnd" ELSE 0 END), 0) AS "baseChargesVnd",
      COALESCE(SUM(CASE WHEN (${query.throughBillingRevision ?? null}::bigint IS NULL OR "revision" <= ${query.throughBillingRevision ?? null}::bigint) AND "kind" = 'CHARGE' AND "sourceType" = 'PRINT_ORDER' THEN "amountVnd" ELSE 0 END), 0) AS "printChargesVnd",
      COALESCE(SUM(CASE WHEN (${query.throughBillingRevision ?? null}::bigint IS NULL OR "revision" <= ${query.throughBillingRevision ?? null}::bigint) AND "kind" = 'CREDIT_ADJUSTMENT' THEN "amountVnd" ELSE 0 END), 0) AS "creditAdjustmentsVnd",
      COALESCE(SUM(CASE WHEN (${query.throughBillingRevision ?? null}::bigint IS NULL OR "revision" <= ${query.throughBillingRevision ?? null}::bigint) AND "kind" = 'PAYMENT' THEN "amountVnd" ELSE 0 END), 0) AS "settledPaymentsVnd",
      COALESCE(SUM(CASE WHEN (${query.throughBillingRevision ?? null}::bigint IS NULL OR "revision" <= ${query.throughBillingRevision ?? null}::bigint) AND "kind" = 'REFUND' THEN "amountVnd" ELSE 0 END), 0) AS "completedRefundsVnd"
    FROM "BillingLedgerEntry"
    WHERE "bookingId" = ${bookingId}::uuid
  `;

  const headRevision = Number(summary?.headRevision ?? 0);
  const billingRevision = query.throughBillingRevision ?? headRevision;
  const totals = totalsFromAggregateRow(
    summary ?? {
      baseChargesVnd: 0,
      printChargesVnd: 0,
      creditAdjustmentsVnd: 0,
      settledPaymentsVnd: 0,
      completedRefundsVnd: 0,
    },
  );

  if (
    (query.throughBillingRevision !== undefined && query.throughBillingRevision > headRevision) ||
    query.cursorRevision > billingRevision
  ) {
    return Object.freeze({
      headRevision,
      billingRevision,
      totals,
      page: Object.freeze([]),
      hasMore: false,
    });
  }

  const rows = await tx.billingLedgerEntry.findMany({
    where: {
      bookingId,
      revision: {
        gt: query.cursorRevision,
        lte: billingRevision,
      },
    },
    orderBy: { revision: 'asc' },
    take: query.limit + 1,
  });

  const hasMore = rows.length > query.limit;
  const page = Object.freeze(rows.slice(0, query.limit).map(toEntry));

  return Object.freeze({
    headRevision,
    billingRevision,
    totals,
    page,
    hasMore,
  });
}

export async function validateSource(tx: Transaction, fact: NewLedgerFact) {
  if (fact.sourceType === 'INCIDENTAL_FINALIZATION' || fact.sourceType === 'INVOICE_ADJUSTMENT') {
    const source = await tx.finalInvoiceRevision.findFirst({
      where: { id: fact.sourceRevisionId, bookingId: fact.bookingId },
    });
    if (!source) throw new BillingPersistenceConflict('FINANCIAL_SOURCE_CONFLICT');
    const document = finalInvoiceDocumentSchema.parse(source.document),
      delta = source.deltaVnd.toNumber();
    if (
      finalInvoiceDigest(document) !== source.documentDigest ||
      fact.amountVnd !== Math.abs(delta) ||
      fact.occurredAt !== source.issuedAt.toISOString() ||
      fact.kind !== (delta > 0 ? 'CHARGE' : 'CREDIT_ADJUSTMENT') ||
      (fact.sourceType === 'INCIDENTAL_FINALIZATION') !== (source.predecessorRevisionId === null) ||
      fact.reason !==
        (source.predecessorRevisionId === null ? null : document.adjustments.at(-1)?.reason)
    )
      throw new BillingPersistenceConflict('FINANCIAL_SOURCE_CONFLICT');
    return;
  }
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
