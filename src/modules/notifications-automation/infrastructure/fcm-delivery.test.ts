import { describe, expect, it, vi } from 'vitest';
import { NotificationFcmDelivery, type FcmCommand } from './fcm-delivery.js';

const config = {
  enabled: true as const,
  projectId: 'wedding-test',
  clientEmail: 'worker@example.invalid',
  privateKey: 'controlled',
  accountAllowlist: null,
};
const command: FcmCommand = {
  token: 'native-device-token',
  title: 'Lịch trình đã cập nhật',
  notificationId: 'intent',
  bookingId: 'booking',
  purpose: 'TIMELINE_CHANGED',
  owner: 'booking-lifecycle',
};
const auth = { getAccessToken: () => Promise.resolve({ token: 'controlled-access-token' }) };
function fixture(status: number, body: unknown) {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
  return { fetcher, provider: new NotificationFcmDelivery(config, fetcher, auth) };
}
describe('FCM HTTP v1 delivery', () => {
  it('targets the configured project, minimizes payload and records acceptance only', async () => {
    const x = fixture(200, { name: 'projects/wedding-test/messages/123' });
    expect(await x.provider.send({ ...command, referenceId: 'reference' })).toEqual({
      outcome: 'ACCEPTED',
      providerMessageId: 'projects/wedding-test/messages/123',
    });
    const [url, options] = x.fetcher.mock.calls[0]!;
    expect(url).toBe('https://fcm.googleapis.com/v1/projects/wedding-test/messages:send');
    expect(options).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: 'Bearer controlled-access-token' },
    });
    expect(JSON.parse(options!.body as string)).toEqual({
      message: {
        token: command.token,
        notification: { title: command.title, body: 'Mở ứng dụng để xem thông báo.' },
        data: {
          notificationId: 'intent',
          bookingId: 'booking',
          purpose: 'TIMELINE_CHANGED',
          owner: 'booking-lifecycle',
          referenceId: 'reference',
        },
        android: { priority: 'normal', ttl: '3600s' },
      },
    });
    await x.provider.send(command);
    expect(JSON.parse(x.fetcher.mock.calls[1]![1]!.body as string)).not.toHaveProperty(
      'message.data.referenceId',
    );
  });
  it.each([429, 500, 503])('retries definitive temporary rejection %i', async (status) => {
    expect(await fixture(status, { error: {} }).provider.send(command)).toMatchObject({
      outcome: 'RETRYABLE_FAILED',
    });
  });
  it.each([400, 401, 403, 404])(
    'does not disable a device for generic rejection %i',
    async (status) => {
      expect(await fixture(status, { error: {} }).provider.send(command)).toEqual({
        outcome: 'DEAD_LETTER',
        errorCode: 'FCM_REQUEST_REJECTED',
      });
    },
  );
  it('recognizes only typed UNREGISTERED and preserves ambiguous send outcomes', async () => {
    const body = {
      error: {
        details: [
          {
            '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
            errorCode: 'UNREGISTERED',
          },
        ],
      },
    };
    expect(await fixture(404, body).provider.send(command)).toMatchObject({
      errorCode: 'FCM_UNREGISTERED',
    });
    expect(
      await fixture(404, {
        error: { details: [{ '@type': 'other', errorCode: 'UNREGISTERED' }] },
      }).provider.send(command),
    ).toMatchObject({ errorCode: 'FCM_REQUEST_REJECTED' });
    expect(await fixture(200, { name: 'not-a-message' }).provider.send(command)).toMatchObject({
      outcome: 'UNKNOWN',
    });
    expect(await fixture(418, {}).provider.send(command)).toMatchObject({ outcome: 'UNKNOWN' });
    const x = fixture(200, {});
    x.fetcher.mockRejectedValueOnce(new Error('sensitive provider detail'));
    expect(await x.provider.send(command)).toEqual({
      outcome: 'UNKNOWN',
      errorCode: 'FCM_RESULT_UNKNOWN',
    });
    x.fetcher.mockResolvedValueOnce(new Response('not-json'));
    expect(await x.provider.send(command)).toMatchObject({ outcome: 'UNKNOWN' });
  });
  it('never calls send when disabled, given Expo token, or unable to authorize', async () => {
    const x = fixture(200, {});
    expect(
      await new NotificationFcmDelivery({ enabled: false }, x.fetcher).send(command),
    ).toMatchObject({ errorCode: 'ANDROID_PROVIDER_DISABLED' });
    new NotificationFcmDelivery(config, x.fetcher); // constructs the real Google auth client, without network
    for (const token of [
      '',
      'contains space',
      'x'.repeat(4097),
      'ExpoPushToken[x]',
      'ExponentPushToken[x]',
    ])
      expect(await x.provider.send({ ...command, token })).toMatchObject({
        errorCode: 'FCM_TOKEN_FORMAT_INVALID',
      });
    expect(
      await new NotificationFcmDelivery(config, x.fetcher, {
        getAccessToken: () => Promise.resolve({ token: null }),
      }).send(command),
    ).toMatchObject({ errorCode: 'FCM_AUTH_UNAVAILABLE' });
    expect(
      await new NotificationFcmDelivery(config, x.fetcher, {
        getAccessToken: () => Promise.reject(new Error('secret')),
      }).send(command),
    ).toMatchObject({ outcome: 'RETRYABLE_FAILED' });
    expect(x.fetcher).not.toHaveBeenCalled();
  });
});
