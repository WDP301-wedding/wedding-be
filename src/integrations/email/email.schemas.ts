import { z } from 'zod';

import { ValidationError } from '../../core/errors/app-error.js';

const MAX_EMAIL_BODY_CHARACTERS = 500_000;
const MAX_EMAIL_SUBJECT_CHARACTERS = 998;

const recipientEmailSchema = z.string().trim().pipe(z.email());

export const emailIntentSchema = z.strictObject({
  entityId: z.uuid().transform((value) => value.toLowerCase()),
  intentType: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,63}$/u, 'Use a lowercase event type with hyphens.'),
});

export const emailIntentIdempotencyKeySchema = z
  .string()
  .max(256)
  .regex(
    /^[a-z][a-z0-9-]{0,63}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    'Use an event type and persisted UUID separated by a slash.',
  )
  .brand<'EmailIntentIdempotencyKey'>();

export const sendEmailCommandSchema = z.strictObject({
  html: z.string().min(1).max(MAX_EMAIL_BODY_CHARACTERS).optional(),
  idempotencyKey: emailIntentIdempotencyKeySchema,
  subject: z
    .string()
    .trim()
    .min(1)
    .max(MAX_EMAIL_SUBJECT_CHARACTERS)
    .refine(hasNoLineBreaks, 'Subject must be a single line.'),
  text: z.string().min(1).max(MAX_EMAIL_BODY_CHARACTERS),
  to: z.array(recipientEmailSchema).min(1).max(50),
});

export const resendFromEmailSchema = z
  .string()
  .trim()
  .refine(hasNoLineBreaks, 'Sender address must be a single line.')
  .refine((value) => {
    const displayAddress = value.match(/^[^<>]+<([^<>]+)>$/u);
    const address = displayAddress?.[1] ?? value;
    return z.email().safeParse(address.trim()).success;
  });

const resendHeadersSchema = z.record(z.string(), z.string()).nullable();
const resendErrorSchema = z.object({
  message: z.string(),
  name: z.string().min(1),
  statusCode: z.number().int().min(100).max(599).nullable(),
});

export const resendSendResponseSchema = z.union([
  z.object({
    data: z.object({ id: z.uuid() }),
    error: z.null(),
    headers: resendHeadersSchema,
  }),
  z.object({
    data: z.null(),
    error: resendErrorSchema,
    headers: resendHeadersSchema,
  }),
]);

export type EmailIntent = z.input<typeof emailIntentSchema>;
export type EmailIntentIdempotencyKey = z.infer<typeof emailIntentIdempotencyKeySchema>;

export function parseEmailInput<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
): z.output<TSchema> {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }

  throw new ValidationError(
    result.error.issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      path: issue.path.join('.'),
    })),
  );
}

function hasNoLineBreaks(value: string): boolean {
  return !/[\r\n]/u.test(value);
}
