export type PaymentAttemptState = 'CREATED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';

export type PaymentAttemptEvidence =
  'PROVIDER_REQUESTED' | 'VERIFIED_SUCCESS' | 'VERIFIED_FAILURE' | 'OUTCOME_UNKNOWN';

export interface BillingTotalsInput {
  readonly baseChargesVnd: readonly number[];
  readonly printChargesVnd: readonly number[];
  readonly creditAdjustmentsVnd: readonly number[];
  readonly settledPaymentsVnd: readonly number[];
  readonly completedRefundsVnd: readonly number[];
}

export interface BillingTotals {
  readonly acceptedChargesVnd: number;
  readonly paidVnd: number;
  readonly refundedVnd: number;
  readonly netPaidVnd: number;
  readonly outstandingVnd: number;
  readonly creditVnd: number;
}

export interface RefundValidationInput {
  readonly amountVnd: number;
  readonly sourceSettledVnd: number;
  readonly alreadyRefundedFromSourceVnd: number;
  readonly approvedRefundableVnd: number;
  readonly alreadyRefundedForDecisionVnd: number;
}

export class BillingPolicyError extends Error {
  override readonly name = 'BillingPolicyError';

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function calculateBillingTotals(input: BillingTotalsInput): BillingTotals {
  const baseChargesVnd = sumPositiveVnd(input.baseChargesVnd, 'baseChargesVnd');
  const printChargesVnd = sumPositiveVnd(input.printChargesVnd, 'printChargesVnd');
  const creditAdjustmentsVnd = sumPositiveVnd(input.creditAdjustmentsVnd, 'creditAdjustmentsVnd');
  const paidVnd = sumPositiveVnd(input.settledPaymentsVnd, 'settledPaymentsVnd');
  const refundedVnd = sumPositiveVnd(input.completedRefundsVnd, 'completedRefundsVnd');

  if (refundedVnd > paidVnd) {
    throw new BillingPolicyError(
      'BILLING_LEDGER_INCONSISTENT',
      'Completed refunds cannot exceed proven settled payments.',
    );
  }

  const acceptedBeforeCreditsVnd = addVnd(baseChargesVnd, printChargesVnd);
  const acceptedChargesVnd = Math.max(acceptedBeforeCreditsVnd - creditAdjustmentsVnd, 0);
  const netPaidVnd = paidVnd - refundedVnd;

  return Object.freeze({
    acceptedChargesVnd,
    paidVnd,
    refundedVnd,
    netPaidVnd,
    outstandingVnd: Math.max(acceptedChargesVnd - netPaidVnd, 0),
    creditVnd: Math.max(netPaidVnd - acceptedChargesVnd, 0),
  });
}

export function validateRefund(input: RefundValidationInput): Readonly<{ amountVnd: number }> {
  const amountVnd = requirePositiveVnd(input.amountVnd, 'amountVnd');
  const sourceSettledVnd = requirePositiveVnd(input.sourceSettledVnd, 'sourceSettledVnd');
  const alreadyRefundedFromSourceVnd = requireNonNegativeVnd(
    input.alreadyRefundedFromSourceVnd,
    'alreadyRefundedFromSourceVnd',
  );
  const approvedRefundableVnd = requireNonNegativeVnd(
    input.approvedRefundableVnd,
    'approvedRefundableVnd',
  );
  const alreadyRefundedForDecisionVnd = requireNonNegativeVnd(
    input.alreadyRefundedForDecisionVnd,
    'alreadyRefundedForDecisionVnd',
  );

  if (
    alreadyRefundedFromSourceVnd > sourceSettledVnd ||
    alreadyRefundedForDecisionVnd > approvedRefundableVnd
  ) {
    throw new BillingPolicyError(
      'BILLING_LEDGER_INCONSISTENT',
      'Recorded refunds exceed their settled source or approved decision.',
    );
  }

  const sourceRemainderVnd = sourceSettledVnd - alreadyRefundedFromSourceVnd;
  const decisionRemainderVnd = approvedRefundableVnd - alreadyRefundedForDecisionVnd;
  if (amountVnd > sourceRemainderVnd || amountVnd > decisionRemainderVnd) {
    throw new BillingPolicyError(
      'BILLING_REFUND_LIMIT_EXCEEDED',
      'Refund exceeds the unrefunded settlement or approved refundable amount.',
    );
  }

  return Object.freeze({ amountVnd });
}

export function transitionPaymentAttempt(
  state: PaymentAttemptState,
  evidence: PaymentAttemptEvidence,
): PaymentAttemptState {
  if (state === 'CREATED' && evidence === 'PROVIDER_REQUESTED') return 'PENDING';

  if (state === 'PENDING' || state === 'UNKNOWN') {
    if (evidence === 'VERIFIED_SUCCESS') return 'SUCCEEDED';
    if (evidence === 'VERIFIED_FAILURE') return 'FAILED';
    if (evidence === 'OUTCOME_UNKNOWN') return 'UNKNOWN';
  }

  if (
    (state === 'SUCCEEDED' && evidence === 'VERIFIED_SUCCESS') ||
    (state === 'FAILED' && evidence === 'VERIFIED_FAILURE')
  ) {
    return state;
  }

  if (state === 'SUCCEEDED' || state === 'FAILED') {
    throw new BillingPolicyError(
      'PAYMENT_EVIDENCE_CONFLICT',
      'Terminal payment evidence cannot be changed by a conflicting result.',
    );
  }

  throw new BillingPolicyError(
    'PAYMENT_ATTEMPT_TRANSITION_INVALID',
    `Evidence ${evidence} cannot be applied while an attempt is ${state}.`,
  );
}

function sumPositiveVnd(values: readonly number[], field: string): number {
  return values.reduce((total, value) => addVnd(total, requirePositiveVnd(value, field)), 0);
}

function addVnd(left: number, right: number): number {
  const total = left + right;
  if (!Number.isSafeInteger(total)) {
    throw new BillingPolicyError('BILLING_TOTAL_OVERFLOW', 'Billing total exceeds safe VND range.');
  }
  return total;
}

function requirePositiveVnd(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new BillingPolicyError(
      'BILLING_AMOUNT_INVALID',
      `${field} must be a positive VND integer.`,
    );
  }
  return value;
}

function requireNonNegativeVnd(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new BillingPolicyError(
      'BILLING_AMOUNT_INVALID',
      `${field} must be a nonnegative VND integer.`,
    );
  }
  return value;
}
