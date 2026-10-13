import { z } from 'zod';
import { AppError, ValidationError } from '../../../core/errors/app-error.js';

export const states = [
  'QUEUED',
  'IN_FLIGHT',
  'DELIVERED',
  'RETRYABLE_FAILED',
  'UNKNOWN',
  'DEAD_LETTER',
  'SKIPPED_STALE',
  'CANCELLED',
] as const;
export const stateSchema = z.enum(states);
export const channelSchema = z.enum(['EMAIL', 'PUSH']);
export const preferencesInput = z.strictObject({
  expectedRevision: z.int().nonnegative(),
  reminderEmail: z.boolean(),
  reminderPush: z.boolean(),
});
export const installationInput = z.strictObject({
  installationId: z.uuid(),
  pushToken: z.string().min(20).max(4096),
});
export const revisionInput = z.strictObject({ expectedRevision: z.int().positive() });
export const requeueInput = revisionInput.extend({ reason: z.string().trim().min(1).max(500) });
export const resolutionInput = requeueInput.extend({
  outcome: z.enum(['DELIVERED', 'NOT_SENT']),
  evidenceReference: z.string().trim().min(1).max(256),
});
export const registryInput = z.strictObject({
  accountId: z.uuid(),
  purpose: z.enum(['OPERATIONS', 'FINANCE', 'PRINT']),
  enabled: z.boolean(),
  expectedRevision: z.int().nonnegative(),
});
export const deliveryInput = z.strictObject({
  intendedEmail: z.email().max(254),
  expectedRevision: z.int().nonnegative(),
});
export const pageInput = z.strictObject({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const operationsInput = pageInput.extend({
  state: stateSchema.optional(),
  purpose: z.string().min(1).max(100).optional(),
});
export const RETRY_MS = [60000, 300000, 1800000, 7200000, 43200000] as const;
export const TEMPLATE_VERSION = 'ntf-v1';
export function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ValidationError(
      result.error.issues.map((i) => ({
        code: i.code,
        path: i.path.join('.'),
        message: i.message,
      })),
    );
  return result.data;
}
export function conflict(code = 'NOTIFICATION_REVISION_STALE') {
  return new AppError({
    status: 409,
    code,
    message: 'The notification command conflicts with its saved revision or outcome.',
  });
}
export function forbidden() {
  return new AppError({
    status: 403,
    code: 'FORBIDDEN',
    message: 'Notification access is not permitted.',
  });
}
export function failureOutcome(
  code: string | undefined,
): 'UNKNOWN' | 'RETRYABLE_FAILED' | 'DEAD_LETTER' {
  // A network/5xx error may have happened after acceptance. Only explicit pre-send
  // rejection is retryable; never infer failure from absence of a response.
  if (code === 'NOTIFICATION_RETRYABLE') return 'RETRYABLE_FAILED';
  if (code === 'NOTIFICATION_PERMANENT') return 'DEAD_LETTER';
  return 'UNKNOWN';
}
