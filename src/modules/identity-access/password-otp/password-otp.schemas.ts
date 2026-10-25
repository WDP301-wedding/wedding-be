import { z } from 'zod';

export const resetOtpRequestSchema = z.strictObject({ email: z.email().max(320) });
export const changeOtpRequestSchema = z.strictObject({
  currentPassword: z.string().min(1).max(512),
});
export const otpCompletionSchema = z.strictObject({
  challengeId: z.uuid(),
  code: z.string().regex(/^\d{6}$/u),
  newPassword: z.string().min(1).max(128),
});
export const otpRequestResponseSchema = z.strictObject({
  data: z.strictObject({
    accepted: z.literal(true),
    challengeId: z.uuid(),
    expiresInSeconds: z.literal(600),
    resendAfterSeconds: z.literal(60),
  }),
});
export const otpCompletionResponseSchema = z.strictObject({
  data: z.strictObject({ completed: z.literal(true), requiresLogin: z.literal(true) }),
});
