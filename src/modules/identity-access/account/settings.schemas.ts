import { z } from 'zod';
import { otpCompletionSchema } from '../password-otp/password-otp.schemas.js';

export const profileWriteSchema = z.strictObject({
  displayName: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .overwrite((value) => value.normalize('NFC')),
  expectedRevision: z.number().int().positive(),
});
export const passwordChangeSchema = otpCompletionSchema;
export const profileSchema = z.strictObject({
  accountId: z.uuid(),
  displayEmail: z.email(),
  displayName: z.string().nullable(),
  revision: z.number().int().positive(),
});
export const profileResponseSchema = z.strictObject({ data: profileSchema });
export const passwordChangedResponseSchema = z.strictObject({
  data: z.strictObject({ completed: z.literal(true), requiresLogin: z.literal(true) }),
});
