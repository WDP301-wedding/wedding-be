import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createFcmPushProvider, unavailablePush } from './fcm-push.provider.js';
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 }),
  settings = {
    project_id: 'wedding-test',
    client_email: 'fixture@example.test',
    private_key: pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
  },
  command = {
    token: 'private-token',
    intentId: 'intent-id',
    bookingId: 'booking-id',
    title: 'Thông báo',
    screen: 'BOOKING',
  };
describe('FCM HTTP v1 primary protocol', () => {
  it('signs OAuth assertion, caches bounded bearer and only sends minimal native metadata', async () => {
    const fetcher = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ access_token: 'test-bearer', expires_in: 3600 })),
        )
        .mockImplementation(() =>
          Promise.resolve(
            new Response(JSON.stringify({ name: 'projects/wedding-test/messages/1' })),
          ),
        ),
      provider = createFcmPushProvider(settings, fetcher);
    expect(await provider.send(command)).toEqual({ messageId: 'projects/wedding-test/messages/1' });
    await provider.send(command);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0]![0]).toBe('https://oauth2.googleapis.com/token');
    expect(fetcher.mock.calls[1]![0]).toBe(
      'https://fcm.googleapis.com/v1/projects/wedding-test/messages:send',
    );
    const body = z
      .object({ message: z.object({ data: z.record(z.string(), z.string()) }) })
      .parse(
        JSON.parse(z.string().parse((fetcher.mock.calls[1]![1] as RequestInit).body)) as unknown,
      );
    expect(body.message.data).toEqual({
      notificationIntentId: 'intent-id',
      bookingId: 'booking-id',
      screen: 'BOOKING',
    });
    expect(JSON.stringify(body)).not.toContain('private_key');
  });
  it.each([
    [401, 'NOTIFICATION_RETRYABLE'],
    [429, 'NOTIFICATION_RETRYABLE'],
    [503, 'NOTIFICATION_UNKNOWN'],
    [400, 'NOTIFICATION_PERMANENT'],
    [404, 'PUSH_TOKEN_INVALID'],
  ] as const)('classifies provider rejection %i without payload leakage', async (status, code) => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'bearer', expires_in: 100 })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              details: [{ errorCode: status === 404 ? 'UNREGISTERED' : 'INVALID_ARGUMENT' }],
            },
          }),
          {
            status,
          },
        ),
      );
    await expect(createFcmPushProvider(settings, fetcher).send(command)).rejects.toMatchObject({
      code,
    });
  });
  it('keeps transport/malformed receipt unknown, OAuth errors safely retryable and unavailable push unsent', async () => {
    const token = new Response(JSON.stringify({ access_token: 'bearer', expires_in: 100 }));
    const f = vi
      .fn()
      .mockResolvedValueOnce(token)
      .mockRejectedValueOnce(Error('private network body'));
    await expect(createFcmPushProvider(settings, f).send(command)).rejects.toMatchObject({
      code: 'NOTIFICATION_UNKNOWN',
    });
    await expect(
      createFcmPushProvider(
        settings,
        vi.fn().mockResolvedValue(new Response('{}', { status: 403 })),
      ).send(command),
    ).rejects.toMatchObject({ code: 'NOTIFICATION_RETRYABLE' });
    const malformed = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'bearer', expires_in: 100 })),
      )
      .mockResolvedValueOnce(new Response('{}'));
    await expect(createFcmPushProvider(settings, malformed).send(command)).rejects.toMatchObject({
      code: 'NOTIFICATION_UNKNOWN',
    });
    await expect(unavailablePush.send(command)).rejects.toMatchObject({
      code: 'NOTIFICATION_RETRYABLE',
    });
  });
});
