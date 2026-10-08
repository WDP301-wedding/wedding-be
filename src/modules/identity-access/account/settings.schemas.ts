import { z } from 'zod';

export const profileWriteSchema = z.strictObject({
  displayName: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .overwrite((value) => value.normalize('NFC')),
  expectedRevision: z.number().int().positive(),
});
export const passwordChangeSchema = z.strictObject({
  currentPassword: z.string().min(1).max(512),
  newPassword: z.string().min(12).max(128),
});
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
