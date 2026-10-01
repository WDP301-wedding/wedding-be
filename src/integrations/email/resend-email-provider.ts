import { Resend } from 'resend';

import {
  AppError,
  IdempotencyKeyReusedError,
  ProviderError,
  RequestInProgressError,
} from '../../core/errors/app-error.js';
import { resendFromEmailSchema, resendSendResponseSchema } from './email.schemas.js';
import {
  createSentEmail,
  validateSendEmailCommand,
  type EmailProvider,
  type SendEmailCommand,
  type SentEmail,
} from './email-provider.js';

const DEFAULT_PROVIDER_TIMEOUT_MS = 10_000;

interface ResendSendPayload {
  readonly from: string;
  readonly html?: string;
  readonly subject: string;
  readonly text: string;
  readonly to: string[];
}

interface ResendSendOptions {
  readonly idempotencyKey: string;
}

export interface ResendEmailClientLike {
  readonly emails: {
    send(payload: ResendSendPayload, options: ResendSendOptions): Promise<unknown>;
  };
}

interface ResendEmailProviderOptions {
  readonly client: ResendEmailClientLike;
  readonly fromEmail: string;
  readonly timeoutMs?: number;
}

export interface ResendEmailConfiguration {
  readonly apiKey: string;
  readonly fromEmail: string;
  readonly timeoutMs?: number;
}

export class ResendEmailProvider implements EmailProvider {
  readonly #client: ResendEmailClientLike;
  readonly #fromEmail: string;
  readonly #timeoutMs: number;

  constructor(options: ResendEmailProviderOptions) {
    const fromEmail = resendFromEmailSchema.safeParse(options.fromEmail);
    if (!fromEmail.success) {
      throw new TypeError('Resend sender email configuration is invalid.');
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) {
      throw new TypeError('Resend timeout must be between 1 and 60000 milliseconds.');
    }

    this.#client = options.client;
    this.#fromEmail = fromEmail.data;
    this.#timeoutMs = timeoutMs;
  }

  async send(command: SendEmailCommand): Promise<SentEmail> {
    const validated = validateSendEmailCommand(command);
    const response = await this.#invoke(() =>
      this.#client.emails.send(
        {
          from: this.#fromEmail,
          ...(validated.html === undefined ? {} : { html: validated.html }),
          subject: validated.subject,
          text: validated.text,
          to: [...validated.to],
        },
        { idempotencyKey: validated.idempotencyKey },
      ),
    );
    const parsed = resendSendResponseSchema.safeParse(response);
    if (!parsed.success) {
      throw new ProviderError('failure');
    }
    if (parsed.data.error !== null) {
      throw normalizeReturnedProviderError(parsed.data.error);
    }

    return createSentEmail(validated.idempotencyKey, parsed.data.data.id);
  }

  async #invoke(operation: () => Promise<unknown>): Promise<unknown> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new ResendProviderTimeoutError()), this.#timeoutMs);
    });

    try {
      return await Promise.race([operation(), timeout]);
    } catch (error: unknown) {
      if (error instanceof AppError) {
        throw error;
      }
      throw normalizeThrownProviderError(error);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }
}

export function createResendEmailProvider(
  configuration: ResendEmailConfiguration,
): ResendEmailProvider {
  if (configuration.apiKey.trim() === '') {
    throw new TypeError('Resend API key configuration is invalid.');
  }

  return new ResendEmailProvider({
    client: new Resend(configuration.apiKey),
    fromEmail: configuration.fromEmail,
    ...(configuration.timeoutMs === undefined ? {} : { timeoutMs: configuration.timeoutMs }),
  });
}

function normalizeReturnedProviderError(error: {
  readonly name: string;
  readonly statusCode: number | null;
}): AppError {
  if (error.name === 'invalid_idempotent_request') {
    return new IdempotencyKeyReusedError();
  }
  if (error.name === 'concurrent_idempotent_requests') {
    return new RequestInProgressError(1);
  }
  if (
    error.statusCode === 429 ||
    (error.statusCode !== null && error.statusCode >= 500) ||
    (error.statusCode === null && error.name === 'application_error')
  ) {
    return new ProviderError('unavailable');
  }
  return new ProviderError('failure');
}

function normalizeThrownProviderError(error: unknown): ProviderError {
  if (error instanceof ResendProviderTimeoutError || hasErrorName(error, 'AbortError')) {
    return new ProviderError('timeout');
  }
  const status = providerStatus(error);
  return new ProviderError(
    status === 429 || (status !== undefined && status >= 500) ? 'unavailable' : 'failure',
  );
}

function providerStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const candidate = error as { readonly status?: unknown; readonly statusCode?: unknown };
  const rawStatus = candidate.status ?? candidate.statusCode;
  if (typeof rawStatus === 'number' && Number.isInteger(rawStatus)) {
    return rawStatus;
  }
  if (typeof rawStatus === 'string' && /^\d{3}$/u.test(rawStatus)) {
    return Number(rawStatus);
  }
  return undefined;
}

function hasErrorName(error: unknown, name: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { readonly name?: unknown }).name === name
  );
}

class ResendProviderTimeoutError extends Error {}
