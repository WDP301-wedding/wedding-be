import { describe, expect, it, vi } from 'vitest';

import {
  IdempotencyKeyReusedError,
  ProviderError,
  RequestInProgressError,
  ValidationError,
} from '../../core/errors/app-error.js';
import { FakeEmailProvider } from './fake-email-provider.js';
import { createEmailIntentIdempotencyKey, type SendEmailCommand } from './email-provider.js';
import {
  createResendEmailProvider,
  ResendEmailProvider,
  type ResendEmailClientLike,
} from './resend-email-provider.js';

const entityId = '11111111-1111-4111-8111-111111111111';
const providerMessageId = '22222222-2222-4222-8222-222222222222';

function validCommand(): SendEmailCommand {
  return {
    html: '<p>Your booking is confirmed.</p>',
    idempotencyKey: createEmailIntentIdempotencyKey({
      entityId,
      intentType: 'booking-confirmed',
    }),
    subject: 'Booking confirmed',
    text: 'Your booking is confirmed.',
    to: ['couple@example.com'],
  };
}

function successResponse(messageId = providerMessageId): unknown {
  return {
    data: { id: messageId },
    error: null,
    headers: { 'x-resend-daily-quota': '100' },
  };
}

function errorResponse(name: string, statusCode: number | null): unknown {
  return {
    data: null,
    error: { message: 'raw provider detail', name, statusCode },
    headers: null,
  };
}

function createClient(send: (payload: unknown, options: unknown) => Promise<unknown>) {
  const sendMock = vi.fn(send);
  const client: ResendEmailClientLike = { emails: { send: sendMock } };
  return { client, sendMock };
}

function createAdapter(client: ResendEmailClientLike, timeoutMs = 50): ResendEmailProvider {
  return new ResendEmailProvider({
    client,
    fromEmail: 'Wedding Restaurant <notifications@example.com>',
    timeoutMs,
  });
}

describe('email intent idempotency keys', () => {
  it('derives a deterministic key from an event type and persisted entity UUID', () => {
    const first = createEmailIntentIdempotencyKey({
      entityId: entityId.toUpperCase(),
      intentType: 'booking-confirmed',
    });
    const retry = createEmailIntentIdempotencyKey({
      entityId,
      intentType: 'booking-confirmed',
    });

    expect(first).toBe(`booking-confirmed/${entityId}`);
    expect(retry).toBe(first);
  });

  it('rejects attempt-specific and malformed keys', async () => {
    const provider = new FakeEmailProvider();
    const unsafeCommand = {
      ...validCommand(),
      idempotencyKey: crypto.randomUUID(),
    } as unknown as SendEmailCommand;

    await expect(provider.send(unsafeCommand)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('FakeEmailProvider', () => {
  it('sends once and replays the same result for a same-intent retry', async () => {
    const provider = new FakeEmailProvider();

    const first = await provider.send(validCommand());
    const retry = await provider.send(validCommand());

    expect(retry).toEqual(first);
    expect(retry.idempotencyKey).toBe(`booking-confirmed/${entityId}`);
    expect(provider.deliveryCount).toBe(1);
  });

  it('rejects the same intent key when the payload changes', async () => {
    const provider = new FakeEmailProvider();
    await provider.send(validCommand());

    await expect(
      provider.send({ ...validCommand(), subject: 'A different subject' }),
    ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
    expect(provider.deliveryCount).toBe(1);
  });

  it('supports a text-only transactional email', async () => {
    const provider = new FakeEmailProvider();
    const command = validCommand();
    const textOnlyCommand: SendEmailCommand = {
      idempotencyKey: command.idempotencyKey,
      subject: command.subject,
      text: command.text,
      to: command.to,
    };

    await expect(provider.send(textOnlyCommand)).resolves.toMatchObject({
      idempotencyKey: `booking-confirmed/${entityId}`,
    });
  });

  it('validates recipients and rejects unknown command fields', async () => {
    const provider = new FakeEmailProvider();
    const invalidRecipient = {
      ...validCommand(),
      to: ['not-an-email'],
    } as unknown as SendEmailCommand;
    const unknownField = {
      ...validCommand(),
      providerHeader: 'unsafe',
    } as unknown as SendEmailCommand;
    const headerInjection = {
      ...validCommand(),
      subject: 'Booking confirmed\r\nBcc: attacker@example.com',
    };

    await expect(provider.send(invalidRecipient)).rejects.toBeInstanceOf(ValidationError);
    await expect(provider.send(unknownField)).rejects.toBeInstanceOf(ValidationError);
    await expect(provider.send(headerInjection)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('ResendEmailProvider', () => {
  it('passes the deterministic key separately and validates a successful response', async () => {
    const { client, sendMock } = createClient(() => Promise.resolve(successResponse()));
    const provider = createAdapter(client);

    const result = await provider.send(validCommand());

    expect(result).toEqual({
      idempotencyKey: `booking-confirmed/${entityId}`,
      messageId: providerMessageId,
    });
    expect(sendMock).toHaveBeenCalledWith(
      {
        from: 'Wedding Restaurant <notifications@example.com>',
        html: '<p>Your booking is confirmed.</p>',
        subject: 'Booking confirmed',
        text: 'Your booking is confirmed.',
        to: ['couple@example.com'],
      },
      { idempotencyKey: `booking-confirmed/${entityId}` },
    );
  });

  it('uses the same key on a same-intent retry and returns the provider replay', async () => {
    const { client, sendMock } = createClient(() => Promise.resolve(successResponse()));
    const provider = createAdapter(client);

    const first = await provider.send(validCommand());
    const retry = await provider.send(validCommand());

    expect(retry).toEqual(first);
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls[0]?.[1]).toEqual(sendMock.mock.calls[1]?.[1]);
  });

  it('uses the default timeout and omits HTML for a text-only command', async () => {
    const { client, sendMock } = createClient(() => Promise.resolve(successResponse()));
    const provider = new ResendEmailProvider({
      client,
      fromEmail: 'notifications@example.com',
    });
    const command = validCommand();
    const textOnlyCommand: SendEmailCommand = {
      idempotencyKey: command.idempotencyKey,
      subject: command.subject,
      text: command.text,
      to: command.to,
    };

    await provider.send(textOnlyCommand);

    expect(sendMock.mock.calls[0]?.[0]).not.toHaveProperty('html');
  });

  it('maps a provider payload mismatch without exposing its raw response', async () => {
    const { client } = createClient(() =>
      Promise.resolve(errorResponse('invalid_idempotent_request', 409)),
    );

    const promise = createAdapter(client).send(validCommand());

    await expect(promise).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
    await expect(promise).rejects.not.toHaveProperty('cause');
  });

  it('maps an in-flight provider idempotency conflict to a stable conflict', async () => {
    const { client } = createClient(() =>
      Promise.resolve(errorResponse('concurrent_idempotent_requests', 409)),
    );

    const promise = createAdapter(client).send(validCommand());

    await expect(promise).rejects.toBeInstanceOf(RequestInProgressError);
    await expect(promise).rejects.toMatchObject({
      code: 'REQUEST_IN_PROGRESS',
      headers: { 'Retry-After': '1' },
    });
  });

  it('times out a provider call and never exposes the raw operation', async () => {
    const { client } = createClient(() => new Promise<never>(() => undefined));

    const promise = createAdapter(client, 5).send(validCommand());

    await expect(promise).rejects.toBeInstanceOf(ProviderError);
    await expect(promise).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
  });

  it('normalizes transient provider and rate-limit failures as unavailable', async () => {
    const failures = [
      errorResponse('service_unavailable', 503),
      errorResponse('application_error', 500),
      errorResponse('rate_limit_exceeded', 429),
      errorResponse('application_error', null),
    ];

    for (const response of failures) {
      const { client } = createClient(() => Promise.resolve(response));
      await expect(createAdapter(client).send(validCommand())).rejects.toMatchObject({
        code: 'PROVIDER_UNAVAILABLE',
      });
    }
  });

  it('normalizes malformed, permanent, and thrown SDK failures without raw details', async () => {
    const failures = [
      () => Promise.resolve({ data: { id: 'not-a-uuid' }, error: null, headers: null }),
      () => Promise.resolve(errorResponse('validation_error', 400)),
      () => Promise.reject(new Error('secret provider detail')),
    ];

    for (const failure of failures) {
      const { client } = createClient(failure);
      const promise = createAdapter(client).send(validCommand());
      await expect(promise).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
      await expect(promise).rejects.not.toHaveProperty('cause');
    }
  });

  it('normalizes thrown abort and status failures without SDK error types escaping', async () => {
    const failures = [
      {
        code: 'PROVIDER_TIMEOUT',
        error: Object.assign(new Error('aborted'), { name: 'AbortError' }),
      },
      {
        code: 'PROVIDER_UNAVAILABLE',
        error: Object.assign(new Error('unavailable'), { statusCode: '503' }),
      },
      {
        code: 'PROVIDER_UNAVAILABLE',
        error: Object.assign(new Error('rate limited'), { status: 429 }),
      },
    ];

    for (const failure of failures) {
      const { client } = createClient(() => Promise.reject(failure.error));
      await expect(createAdapter(client).send(validCommand())).rejects.toMatchObject({
        code: failure.code,
      });
    }
  });

  it('preserves an already-normalized application error from the client boundary', async () => {
    const normalized = new ProviderError('failure');
    const { client } = createClient(() => Promise.reject(normalized));

    await expect(createAdapter(client).send(validCommand())).rejects.toBe(normalized);
  });

  it('rejects invalid adapter configuration before invoking the client', () => {
    const { client, sendMock } = createClient(() => Promise.resolve(successResponse()));

    expect(() => new ResendEmailProvider({ client, fromEmail: 'invalid', timeoutMs: 50 })).toThrow(
      TypeError,
    );
    expect(
      () =>
        new ResendEmailProvider({
          client,
          fromEmail: 'Wedding\r\nBcc: attacker@example.com <notifications@example.com>',
          timeoutMs: 50,
        }),
    ).toThrow(TypeError);
    expect(
      () =>
        new ResendEmailProvider({
          client,
          fromEmail: 'notifications@example.com',
          timeoutMs: 0,
        }),
    ).toThrow(TypeError);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('constructs the official SDK adapter without issuing a request', () => {
    const provider = createResendEmailProvider({
      apiKey: 're_test_key',
      fromEmail: 'notifications@example.com',
      timeoutMs: 25,
    });

    expect(provider).toBeInstanceOf(ResendEmailProvider);
    expect(() =>
      createResendEmailProvider({ apiKey: ' ', fromEmail: 'notifications@example.com' }),
    ).toThrow(TypeError);
    expect(
      createResendEmailProvider({
        apiKey: 're_test_key',
        fromEmail: 'notifications@example.com',
      }),
    ).toBeInstanceOf(ResendEmailProvider);
  });
});
