import { JWT } from 'google-auth-library';
import { z } from 'zod';
import type { FcmConfiguration } from '../../../config/fcm.js';
import type { DeliveryEvidence } from './email-delivery.js';

export type FcmCommand = Readonly<{
  token: string;
  title: string;
  notificationId: string;
  bookingId: string;
  purpose: string;
  owner: string;
  referenceId?: string;
}>;
type FcmEvidence = Omit<DeliveryEvidence, 'outcome'> & {
  outcome: Exclude<DeliveryEvidence['outcome'], 'DELIVERED'>;
};
export interface FcmSender {
  send(command: FcmCommand): Promise<FcmEvidence>;
}
type Auth = { getAccessToken(): Promise<{ token?: string | null }> };
const result = z.object({
  name: z
    .string()
    .max(320)
    .regex(/^projects\/[a-z0-9-]+\/messages\/[^\s]+$/u),
});
const failure = z.object({
  error: z.object({
    details: z
      .array(z.object({ '@type': z.string(), errorCode: z.string().optional() }))
      .optional(),
  }),
});

/** HTTP v1 acceptance proves provider receipt only; FCM has no send idempotency API. */
export class NotificationFcmDelivery implements FcmSender {
  private readonly auth: Auth | null;
  constructor(
    readonly config: FcmConfiguration,
    readonly fetcher: typeof fetch = fetch,
    auth?: Auth,
  ) {
    this.auth =
      auth ??
      (config.enabled
        ? new JWT({
            email: config.clientEmail,
            key: config.privateKey,
            scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
            transporterOptions: { timeout: 5000, retry: false },
          })
        : null);
  }
  async send(command: FcmCommand): Promise<FcmEvidence> {
    if (!this.config.enabled || !this.auth)
      return { outcome: 'DEAD_LETTER', errorCode: 'ANDROID_PROVIDER_DISABLED' };
    if (
      !command.token ||
      /\s/u.test(command.token) ||
      command.token.length > 4096 ||
      /^(Expo|Exponent)PushToken\[/u.test(command.token)
    )
      return { outcome: 'DEAD_LETTER', errorCode: 'FCM_TOKEN_FORMAT_INVALID' };
    let accessToken: string;
    try {
      const credentials = await this.auth.getAccessToken();
      if (!credentials.token) throw new Error('token');
      accessToken = credentials.token;
    } catch {
      return { outcome: 'RETRYABLE_FAILED', errorCode: 'FCM_AUTH_UNAVAILABLE' };
    }
    try {
      const response = await this.fetcher(
        `https://fcm.googleapis.com/v1/projects/${this.config.projectId}/messages:send`,
        {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(8000),
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: {
              token: command.token,
              notification: { title: command.title, body: 'Mở ứng dụng để xem thông báo.' },
              data: {
                notificationId: command.notificationId,
                bookingId: command.bookingId,
                purpose: command.purpose,
                owner: command.owner,
                ...(command.referenceId ? { referenceId: command.referenceId } : {}),
              },
              android: { priority: 'normal', ttl: '3600s' },
            },
          }),
        },
      );
      const body: unknown = await response.json();
      if (response.ok) {
        const parsed = result.safeParse(body);
        return parsed.success &&
          parsed.data.name.startsWith(`projects/${this.config.projectId}/messages/`)
          ? { outcome: 'ACCEPTED', providerMessageId: parsed.data.name }
          : { outcome: 'UNKNOWN', errorCode: 'FCM_RESPONSE_INVALID' };
      }
      const parsed = failure.safeParse(body);
      const code = parsed.success
        ? parsed.data.error.details?.find(
            (d) => d['@type'] === 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
          )?.errorCode
        : undefined;
      if (response.status === 404 && code === 'UNREGISTERED')
        return { outcome: 'DEAD_LETTER', errorCode: 'FCM_UNREGISTERED' };
      if ([429, 500, 503].includes(response.status))
        return { outcome: 'RETRYABLE_FAILED', errorCode: 'FCM_TEMPORARILY_UNAVAILABLE' };
      if ([400, 401, 403, 404].includes(response.status))
        return { outcome: 'DEAD_LETTER', errorCode: 'FCM_REQUEST_REJECTED' };
      return { outcome: 'UNKNOWN', errorCode: 'FCM_RESULT_UNKNOWN' };
    } catch {
      return { outcome: 'UNKNOWN', errorCode: 'FCM_RESULT_UNKNOWN' };
    }
  }
}
