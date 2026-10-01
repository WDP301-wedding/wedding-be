import { createHash } from 'node:crypto';

import {
  emailIntentIdempotencyKeySchema,
  emailIntentSchema,
  parseEmailInput,
  sendEmailCommandSchema,
  type EmailIntent,
  type EmailIntentIdempotencyKey,
} from './email.schemas.js';

export interface SendEmailCommand {
  readonly html?: string;
  readonly idempotencyKey: EmailIntentIdempotencyKey;
  readonly subject: string;
  readonly text: string;
  readonly to: readonly string[];
}

export interface SentEmail {
  readonly idempotencyKey: EmailIntentIdempotencyKey;
  readonly messageId: string;
}

export interface EmailProvider {
  send(command: SendEmailCommand): Promise<SentEmail>;
}

export function createEmailIntentIdempotencyKey(intent: EmailIntent): EmailIntentIdempotencyKey {
  const validated = parseEmailInput(emailIntentSchema, intent);
  return parseEmailInput(
    emailIntentIdempotencyKeySchema,
    `${validated.intentType}/${validated.entityId}`,
  );
}

export function validateSendEmailCommand(command: SendEmailCommand): SendEmailCommand {
  const validated = parseEmailInput(sendEmailCommandSchema, command);
  return Object.freeze({
    ...(validated.html === undefined ? {} : { html: validated.html }),
    idempotencyKey: validated.idempotencyKey,
    subject: validated.subject,
    text: validated.text,
    to: Object.freeze([...validated.to]),
  });
}

export function hashSendEmailPayload(command: SendEmailCommand): string {
  const canonicalPayload = JSON.stringify({
    ...(command.html === undefined ? {} : { html: command.html }),
    subject: command.subject,
    text: command.text,
    to: command.to,
  });
  return createHash('sha256').update(canonicalPayload).digest('hex');
}

export function createSentEmail(
  idempotencyKey: EmailIntentIdempotencyKey,
  messageId: string,
): SentEmail {
  return Object.freeze({ idempotencyKey, messageId });
}
