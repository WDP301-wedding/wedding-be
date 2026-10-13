import { z } from 'zod';
import { channelSchema, stateSchema } from '../domain/notification-policy.js';
export const preferenceSchema = z.strictObject({
  revision: z.int().nonnegative(),
  reminderEmail: z.boolean(),
  reminderPush: z.boolean(),
});
export const installationSchema = z.strictObject({
  installationId: z.uuid(),
  revision: z.int().positive(),
  active: z.boolean(),
});
export const recipientSchema = z.strictObject({
  bookingId: z.uuid(),
  accountId: z.uuid(),
  purpose: z.enum(['OPERATIONS', 'FINANCE', 'PRINT']),
  enabled: z.boolean(),
  revision: z.int().positive(),
});
export const deliverySchema = z.strictObject({
  notificationIntentId: z.uuid(),
  credentialId: z.uuid(),
  revision: z.int().positive(),
  expiresAt: z.iso.datetime(),
});
export const readSchema = z.strictObject({
  notificationIntentId: z.uuid(),
  readAt: z.iso.datetime(),
  revision: z.int().positive(),
});
export const recoverySchema = z.strictObject({
  notificationIntentId: z.uuid(),
  state: stateSchema,
  revision: z.int().positive(),
});
export const inboxItem = z.strictObject({
  notificationIntentId: z.uuid(),
  bookingId: z.uuid(),
  purpose: z.string().max(100),
  title: z.string().max(120),
  target: z.strictObject({
    screen: z.enum(['BOOKING', 'TIMELINE', 'PAYMENTS', 'INVITATION', 'GUESTS']),
    bookingId: z.uuid(),
    referenceId: z.uuid().nullable(),
  }),
  createdAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
  revision: z.int().positive(),
});
export const inboxSchema = z.strictObject({
  items: z.array(inboxItem).max(100),
  nextCursor: z.uuid().nullable(),
  unreadCount: z.int().nonnegative(),
});
export const operationsItem = z.strictObject({
  notificationIntentId: z.uuid(),
  eventId: z.uuid(),
  bookingId: z.uuid(),
  purpose: z.string().max(100),
  channel: channelSchema,
  state: stateSchema,
  revision: z.int().positive(),
  attemptCount: z.int().nonnegative(),
  scheduledAt: z.iso.datetime(),
  hasProviderReceipt: z.boolean(),
});
export const operationsSchema = z.strictObject({
  items: z.array(operationsItem).max(100),
  nextCursor: z.uuid().nullable(),
});
