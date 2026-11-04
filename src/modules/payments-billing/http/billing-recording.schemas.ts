import { z } from 'zod';
const amount = z.int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const recordingQuerySchema = z.strictObject({
  afterRevision: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export const recordingResponseSchema = z.strictObject({
  data: z.strictObject({
    bookingId: z.uuid(),
    bookingRevision: z.int().positive(),
    billingRevision: z.int().nonnegative(),
    deposit: z.strictObject({
      canRecord: z.boolean(),
      amountVnd: amount,
      reasonCode: z.string().nullable(),
      contractRevisionId: z.uuid().nullable(),
      documentDigest: z.string().nullable(),
      timelineRevisionId: z.uuid().nullable(),
    }),
    balance: z.strictObject({
      canRecord: z.boolean(),
      maxAmountVnd: amount,
      reasonCode: z.string().nullable(),
    }),
    refundablePayments: z.array(
      z.strictObject({
        paymentId: z.uuid(),
        revision: z.int().positive(),
        occurredAt: z.iso.datetime(),
        purpose: z.enum(['DEPOSIT', 'BALANCE']).nullable(),
        provider: z.enum(['MANUAL', 'VNPAY']).nullable(),
        amountVnd: amount,
        refundedVnd: amount,
        maxRefundVnd: amount,
      }),
    ),
    nextAfterRevision: z.int().nonnegative().nullable(),
  }),
});
