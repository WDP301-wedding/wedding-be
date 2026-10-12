import { z } from 'zod';
import { createHash } from 'node:crypto';
import { AppError, ValidationError } from '../../../core/errors/app-error.js';

export const notificationPurposes = [
  'WORKSPACE_INVITATION',
  'PASSWORD_OTP',
  'ACCESS_PROMOTED',
  'PUBLICATION_CHANGED',
  'GUEST_PLAN',
  'CANCELLATION_NOTICE',
  'TIMELINE_REVIEW',
  'TIMELINE_CHANGED',
  'DEPOSIT_ELIGIBLE',
  'PAYMENT',
  'REFUND',
  'CONTRACT',
  'APPENDIX',
  'FINAL_INVOICE',
  'PRINT',
  'GUEST_INVITATION',
  'MEDIA_CUTOFF',
  'D3_REMINDER',
  'COMPLETION_NOTICE',
] as const;
export const channel = z.enum(['EMAIL', 'ANDROID', 'IN_APP']);
export const purpose = z.enum(notificationPurposes);
export const notificationData = z.strictObject({
  referenceId: z.uuid().toLowerCase().optional(),
  revision: z.int().positive().optional(),
  totalVnd: z.int().nonnegative().optional(),
  eventDate: z.iso.date().optional(),
});
export const intentInput = z
  .strictObject({
    eventId: z.uuid().toLowerCase(),
    owner: z.enum([
      'identity-access',
      'booking-lifecycle',
      'payments-billing',
      'invitation-studio',
      'guest-management',
    ]),
    bookingId: z.uuid().toLowerCase().nullable(),
    recipientId: z.uuid().toLowerCase(),
    channel,
    purpose,
    templateVersion: z.int().positive(),
    scheduledAt: z.iso.datetime(),
    scheduleRevision: z.int().positive().optional(),
    data: notificationData,
  })
  .refine((v) => v.scheduleRevision === undefined || v.bookingId !== null);
export type NotificationInput = z.infer<typeof intentInput>;
export function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError();
  return result.data;
}
export function notificationConflict(code: string) {
  return new AppError({ status: 409, code, message: code });
}
export function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function retryAt(now: Date, attempt: number): Date | undefined {
  if (!Number.isInteger(attempt) || attempt < 1 || !Number.isFinite(now.getTime()))
    throw new ValidationError();
  const seconds = [60, 300, 1800, 7200, 43200][attempt - 1];
  return seconds === undefined ? undefined : new Date(now.getTime() + seconds * 1000);
}
