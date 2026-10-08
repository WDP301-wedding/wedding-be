import { describe, expect, it } from 'vitest';

import {
  BillingPolicyError,
  calculateBillingTotals,
  transitionPaymentAttempt,
  validateRefund,
} from './billing-policy.js';

describe('SPEC-04 accounting policy', () => {
  it('returns frozen zero totals for an empty ledger', () => {
    const totals = calculateBillingTotals({
      baseChargesVnd: [],
      printChargesVnd: [],
      creditAdjustmentsVnd: [],
      settledPaymentsVnd: [],
      completedRefundsVnd: [],
    });
    expect(Object.values(totals)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(Object.isFrozen(totals)).toBe(true);
  });

  it('rejects refund records that already exceed source or approval and invalid amounts', () => {
    const refund = {
      amountVnd: 20_000,
      sourceSettledVnd: 100_000,
      alreadyRefundedFromSourceVnd: 0,
      approvedRefundableVnd: 60_000,
      alreadyRefundedForDecisionVnd: 0,
    };
    for (const patch of [
      { alreadyRefundedFromSourceVnd: 100_001 },
      { alreadyRefundedForDecisionVnd: 60_001 },
    ]) {
      expect(() => validateRefund({ ...refund, ...patch })).toThrowError(
        expect.objectContaining({ code: 'BILLING_LEDGER_INCONSISTENT' }),
      );
    }
    for (const patch of [
      { amountVnd: 0 },
      { sourceSettledVnd: 0 },
      { approvedRefundableVnd: -1 },
      { alreadyRefundedFromSourceVnd: 0.5 },
      { alreadyRefundedForDecisionVnd: Number.NaN },
    ]) {
      expect(() => validateRefund({ ...refund, ...patch })).toThrowError(
        expect.objectContaining({ code: 'BILLING_AMOUNT_INVALID' }),
      );
    }
    expect(validateRefund({ ...refund, amountVnd: 60_000 })).toEqual({ amountVnd: 60_000 });
  });
  it('derives accepted charges and receivables from immutable ledger facts', () => {
    expect(
      calculateBillingTotals({
        baseChargesVnd: [100_000],
        printChargesVnd: [60_000],
        creditAdjustmentsVnd: [20_000],
        settledPaymentsVnd: [110_000, 20_000],
        completedRefundsVnd: [10_000],
      }),
    ).toEqual({
      acceptedChargesVnd: 140_000,
      paidVnd: 130_000,
      refundedVnd: 10_000,
      netPaidVnd: 120_000,
      outstandingVnd: 20_000,
      creditVnd: 0,
    });
  });

  it('keeps charges nonnegative and reports overpayment as credit without refunding it', () => {
    expect(
      calculateBillingTotals({
        baseChargesVnd: [100_000],
        printChargesVnd: [],
        creditAdjustmentsVnd: [120_000],
        settledPaymentsVnd: [150_000],
        completedRefundsVnd: [],
      }),
    ).toMatchObject({ acceptedChargesVnd: 0, outstandingVnd: 0, creditVnd: 150_000 });
  });

  it('reports payment overage after accepted charges as credit', () => {
    expect(
      calculateBillingTotals({
        baseChargesVnd: [100_000],
        printChargesVnd: [],
        creditAdjustmentsVnd: [],
        settledPaymentsVnd: [130_000],
        completedRefundsVnd: [10_000],
      }),
    ).toMatchObject({
      acceptedChargesVnd: 100_000,
      netPaidVnd: 120_000,
      outstandingVnd: 0,
      creditVnd: 20_000,
    });
  });

  it.each([0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN])(
    'rejects invalid ledger amounts: %s',
    (amount) => {
      expect(() =>
        calculateBillingTotals({
          baseChargesVnd: [amount],
          printChargesVnd: [],
          creditAdjustmentsVnd: [],
          settledPaymentsVnd: [],
          completedRefundsVnd: [],
        }),
      ).toThrow(BillingPolicyError);
    },
  );

  it('rejects unsafe aggregate arithmetic and refunds larger than settled money', () => {
    expect(() =>
      calculateBillingTotals({
        baseChargesVnd: [Number.MAX_SAFE_INTEGER, 1],
        printChargesVnd: [],
        creditAdjustmentsVnd: [],
        settledPaymentsVnd: [],
        completedRefundsVnd: [],
      }),
    ).toThrowError(expect.objectContaining({ code: 'BILLING_TOTAL_OVERFLOW' }));

    expect(() =>
      calculateBillingTotals({
        baseChargesVnd: [1],
        printChargesVnd: [],
        creditAdjustmentsVnd: [],
        settledPaymentsVnd: [100],
        completedRefundsVnd: [101],
      }),
    ).toThrowError(expect.objectContaining({ code: 'BILLING_LEDGER_INCONSISTENT' }));
  });

  it('limits a refund by both source settlement and approved decision remainder', () => {
    expect(
      validateRefund({
        amountVnd: 20_000,
        sourceSettledVnd: 100_000,
        alreadyRefundedFromSourceVnd: 30_000,
        approvedRefundableVnd: 60_000,
        alreadyRefundedForDecisionVnd: 10_000,
      }),
    ).toEqual({ amountVnd: 20_000 });

    expect(() =>
      validateRefund({
        amountVnd: 31_000,
        sourceSettledVnd: 100_000,
        alreadyRefundedFromSourceVnd: 70_000,
        approvedRefundableVnd: 60_000,
        alreadyRefundedForDecisionVnd: 10_000,
      }),
    ).toThrowError(expect.objectContaining({ code: 'BILLING_REFUND_LIMIT_EXCEEDED' }));

    expect(() =>
      validateRefund({
        amountVnd: 51_000,
        sourceSettledVnd: 100_000,
        alreadyRefundedFromSourceVnd: 0,
        approvedRefundableVnd: 60_000,
        alreadyRefundedForDecisionVnd: 10_000,
      }),
    ).toThrowError(expect.objectContaining({ code: 'BILLING_REFUND_LIMIT_EXCEEDED' }));
  });
});

describe('SPEC-04 payment attempt transitions', () => {
  it('moves created attempts to pending and resolves pending/unknown from verified evidence', () => {
    expect(transitionPaymentAttempt('CREATED', 'PROVIDER_REQUESTED')).toBe('PENDING');
    expect(transitionPaymentAttempt('PENDING', 'OUTCOME_UNKNOWN')).toBe('UNKNOWN');
    expect(transitionPaymentAttempt('PENDING', 'VERIFIED_SUCCESS')).toBe('SUCCEEDED');
    expect(transitionPaymentAttempt('PENDING', 'VERIFIED_FAILURE')).toBe('FAILED');
    expect(transitionPaymentAttempt('UNKNOWN', 'VERIFIED_SUCCESS')).toBe('SUCCEEDED');
    expect(transitionPaymentAttempt('UNKNOWN', 'VERIFIED_FAILURE')).toBe('FAILED');
  });

  it('keeps unknown outcomes unresolved until verified evidence arrives', () => {
    expect(transitionPaymentAttempt('UNKNOWN', 'OUTCOME_UNKNOWN')).toBe('UNKNOWN');
    expect(() => transitionPaymentAttempt('CREATED', 'VERIFIED_SUCCESS')).toThrow(
      BillingPolicyError,
    );
  });

  it('treats identical terminal evidence as replay and rejects a contradictory result', () => {
    expect(transitionPaymentAttempt('SUCCEEDED', 'VERIFIED_SUCCESS')).toBe('SUCCEEDED');
    expect(transitionPaymentAttempt('FAILED', 'VERIFIED_FAILURE')).toBe('FAILED');
    expect(() => transitionPaymentAttempt('SUCCEEDED', 'VERIFIED_FAILURE')).toThrowError(
      expect.objectContaining({ code: 'PAYMENT_EVIDENCE_CONFLICT' }),
    );
  });
});
