import { z } from 'zod';
import type { ZodOpenApiObject } from 'zod-openapi';
import {
  depositBodySchema,
  balanceBodySchema,
  manualBodySchema,
  refundBodySchema,
  refundApprovalBodySchema,
  checkoutResponseSchema,
  paymentResponseSchema,
  refundResponseSchema,
  refundApprovalResponseSchema,
  attemptResponseSchema,
  activeAttemptsResponseSchema,
  billingResponseSchema,
  balancePaymentEligibilitySchema,
  ipnResponseSchema,
  queryEvidenceBodySchema,
  queryRequestResponseSchema,
} from './payments-billing.schemas.js';
import { vnpayIpnFieldsSchema } from '../infrastructure/vnpay.protocol.js';

const ipnParameters = [
  ...Object.entries(vnpayIpnFieldsSchema.shape).map(([name, schema]) =>
    schema.meta({ param: { name, in: 'query', required: !schema.isOptional() } }),
  ),
  z
    .string()
    .regex(/^[\da-f]{128}$/iu)
    .meta({ param: { name: 'vnp_SecureHash', in: 'query', required: true } }),
  ...['vnp_BankTranNo', 'vnp_CardType', 'vnp_SecureHashType'].map((name) =>
    z
      .string()
      .max(512)
      .optional()
      .meta({ param: { name, in: 'query', required: false } }),
  ),
];

const bearer = [{ bearerAuth: [] }];
const path = (name: string) => ({
  name,
  in: 'path' as const,
  required: true,
  schema: { type: 'string' as const, format: 'uuid' },
});
const booking = [path('bookingId')];
const response = (description: string, schema: z.ZodType) => ({
  description,
  content: { 'application/json': { schema } },
  headers: {
    'Cache-Control': { schema: { type: 'string' as const, const: 'no-store' } },
    'x-request-id': { $ref: '#/components/headers/RequestId' },
  },
});
const errors = {
  '400': { $ref: '#/components/responses/IdempotencyKeyRequired' },
  '401': { $ref: '#/components/responses/Unauthorized' },
  '403': { $ref: '#/components/responses/Forbidden' },
  '404': { $ref: '#/components/responses/NotFound' },
  '409': { $ref: '#/components/responses/Conflict' },
  '422': { $ref: '#/components/responses/UnprocessableEntity' },
  '500': { $ref: '#/components/responses/InternalServerError' },
  '503': { $ref: '#/components/responses/ServiceUnavailable' },
};
function mutation(
  operationId: string,
  summary: string,
  body: z.ZodType,
  result: z.ZodType,
  parameters: ReturnType<typeof path>[] = [],
) {
  return {
    operationId,
    summary,
    tags: ['Payments and Billing'],
    security: bearer,
    parameters: [...parameters, { $ref: '#/components/parameters/IdempotencyKey' }],
    requestBody: { required: true, content: { 'application/json': { schema: body } } },
    responses: {
      '201': response(
        'The durable billing command completed. Exact replay returns the original result; current authorization is rechecked.',
        result,
      ),
      ...errors,
    },
  };
}
export const paymentsBillingOpenApiPaths: NonNullable<ZodOpenApiObject['paths']> = {
  '/bookings/{bookingId}/payments/active': {
    get: {
      operationId: 'getActivePaymentAttempts',
      summary:
        'Discover unresolved payment attempts without a browser-stored attempt ID. Owning RESTRICTED Couple sees deposits only; FULL Couple and Manager see deposits and balances.',
      description:
        'Read-only discovery returns at most two CREATED/PENDING/UNKNOWN attempts or verified VNPay successes awaiting ledger/deposit application, newest first. Applied successes and failures are excluded. Expired unresolved attempts remain visible. No checkout, provider query, settlement or release is performed. Read each existing payment attempt by ID to reconcile, retry interrupted application and recover an unexpired checkoutUrl. An empty list does not prove a previous payment failed. Provider evidence and checkout parameters are excluded.',
      tags: ['Payments and Billing'],
      security: bearer,
      parameters: booking,
      responses: {
        '200': response('Authorized unresolved attempts; no-store.', activeAttemptsResponseSchema),
        ...errors,
      },
    },
  },
  '/bookings/{bookingId}/payments/deposit': {
    post: mutation(
      'createDepositPayment',
      'Start VNPay deposit for an owned eligible RESTRICTED or FULL booking. FULL_CONTRACT_V1 requires exact contractRevisionId and documentDigest, dual commercial/timeline approvals and ceil(30% full total). Legacy bodies and settlements retain original semantics. Amount is server-owned.',
      depositBodySchema,
      checkoutResponseSchema,
      booking,
    ),
  },
  '/bookings/{bookingId}/payments/balance': {
    post: mutation(
      'createBalancePayment',
      'Start VNPay full outstanding balance for own FULL access or Manager at the expected billing revision.',
      balanceBodySchema,
      checkoutResponseSchema,
      booking,
    ),
  },
  '/management/billing/payments/manual': {
    post: mutation(
      'recordManualPayment',
      'Manager records a verified receipt. Deposit timeline and balance revision are resolved from authoritative state.',
      manualBodySchema,
      paymentResponseSchema,
    ),
  },
  '/management/billing/refund-approvals': {
    post: mutation(
      'approveBillingRefund',
      'Manager explicitly approves a bounded refund against an accepted credit or server-resolved Booking cancellation. No money is refunded by approval.',
      refundApprovalBodySchema,
      refundApprovalResponseSchema,
    ),
  },
  '/management/billing/refunds': {
    post: mutation(
      'recordBillingRefund',
      'Manager records a manual refund against an existing approved cancellation or credit decision. Source and approval caps are rechecked transactionally.',
      refundBodySchema,
      refundResponseSchema,
    ),
  },
  '/bookings/{bookingId}/payments/{attemptId}/query': {
    get: {
      operationId: 'preparePaymentQuery',
      summary:
        'Authorize an owned attempt and prepare its read-only signed sandbox query. Durable five-minute cooldown; terminal attempts return null. Never log the signed request.',
      tags: ['Payments and Billing'],
      security: bearer,
      parameters: [...booking, path('attemptId')],
      responses: {
        '200': response(
          'Signed provider query or null for a terminal attempt.',
          queryRequestResponseSchema,
        ),
        ...errors,
        '429': { $ref: '#/components/responses/TooManyRequests' },
      },
    },
  },
  '/bookings/{bookingId}/payments/{attemptId}/evidence': {
    post: {
      operationId: 'reconcilePaymentEvidence',
      summary:
        'Submit relayed querydr evidence for an owned attempt. Backend verifies provider HMAC, merchant, order and amount before serialized idempotent settlement. Unverified replies retain UNKNOWN. ReturnURL parameters are not accepted as settlement.',
      tags: ['Payments and Billing'],
      security: bearer,
      parameters: [...booking, path('attemptId')],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: queryEvidenceBodySchema } },
      },
      responses: {
        '200': response(
          'Authoritative attempt and downstream application status.',
          attemptResponseSchema,
        ),
        ...errors,
      },
    },
  },
  '/bookings/{bookingId}/payments/{attemptId}': {
    get: {
      operationId: 'getPaymentAttempt',
      summary:
        'Read owned deposit status with RESTRICTED/FULL access or balance status with FULL access; Managers can read either. Reopens an unexpired VNPay checkout. After expiry plus 15 minutes, authenticated missing-order or unpaid evidence resolves FAILED; unverified outcomes remain UNKNOWN.',
      tags: ['Payments and Billing'],
      security: bearer,
      parameters: [
        ...booking,
        path('attemptId'),
        {
          name: 'reconcile',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: ['false'] },
          description:
            'Read persisted status and the original unexpired checkout without querying VNPay. Terminal downstream application may still be recovered idempotently.',
        },
      ],
      responses: {
        '200': response(
          'Safe attempt and downstream application status. ReturnURL never proves settlement.',
          attemptResponseSchema,
        ),
        ...errors,
      },
    },
  },
  '/bookings/{bookingId}/billing': {
    get: {
      operationId: 'getBookingBilling',
      summary:
        'Read exact ledger totals and ascending revision history with own FULL access or Manager. Pagination binds the booking and a fixed billing revision.',
      description:
        'Includes advisory VNPay balancePaymentEligibility computed in the authorized booking snapshot. A missing final invoice blocks full-contract checkout without failing this GET. Historical ledger pages report STALE_BILLING_REVISION with the current billing revision. POST balance still revalidates all authority, invoice, attempt and amount facts; canPay does not reserve or settle money or prove provider availability.',
      tags: ['Payments and Billing'],
      security: bearer,
      parameters: [
        ...booking,
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
        },
        {
          name: 'throughBillingRevision',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 0 },
        },
        {
          name: 'cursor',
          in: 'query',
          required: false,
          schema: { type: 'string', minLength: 1, maxLength: 512 },
        },
      ],
      responses: {
        '200': response(
          'Private evidence and provider material are excluded. RESTRICTED callers use deposit attempt status.',
          billingResponseSchema,
        ),
        ...errors,
      },
    },
  },
  '/billing/callbacks/vnpay': {
    get: {
      operationId: 'receiveVnpayIpn',
      summary:
        'Authoritative VNPay 2.1.0 GET IPN. Verify raw canonical query before trusting provider data; duplicate keys are rejected.',
      description:
        'Provider-defined vnp_* parameters including vnp_TxnRef, vnp_Amount, vnp_TmnCode, vnp_ResponseCode, vnp_TransactionStatus and vnp_SecureHash. HTTP 200 acknowledgement codes: 00 processed, 02 already processed, 01 unknown order, 04 amount mismatch, 97 invalid signature, 99 processing failure. Durable evidence acknowledgment can precede downstream application. ReturnURL is display-only.',
      tags: ['Payments and Billing'],
      security: [],
      parameters: ipnParameters,
      responses: {
        '200': response(
          'Provider acknowledgment, explicitly outside the application envelope.',
          ipnResponseSchema,
        ),
      },
    },
  },
};
export const paymentsBillingOpenApiSchemas = {
  BillingDepositBody: depositBodySchema,
  BillingBalanceBody: balanceBodySchema,
  BillingManualPaymentBody: manualBodySchema,
  BillingRefundBody: refundBodySchema,
  BillingRefundApprovalBody: refundApprovalBodySchema,
  BillingCheckoutResponse: checkoutResponseSchema,
  BillingPaymentResponse: paymentResponseSchema,
  BillingRefundResponse: refundResponseSchema,
  BillingRefundApprovalResponse: refundApprovalResponseSchema,
  BillingAttemptResponse: attemptResponseSchema,
  BillingQueryRequestResponse: queryRequestResponseSchema,
  BillingQueryEvidenceBody: queryEvidenceBodySchema,
  BillingActiveAttemptsResponse: activeAttemptsResponseSchema,
  BookingBillingResponse: billingResponseSchema,
  BalancePaymentEligibility: balancePaymentEligibilitySchema,
  BillingIpnResponse: ipnResponseSchema,
};
