import { z } from 'zod';
import { balancePaymentBlockActions } from '../application/balance-payment-eligibility.js';

const uuid = z.uuid();
const revision = z.int().positive();
const vnd = z.int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const instant = z.iso.datetime({ offset: true });
const evidence = {
  reason: z.string().trim().min(1).max(500),
  evidenceReference: z.string().trim().min(1).max(120),
};
export const bookingParamsSchema = z.strictObject({ bookingId: uuid });
export const attemptParamsSchema = z.strictObject({ bookingId: uuid, attemptId: uuid });
export const depositBodySchema = z.strictObject({
  timelineRevisionId: uuid,
  contractRevisionId: uuid.optional(),
  documentDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
export const balanceBodySchema = z.strictObject({ expectedBillingRevision: revision });
export const manualBodySchema = z.strictObject({
  bookingId: uuid,
  purpose: z.enum(['DEPOSIT', 'BALANCE']),
  contractRevisionId: uuid.optional(),
  documentDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  amountVnd: vnd.positive(),
  settledAt: instant,
  ...evidence,
});
export const refundBodySchema = z.strictObject({
  sourcePaymentId: uuid,
  amountVnd: vnd.positive(),
  expectedBillingRevision: revision,
  ...evidence,
});
export const refundApprovalBodySchema = z.strictObject({
  bookingId: uuid,
  expectedBillingRevision: revision,
  approvedRefundableVnd: vnd.positive(),
  basis: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('CREDIT'), sourceEntryId: uuid }),
    z.strictObject({ kind: z.literal('CANCELLATION') }),
  ]),
  ...evidence,
});
const queryInteger = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .transform(Number);
export const billingQuerySchema = z.strictObject({
  limit: queryInteger.pipe(z.int().min(1).max(100)).default(25),
  throughBillingRevision: queryInteger.pipe(z.int().nonnegative()).optional(),
  cursor: z.string().min(1).max(512).optional(),
});
export const checkoutResponseSchema = z.strictObject({
  data: z.strictObject({
    paymentAttemptId: uuid,
    status: z.enum(['CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'UNKNOWN']),
    checkoutUrl: z.url(),
    expiresAt: instant,
  }),
});
export const attemptResponseSchema = z.strictObject({
  data: z.strictObject({
    paymentAttemptId: uuid,
    status: z.enum(['CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'UNKNOWN']),
    purpose: z.enum(['DEPOSIT', 'BALANCE']),
    amountVnd: vnd.positive(),
    invoiceRevisionId: uuid.optional(),
    invoiceDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    sourceBillingRevision: revision.optional(),
    applicationStatus: z.enum(['PENDING', 'SUCCEEDED']).nullable(),
    expiresAt: instant,
  }),
});
export const paymentResponseSchema = z.strictObject({
  data: z.strictObject({ paymentId: uuid, paymentAttemptId: uuid }),
});
export const refundResponseSchema = z.strictObject({ data: z.strictObject({ refundId: uuid }) });
export const refundApprovalResponseSchema = z.strictObject({
  data: z.strictObject({ refundApprovalId: uuid }),
});
export const billingTotalsSchema = z.strictObject({
  acceptedChargesVnd: vnd,
  paidVnd: vnd,
  refundedVnd: vnd,
  netPaidVnd: vnd,
  outstandingVnd: vnd,
  creditVnd: vnd,
});
export const historyEntrySchema = z.strictObject({
  ledgerEntryId: uuid,
  kind: z.enum(['CHARGE', 'PAYMENT', 'REFUND', 'CREDIT_ADJUSTMENT']),
  amountVnd: vnd.positive(),
  occurredAt: instant,
  sourceType: z.enum([
    'BASE_BOOKING',
    'CONTRACT',
    'CONTRACT_APPENDIX',
    'INCIDENTAL_FINALIZATION',
    'INVOICE_ADJUSTMENT',
    'PRINT_ORDER',
    'PAYMENT_ATTEMPT',
    'PRINT_CREDIT',
    'MANUAL_REFUND',
  ]),
  sourceRevisionId: uuid,
  sourceEntryId: uuid.nullable(),
  paymentAttemptId: uuid.nullable(),
  revision,
});
export const balancePaymentEligibilitySchema = z.discriminatedUnion('canPay', [
  z.strictObject({
    canPay: z.literal(true),
    reasonCode: z.null(),
    nextAction: z.literal('PAY_BALANCE'),
    billingRevision: z.int().nonnegative(),
  }),
  z
    .strictObject({
      canPay: z.literal(false),
      reasonCode: z.enum(
        Object.keys(balancePaymentBlockActions) as (keyof typeof balancePaymentBlockActions)[],
      ),
      nextAction: z.enum([
        'CONTACT_RESTAURANT',
        'WAIT_FOR_FINAL_INVOICE',
        'CHECK_EXISTING_PAYMENT',
        'NONE',
        'REFRESH_BILLING',
      ]),
      billingRevision: z.int().nonnegative(),
    })
    .refine((value) => balancePaymentBlockActions[value.reasonCode] === value.nextAction),
]);
export const billingResponseSchema = z.strictObject({
  data: z.strictObject({
    bookingId: uuid,
    billingRevision: z.int().nonnegative(),
    totals: billingTotalsSchema,
    history: z.array(historyEntrySchema),
    nextCursor: z.string().nullable(),
    balancePaymentEligibility: balancePaymentEligibilitySchema,
  }),
});
export const ipnResponseSchema = z.strictObject({
  RspCode: z.enum(['00', '01', '02', '04', '97', '99']),
  Message: z.string(),
});
