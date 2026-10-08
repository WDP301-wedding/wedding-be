import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrevoEmailProvider } from './brevo-email-provider.js';
import { createEmailIntentIdempotencyKey, type SendEmailCommand } from './email-provider.js';

function command(): SendEmailCommand {
  return {
    idempotencyKey: createEmailIntentIdempotencyKey({
      intentType: 'password-reset',
      entityId: '0195df70-4518-7ef8-b9db-063dc57b78d9',
    }),
    subject: 'Reset your password',
    text: 'Open the reset link.',
    to: ['couple@example.com'],
  };
}

function setup(
  response = new Response(JSON.stringify({ messageId: '<brevo-message@example.com>' }), {
    status: 201,
  }),
) {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockImplementation(() => Promise.resolve(response.clone()));
  const provider = new BrevoEmailProvider({
    apiKey: 'brevo-test-key',
    fromEmail: 'Wedding Restaurant <notifications@example.com>',
    fetch: fetchMock,
  });
  return { provider, fetchMock };
}

function payload(
  fetchMock: ReturnType<typeof setup>['fetchMock'],
  index = 0,
): Record<string, unknown> {
  const body = fetchMock.mock.calls[index]?.[1]?.body;
  if (typeof body !== 'string') throw new Error('Expected a JSON request body.');
  return JSON.parse(body) as Record<string, unknown>;
}

afterEach(() => vi.useRealTimers());

describe('BrevoEmailProvider', () => {
  it('sends validated transactional text and HTML and returns the Brevo message ID', async () => {
    const { provider, fetchMock } = setup();
    const input = { ...command(), html: '<p>Open the reset link.</p>' };
    expect(await provider.send(input)).toEqual({
      idempotencyKey: input.idempotencyKey,
      messageId: '<brevo-message@example.com>',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.brevo.com/v3/smtp/email',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'api-key': 'brevo-test-key',
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        redirect: 'error',
      }),
    );
    expect(payload(fetchMock)).toMatchObject({
      sender: { name: 'Wedding Restaurant', email: 'notifications@example.com' },
      to: [{ email: 'couple@example.com' }],
      subject: input.subject,
      textContent: input.text,
      htmlContent: input.html,
    });
    expect(payload(fetchMock).headers).toHaveProperty(
      'idempotencyKey',
      expect.stringMatching(/^[\da-f]{8}-[\da-f]{4}-5[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u),
    );
  });

  it('omits optional HTML and names for a plain sender address', async () => {
    const { fetchMock } = setup();
    const provider = new BrevoEmailProvider({
      apiKey: 'test-key',
      fromEmail: 'sender@gmail.com',
      fetch: fetchMock,
    });
    await provider.send(command());
    expect(payload(fetchMock).sender).toEqual({ email: 'sender@gmail.com' });
    expect(payload(fetchMock)).not.toHaveProperty('htmlContent');
  });

  it('reuses a deterministic UUID across retries and instances, but separates different intents', async () => {
    const first = setup();
    const second = setup();
    await first.provider.send(command());
    await second.provider.send(command());
    await second.provider.send({
      ...command(),
      idempotencyKey: createEmailIntentIdempotencyKey({
        entityId: '0195df70-4518-7ef8-b9db-063dc57b78d9',
        intentType: 'workspace-invitation',
      }),
    });
    expect(payload(first.fetchMock).headers).toEqual(payload(second.fetchMock).headers);
    expect(payload(first.fetchMock).headers).not.toEqual(payload(second.fetchMock, 1).headers);
  });

  it.each([400, 401, 403, 429, 500, 503])(
    'sanitizes HTTP %s errors without retrying or leaking the key/body',
    async (status) => {
      const { provider, fetchMock } = setup(
        new Response('secret-key and recipient information', { status }),
      );
      const error: unknown = await provider.send(command()).catch((reason: unknown) => reason);
      expect(error).toMatchObject({
        code: status === 429 || status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_ERROR',
      });
      expect(error).not.toHaveProperty('cause');
      expect(String(error)).not.toContain('secret-key');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['not-json', '{}', '{"messageId":""}', '{"messageId":123}'])(
    'rejects malformed successful responses: %s',
    async (body) => {
      const { provider } = setup(new Response(body, { status: 201 }));
      await expect(provider.send(command())).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    },
  );

  it('sanitizes network errors', async () => {
    const { provider, fetchMock } = setup();
    fetchMock.mockRejectedValue(new Error('Secret transport details'));
    await expect(provider.send(command())).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });

  it('aborts a stalled request at the deadline', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => undefined));
    const provider = new BrevoEmailProvider({
      apiKey: 'test-key',
      fromEmail: 'sender@gmail.com',
      timeoutMs: 5,
      fetch: fetchMock,
    });
    const rejection = expect(provider.send(command())).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(5);
    await rejection;
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('includes response body reading in the timeout', async () => {
    vi.useFakeTimers();
    const { fetchMock } = setup();
    const response = new Response('{}', { status: 201 });
    vi.spyOn(response, 'json').mockImplementation(() => new Promise(() => undefined));
    fetchMock.mockResolvedValue(response);
    const provider = new BrevoEmailProvider({
      apiKey: 'test-key',
      fromEmail: 'sender@gmail.com',
      timeoutMs: 5,
      fetch: fetchMock,
    });
    const rejection = expect(provider.send(command())).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(5);
    await rejection;
  });

  it('rejects invalid input before contacting Brevo', async () => {
    const { provider, fetchMock } = setup();
    await expect(
      provider.send({ ...command(), subject: 'header\ninjection' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['', 'bad-address', 'Wedding\r\nRestaurant <sender@gmail.com>'])(
    'rejects invalid sender configuration: %s',
    (fromEmail) => {
      expect(() => new BrevoEmailProvider({ apiKey: 'test-key', fromEmail })).toThrow(TypeError);
    },
  );

  it.each([0, 60_001, 1.5])('rejects invalid timeout %s', (timeoutMs) => {
    expect(
      () =>
        new BrevoEmailProvider({ apiKey: 'test-key', fromEmail: 'sender@gmail.com', timeoutMs }),
    ).toThrow(TypeError);
  });

  it('rejects empty and header-injected API keys', () => {
    for (const apiKey of [' ', 'key\r\nheader']) {
      expect(() => new BrevoEmailProvider({ apiKey, fromEmail: 'sender@gmail.com' })).toThrow(
        TypeError,
      );
    }
  });
});
