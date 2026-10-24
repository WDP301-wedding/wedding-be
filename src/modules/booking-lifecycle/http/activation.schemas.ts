import { z } from 'zod';
export const activationParams = z.strictObject({ consultationId: z.uuid() });
export const activationBody = z.strictObject({ expectedRevision: z.int().positive() });
export const activationResponse = z.strictObject({
  data: z.strictObject({
    consultationId: z.uuid(),
    consultationRevision: z.int().positive(),
    recipientEmail: z.string(),
    state: z.enum([
      'NOT_ISSUED',
      'DELIVERY_PENDING',
      'AWAITING_ACCEPTANCE',
      'EXPIRED',
      'REVOKED',
      'ACTIVATED',
      'ACCOUNT_UNAVAILABLE',
      'ACCESS_UNAVAILABLE',
    ]),
    expiresAt: z.iso.datetime().nullable(),
    acceptedAt: z.iso.datetime().nullable(),
    canSend: z.boolean(),
  }),
});
export const activationSentResponse = z.strictObject({
  data: z.strictObject({ invitationId: z.uuid(), state: z.literal('ISSUED') }),
});
