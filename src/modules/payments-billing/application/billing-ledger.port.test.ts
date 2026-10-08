import { describe, expect, it } from 'vitest';

import {
  issueInvoiceSchema,
  invoiceSnapshotSchema,
  ledgerFactSchema,
  newPaymentAttemptSchema,
} from './billing-ledger.port.js';

const id = '11111111-1111-4111-8111-111111111111';
const sourceId = '22222222-2222-4222-8222-222222222222';
const timestamp = '2026-10-08T06:00:00.000Z';
const fact = {
  id,
  bookingId: id,
  kind: 'CHARGE' as const,
  sourceType: 'BASE_BOOKING' as const,
  sourceRevisionId: sourceId,
  amountVnd: 100_000,
  occurredAt: timestamp,
  sourceEntryId: null,
  paymentAttemptId: null,
  decisionId: null,
  approvedRefundableVnd: null,
  reason: null,
  evidenceReference: null,
};
const attempt = {
  id,
  bookingId: id,
  commandId: sourceId,
  purpose: 'BALANCE' as const,
  provider: 'VNPAY' as const,
  amountVnd: 100_000,
  timelineRevisionId: null,
  createdAt: timestamp,
  expiresAt: '2026-10-08T06:15:00.000Z',
};

describe('PB-W2 internal persistence boundary schemas', () => {
  it('accepts exact base/print, proven payment, linked credit and evidenced refund shapes', () => {
    for (const input of [
      fact,
      { ...fact, sourceType: 'PRINT_ORDER' },
      { ...fact, kind: 'PAYMENT', sourceType: 'PAYMENT_ATTEMPT', paymentAttemptId: sourceId },
      {
        ...fact,
        kind: 'CREDIT_ADJUSTMENT',
        sourceType: 'PRINT_CREDIT',
        sourceEntryId: id,
        reason: 'PRINT_CANCELLED',
      },
      {
        ...fact,
        kind: 'REFUND',
        sourceType: 'MANUAL_REFUND',
        sourceEntryId: id,
        decisionId: sourceId,
        approvedRefundableVnd: 100_000,
        reason: 'Approved cancellation',
        evidenceReference: 'Manual evidence',
      },
    ])
      expect(ledgerFactSchema.safeParse(input).success).toBe(true);
  });

  it.each([0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN])(
    'rejects unsafe VND fact/attempt amounts: %s',
    (amountVnd) => {
      expect(ledgerFactSchema.safeParse({ ...fact, amountVnd }).success).toBe(false);
      expect(newPaymentAttemptSchema.safeParse({ ...attempt, amountVnd }).success).toBe(false);
    },
  );

  it('rejects mismatched kinds, missing links/approval/evidence, and undeclared data', () => {
    for (const input of [
      { ...fact, kind: 'PAYMENT', sourceType: 'PAYMENT_ATTEMPT', paymentAttemptId: id },
      {
        ...fact,
        kind: 'CREDIT_ADJUSTMENT',
        sourceType: 'PRINT_CREDIT',
        sourceEntryId: id,
        reason: null,
      },
      {
        ...fact,
        kind: 'REFUND',
        sourceType: 'MANUAL_REFUND',
        sourceEntryId: id,
        reason: 'reason',
        evidenceReference: 'evidence',
      },
      { ...fact, providerSecret: 'undeclared' },
      { ...fact, occurredAt: '2026-10-08' },
    ])
      expect(ledgerFactSchema.safeParse(input).success).toBe(false);
  });

  it('requires deposit timeline identity and a positive expiry interval without trusting caller state', () => {
    expect(newPaymentAttemptSchema.safeParse(attempt).success).toBe(true);
    expect(
      newPaymentAttemptSchema.safeParse({
        ...attempt,
        purpose: 'DEPOSIT',
        timelineRevisionId: sourceId,
      }).success,
    ).toBe(true);
    for (const input of [
      { ...attempt, purpose: 'DEPOSIT' },
      { ...attempt, timelineRevisionId: sourceId },
      { ...attempt, expiresAt: timestamp },
      { ...attempt, state: 'SUCCEEDED' },
    ])
      expect(newPaymentAttemptSchema.safeParse(input).success).toBe(false);
  });

  it('requires an exact invoice revision and bounded number; forbids caller totals', () => {
    const invoice = {
      id,
      bookingId: id,
      invoiceNumber: 'INV-FIXTURE',
      expectedBillingRevision: 1,
      issuedAt: timestamp,
    };
    expect(issueInvoiceSchema.safeParse(invoice).success).toBe(true);
    const storedSnapshot = {
      revision: 1,
      entries: [{ ...fact, revision: 1 }],
      totals: {
        acceptedChargesVnd: 100_000,
        paidVnd: 0,
        refundedVnd: 0,
        netPaidVnd: 0,
        outstandingVnd: 100_000,
        creditVnd: 0,
      },
    };
    const parsed = invoiceSnapshotSchema.parse(storedSnapshot);
    expect(parsed).toEqual(storedSnapshot);
    expect(Object.isFrozen(parsed.entries[0])).toBe(true);
    expect(Object.isFrozen(parsed.totals)).toBe(true);
    expect(
      invoiceSnapshotSchema.safeParse({
        ...storedSnapshot,
        totals: { ...storedSnapshot.totals, providerSecret: 'undeclared' },
      }).success,
    ).toBe(false);
    for (const input of [
      { ...invoice, expectedBillingRevision: 0 },
      { ...invoice, invoiceNumber: ' ' },
      { ...invoice, invoiceNumber: 'x'.repeat(121) },
      { ...invoice, totals: { paidVnd: 1 } },
    ]) {
      expect(issueInvoiceSchema.safeParse(input).success).toBe(false);
    }
  });
});
