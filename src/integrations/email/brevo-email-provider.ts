import { createHash } from 'node:crypto';

import { z } from 'zod';

import { AppError, ProviderError } from '../../core/errors/app-error.js';
import { resendFromEmailSchema } from './email.schemas.js';
import {
  createSentEmail,
  validateSendEmailCommand,
  type EmailProvider,
  type SendEmailCommand,
  type SentEmail,
} from './email-provider.js';

const sendResponseSchema = z.object({ messageId: z.string().trim().min(1) });

export interface BrevoEmailConfiguration {
  readonly apiKey: string;
  readonly fromEmail: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}

export class BrevoEmailProvider implements EmailProvider {
  readonly #apiKey: string;
  readonly #sender: Readonly<{ email: string; name?: string }>;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(configuration: BrevoEmailConfiguration) {
    const fromEmail = resendFromEmailSchema.safeParse(configuration.fromEmail);
    if (!fromEmail.success) {
      throw new TypeError('Brevo sender email configuration is invalid.');
    }
    if (configuration.apiKey.trim() === '' || /[\r\n]/u.test(configuration.apiKey)) {
      throw new TypeError('Brevo API key configuration is invalid.');
    }
    const timeoutMs = configuration.timeoutMs ?? 10_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) {
      throw new TypeError('Brevo timeout must be between 1 and 60000 milliseconds.');
    }
    const displayAddress = fromEmail.data.match(/^([^<>]+)<([^<>]+)>$/u);
    this.#sender = Object.freeze({
      email: (displayAddress?.[2] ?? fromEmail.data).trim(),
      ...(displayAddress === null ? {} : { name: displayAddress[1]?.trim() ?? '' }),
    });
    this.#apiKey = configuration.apiKey.trim();
    this.#timeoutMs = timeoutMs;
    this.#fetch = configuration.fetch ?? globalThis.fetch;
  }

  async send(command: SendEmailCommand): Promise<SentEmail> {
    const validated = validateSendEmailCommand(command);
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new ProviderError('timeout'));
        controller.abort();
      }, this.#timeoutMs);
    });
    try {
      const operation = async () => {
        const response = await this.#fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'api-key': this.#apiKey,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          redirect: 'error',
          signal: controller.signal,
          body: JSON.stringify({
            sender: this.#sender,
            to: validated.to.map((email) => ({ email })),
            subject: validated.subject,
            textContent: validated.text,
            ...(validated.html === undefined ? {} : { htmlContent: validated.html }),
            headers: { idempotencyKey: intentUuid(validated.idempotencyKey) },
          }),
        });
        if (!response.ok) {
          throw new ProviderError(
            response.status === 429 || response.status >= 500 ? 'unavailable' : 'failure',
          );
        }
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          throw new ProviderError('failure');
        }
        const parsed = sendResponseSchema.safeParse(body);
        if (!parsed.success) throw new ProviderError('failure');
        return createSentEmail(validated.idempotencyKey, parsed.data.messageId);
      };
      return await Promise.race([operation(), timeout]);
    } catch (error: unknown) {
      if (error instanceof AppError) throw error;
      throw new ProviderError('unavailable');
    } finally {
      clearTimeout(timer);
    }
  }
}

// Brevo requires a UUID; hash the full intent to keep retries stable and event types distinct.
function intentUuid(idempotencyKey: string): string {
  const hash = createHash('sha1')
    .update(Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex'))
    .update(`wedding.brevo.email.v1/${idempotencyKey}`)
    .digest('hex');
  const variant = ((Number.parseInt(hash[16] ?? '0', 16) & 3) | 8).toString(16);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${variant}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
