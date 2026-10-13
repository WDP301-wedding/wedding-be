import { createPrivateKey, sign } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../../core/errors/app-error.js';
export interface PushCommand {
  token: string;
  intentId: string;
  bookingId: string;
  title: string;
  screen: string;
}
export interface PushProvider {
  send(command: PushCommand): Promise<{ messageId: string }>;
}
export const serviceAccountSchema = z.object({
  project_id: z.string().regex(/^[a-z][a-z0-9-]{4,60}$/u),
  client_email: z.email(),
  private_key: z.string().min(1),
});
export const pushError = (
  code:
    | 'NOTIFICATION_RETRYABLE'
    | 'NOTIFICATION_PERMANENT'
    | 'NOTIFICATION_UNKNOWN'
    | 'PUSH_TOKEN_INVALID',
) =>
  new AppError({ status: 503, code, message: 'Push delivery requires retry or reconciliation.' });
/** FCM HTTP v1 + short-lived OAuth service-account access token. FCM has no
 * sender idempotency lookup, so timeout is UNKNOWN rather than automatic resend. */
export function createFcmPushProvider(
  raw: unknown,
  fetcher: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): PushProvider {
  const settings = serviceAccountSchema.parse(raw),
    key = createPrivateKey(settings.private_key);
  let access: { token: string; expiresAt: number } | undefined;
  const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  async function token() {
    if (access !== undefined && access.expiresAt > now().getTime() + 60000) return access.token;
    const issued = Math.floor(now().getTime() / 1000),
      input = `${encoded({ alg: 'RS256', typ: 'JWT' })}.${encoded({ iss: settings.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: issued, exp: issued + 3600 })}`;
    const assertion = `${input}.${sign('RSA-SHA256', Buffer.from(input), key).toString('base64url')}`;
    try {
      const response = await fetcher('https://oauth2.googleapis.com/token', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }),
      });
      if (!response.ok) throw Error('oauth rejected');
      const value = z
        .object({ access_token: z.string().min(1), expires_in: z.int().positive() })
        .parse(await response.json());
      access = {
        token: value.access_token,
        expiresAt: now().getTime() + Math.min(value.expires_in, 3600) * 1000,
      };
      return access.token;
    } catch {
      throw pushError('NOTIFICATION_RETRYABLE');
    }
  }
  return {
    async send(command) {
      const bearer = await token();
      try {
        const response = await fetcher(
          `https://fcm.googleapis.com/v1/projects/${settings.project_id}/messages:send`,
          {
            method: 'POST',
            redirect: 'error',
            signal: AbortSignal.timeout(10000),
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
            body: JSON.stringify({
              message: {
                token: command.token,
                notification: {
                  title: command.title,
                  body: 'Mở ứng dụng để xem chi tiết sự kiện.',
                },
                data: {
                  notificationIntentId: command.intentId,
                  bookingId: command.bookingId,
                  screen: command.screen,
                },
                android: { ttl: '86400s' },
              },
            }),
          },
        );
        if (response.status === 401) {
          access = undefined;
          throw pushError('NOTIFICATION_RETRYABLE');
        }
        if (response.status === 429) throw pushError('NOTIFICATION_RETRYABLE');
        if (!response.ok) {
          if (response.status >= 500) throw pushError('NOTIFICATION_UNKNOWN');
          const value = z
            .object({
              error: z.object({
                details: z.array(z.object({ errorCode: z.string().optional() })).optional(),
              }),
            })
            .safeParse(await response.json());
          if (
            value.success &&
            value.data.error.details?.some((d) => d.errorCode === 'UNREGISTERED')
          )
            throw pushError('PUSH_TOKEN_INVALID');
          throw pushError('NOTIFICATION_PERMANENT');
        }
        return {
          messageId: z.object({ name: z.string().min(1) }).parse(await response.json()).name,
        };
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw pushError('NOTIFICATION_UNKNOWN');
      }
    },
  };
}
export const unavailablePush: PushProvider = {
  send: () => Promise.reject(pushError('NOTIFICATION_RETRYABLE')),
};
