import { z } from 'zod';
import { purpose, notificationData } from '../domain/notification-policy.js';
export const id = z.uuid().toLowerCase();
export const expected = z.int().nonnegative();
export const revisionBody = z.strictObject({ expectedRevision: expected });
export const preferencesBody = revisionBody
  .extend({ reminderEmail: z.boolean().optional(), reminderPush: z.boolean().optional() })
  .refine((v) => v.reminderEmail !== undefined || v.reminderPush !== undefined);
export const preferencesDto = z.strictObject({
  revision: expected,
  reminderEmail: z.boolean(),
  reminderPush: z.boolean(),
});
export const installationBody = revisionBody.extend({
  installationId: id,
  pushToken: z
    .string()
    .min(1)
    .max(4096)
    .regex(/^\S+$/u)
    .refine((v) => !v.includes(String.fromCharCode(0))),
});
export const installationDto = z.strictObject({
  id,
  installationId: id,
  revision: z.int().positive(),
  enabled: z.boolean(),
});
export const state = z.enum([
  'QUEUED',
  'IN_FLIGHT',
  'DELIVERED',
  'PROVIDER_ACCEPTED',
  'RETRYABLE_FAILED',
  'UNKNOWN',
  'DEAD_LETTER',
  'SKIPPED_STALE',
  'CANCELLED',
]);
export const listQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(25),
  cursor: id.optional(),
});
export const managementQuery = listQuery.extend({
  purpose: purpose.optional(),
  state: state.optional(),
});
export const statusDto = z.strictObject({
  id,
  eventId: id,
  bookingId: id.nullable(),
  channel: z.enum(['EMAIL', 'IN_APP', 'ANDROID']),
  purpose,
  state,
  revision: z.int().positive(),
  attemptCount: z.int().nonnegative(),
  scheduledAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  lastErrorCode: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{0,79}$/u)
    .nullable(),
});
export const requeueBody = revisionBody.extend({
  reason: z.string().trim().normalize('NFC').min(1).max(500),
});
export const registryBody = revisionBody.extend({
  enabled: z.boolean(),
  purposes: z.array(purpose).min(1).max(30),
  intendedEmail: z.email().max(320).optional(),
});
export const registryDto = z.strictObject({
  id,
  operational: z.boolean(),
  enabled: z.boolean(),
  purposes: z.array(purpose),
  revision: z.int().positive(),
});
export const inboxDto = z.strictObject({
  id,
  notificationIntentId: id,
  purpose,
  title: z.string(),
  message: z.string(),
  createdAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
  revision: z.int().positive(),
  resource: z.strictObject({
    bookingId: id.nullable(),
    owner: z.enum([
      'identity-access',
      'booking-lifecycle',
      'payments-billing',
      'invitation-studio',
      'guest-management',
    ]),
    data: notificationData,
  }),
});
export const readAllBody = z.strictObject({ throughCreatedAt: z.iso.datetime() });
export const guestDeliveryBody = z.strictObject({
  expectedRevision: expected,
  intendedEmail: z.email().max(254),
});
export const guestDeliveryDto = z.strictObject({
  credentialId: id,
  revision: z.int().positive(),
  expiresAt: z.iso.datetime(),
  notificationIntentId: id,
});
export const result = <T extends z.ZodType>(schema: T) => z.strictObject({ data: schema });
export const page = <T extends z.ZodType>(schema: T) =>
  z.strictObject({ items: z.array(schema), nextCursor: id.nullable() });
