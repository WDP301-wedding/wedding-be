import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  balanceBodySchema,
  depositBodySchema,
  manualBodySchema,
  refundBodySchema,
  refundApprovalBodySchema,
  billingQuerySchema,
  attemptResponseSchema,
} from './payments-billing.schemas.js';

describe('billing HTTP boundary schemas', () => {
  it('accepts only the approved submitted intent fields', () => {
    expect(depositBodySchema.parse({ timelineRevisionId: randomUUID() })).toBeDefined();
    expect(balanceBodySchema.parse({ expectedBillingRevision: 1 })).toBeDefined();
    const manual = {
      bookingId: randomUUID(),
      purpose: 'DEPOSIT',
      amountVnd: 15000000,
      settledAt: '2026-10-08T16:00:00Z',
      reason: 'Receipt',
      evidenceReference: 'receipt-1',
    };
    expect(manualBodySchema.parse(manual)).toBeDefined();
    const refund = {
      sourcePaymentId: randomUUID(),
      amountVnd: 1,
      expectedBillingRevision: 1,
      reason: 'Approved refund',
      evidenceReference: 'receipt-2',
    };
    expect(refundBodySchema.parse(refund)).toBeDefined();
    for (const field of [
      'role',
      'commandId',
      'approvedRefundableVnd',
      'decisionId',
      'timelineRevisionId',
      'expectedBillingRevision',
    ]) {
      expect(manualBodySchema.safeParse({ ...manual, [field]: 'override' }).success).toBe(false);
    }
    expect(
      depositBodySchema.safeParse({ timelineRevisionId: randomUUID(), amountVnd: 1 }).success,
    ).toBe(false);
    expect(refundBodySchema.safeParse({ ...refund, approvedRefundableVnd: 999 }).success).toBe(
      false,
    );
  });
  it('requires an explicit owned refund basis without accepting a cancellation sequence or authority override', () => {
    const approval = {
      bookingId: randomUUID(),
      expectedBillingRevision: 2,
      approvedRefundableVnd: 1,
      basis: { kind: 'CREDIT', sourceEntryId: randomUUID() },
      reason: 'Approved refund',
      evidenceReference: 'approval-1',
    };
    expect(refundApprovalBodySchema.safeParse(approval).success).toBe(true);
    expect(
      refundApprovalBodySchema.safeParse({ ...approval, basis: { kind: 'CANCELLATION' } }).success,
    ).toBe(true);
    for (const input of [
      { ...approval, basis: { kind: 'CANCELLATION', sequence: 123 } },
      { ...approval, basis: { kind: 'CREDIT' } },
      { ...approval, approvedRefundableVnd: 0 },
      { ...approval, expectedBillingRevision: 0 },
      { ...approval, approvedByAccountId: randomUUID() },
    ])
      expect(refundApprovalBodySchema.safeParse(input).success).toBe(false);
  });
  it('bounds integer VND, evidence, revision and pagination', () => {
    expect(balanceBodySchema.safeParse({ expectedBillingRevision: 0 }).success).toBe(false);
    expect(billingQuerySchema.parse({})).toEqual({ limit: 25 });
    expect(billingQuerySchema.parse({ limit: '100', throughBillingRevision: '0' })).toEqual({
      limit: 100,
      throughBillingRevision: 0,
    });
    for (const input of [
      { limit: '101' },
      { limit: ['1', '2'] },
      { limit: '2.5' },
      { cursor: '' },
      { secret: 'x' },
    ])
      expect(billingQuerySchema.safeParse(input).success).toBe(false);
    const body = {
      bookingId: randomUUID(),
      purpose: 'BALANCE',
      amountVnd: 1,
      settledAt: '2026-10-08T16:00:00Z',
      reason: 'Receipt',
      evidenceReference: 'a',
    };
    for (const amountVnd of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(manualBodySchema.safeParse({ ...body, amountVnd }).success).toBe(false);
    expect(
      manualBodySchema.safeParse({ ...body, evidenceReference: 'a'.repeat(121) }).success,
    ).toBe(false);
    expect(manualBodySchema.safeParse({ ...body, settledAt: 'yesterday' }).success).toBe(false);
  });
  it('rejects private provider evidence in safe attempt responses', () => {
    const data = {
      paymentAttemptId: randomUUID(),
      status: 'UNKNOWN',
      purpose: 'DEPOSIT',
      amountVnd: 1,
      applicationStatus: null,
      expiresAt: '2026-10-08T16:15:00Z',
    };
    expect(attemptResponseSchema.parse({ data })).toBeDefined();
    expect(
      attemptResponseSchema.safeParse({ data: { ...data, providerEvidenceId: randomUUID() } })
        .success,
    ).toBe(false);
  });
});
