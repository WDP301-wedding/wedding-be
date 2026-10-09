import { z } from 'zod';
import { containsAuthenticationMaterial } from '../../../core/security/authentication-material.js';
import { id } from './studio-policy.js';

export const generationIntentDigest = z.string().regex(/^[a-f0-9]{64}$/u);
export const generationRecoveryQuery = z.strictObject({
  cursor: generationIntentDigest.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const generationReconcileBody = z.strictObject({
  outcome: z.literal('ABANDONED'),
  evidenceReference: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/u)
    .refine((value) => !containsAuthenticationMaterial(value)),
});
export const generationReconcileCommand = generationReconcileBody.extend({
  bookingId: id,
  intentDigest: generationIntentDigest,
  idempotencyKey: z.string(),
});
export const generationPendingResponse = z.strictObject({
  data: z.strictObject({
    items: z
      .array(
        z.strictObject({
          intentDigest: generationIntentDigest,
          status: z.literal('PENDING'),
          createdAt: z.iso.datetime(),
        }),
      )
      .max(100),
    nextCursor: generationIntentDigest.nullable(),
  }),
});
export const generationReconcileResponse = z.strictObject({
  data: z.strictObject({
    intentDigest: generationIntentDigest,
    status: z.literal('FAILED'),
    outcome: z.literal('ABANDONED'),
  }),
});
