import { describe, expect, it } from 'vitest';
import {
  balanceIntentSchema,
  manualPaymentSchema,
  refundApprovalSchema,
  refundCommandSchema,
} from './billing-operations.port.js';

const id = '10000000-0000-4000-8000-000000000001';
const common = { bookingId: id, commandId: id };
const manual = {
  ...common,
  purpose: 'BALANCE',
  amountVnd: 100,
  expectedBillingRevision: 1,
  settledAt: '2026-10-08T23:00:00+07:00',
  reason: 'Approved receipt',
  evidenceReference: 'RECEIPT-001',
};

describe('W5 strict money command boundaries', () => {
  it('normalizes manual evidence and requires the purpose-specific authority snapshot', () => {
    expect(manualPaymentSchema.parse(manual).settledAt).toBe('2026-10-08T16:00:00.000Z');
    expect(
      manualPaymentSchema.safeParse({ ...manual, expectedBillingRevision: undefined }).success,
    ).toBe(false);
    const deposit = {
      ...common,
      amountVnd: manual.amountVnd,
      settledAt: manual.settledAt,
      reason: manual.reason,
      evidenceReference: manual.evidenceReference,
    };
    expect(
      manualPaymentSchema.safeParse({ ...deposit, purpose: 'DEPOSIT', timelineRevisionId: id })
        .success,
    ).toBe(true);
    expect(manualPaymentSchema.safeParse({ ...deposit, purpose: 'DEPOSIT' }).success).toBe(false);
  });
  it.each([0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid manual/refund VND %s',
    (amountVnd) => {
      expect(manualPaymentSchema.safeParse({ ...manual, amountVnd }).success).toBe(false);
      expect(
        refundCommandSchema.safeParse({
          ...common,
          sourcePaymentId: id,
          decisionId: id,
          amountVnd,
          expectedBillingRevision: 1,
          reason: 'refund',
          evidenceReference: 'ref',
          recordedAt: '2026-10-08T16:00:00Z',
        }).success,
      ).toBe(false);
    },
  );
  it('rejects client totals, roles, approval overrides and missing decision evidence', () => {
    expect(balanceIntentSchema.safeParse({ ...common, expectedBillingRevision: 1 }).success).toBe(
      true,
    );
    for (const extra of [
      { amountVnd: 10 },
      { roles: ['MANAGER'] },
      { approvedRefundableVnd: 100 },
    ]) {
      expect(
        balanceIntentSchema.safeParse({ ...common, expectedBillingRevision: 1, ...extra }).success,
      ).toBe(false);
    }
    expect(
      refundApprovalSchema.safeParse({
        ...common,
        basis: { kind: 'CREDIT', sourceEntryId: id },
        approvedRefundableVnd: 100,
        reason: 'Approved cancellation',
        evidenceReference: 'DEC-1',
      }).success,
    ).toBe(true);
    expect(
      refundApprovalSchema.safeParse({
        ...common,
        approvedRefundableVnd: 100,
        reason: 'Approved cancellation',
        evidenceReference: 'DEC-1',
      }).success,
    ).toBe(false);
    expect(
      manualPaymentSchema.safeParse({ ...manual, reason: ' ', evidenceReference: '' }).success,
    ).toBe(false);
  });
});
