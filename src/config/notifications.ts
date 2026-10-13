import { z } from 'zod';
import { serviceAccountSchema } from '../modules/notifications-automation/infrastructure/fcm-push.provider.js';
export type NotificationSettings = Readonly<{
  workerEnabled: boolean;
  bookingIds: readonly string[] | undefined;
  activeKeyVersion: string | null;
  keys: ReadonlyMap<string, Buffer>;
  fcm: z.infer<typeof serviceAccountSchema> | null;
}>;
/** Reject invalid configuration without echoing secret values in errors. */
export function parseNotificationSettings(
  source: Readonly<Record<string, string | undefined>>,
): NotificationSettings {
  try {
    const enabled =
      z.enum(['true', 'false']).parse(source.NOTIFICATIONS_WORKER_ENABLED ?? 'false') === 'true';
    const bookingIds =
      source.NOTIFICATIONS_BOOKING_IDS === undefined
        ? undefined
        : z.array(z.uuid()).parse(
            source.NOTIFICATIONS_BOOKING_IDS.split(',')
              .map((v) => v.trim())
              .filter(Boolean),
          );
    const activeKeyVersion = source.NOTIFICATIONS_ENCRYPTION_KEY_VERSION ?? null;
    const rawKeys =
      source.NOTIFICATIONS_ENCRYPTION_KEYS === undefined
        ? {}
        : z
            .record(
              z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/u),
              z.string().regex(/^[A-Za-z0-9+/]{43}=$/u),
            )
            .parse(JSON.parse(source.NOTIFICATIONS_ENCRYPTION_KEYS));
    const keys = new Map(
      Object.entries(rawKeys).map(([version, value]) => [version, Buffer.from(value, 'base64')]),
    );
    if (
      (activeKeyVersion === null && keys.size > 0) ||
      (activeKeyVersion !== null && !keys.has(activeKeyVersion))
    )
      throw Error('key configuration');
    for (const key of keys.values()) if (key.length !== 32) throw Error('key size');
    const fcm =
      source.NOTIFICATIONS_FCM_SERVICE_ACCOUNT === undefined
        ? null
        : serviceAccountSchema.parse(JSON.parse(source.NOTIFICATIONS_FCM_SERVICE_ACCOUNT));
    if (fcm !== null && activeKeyVersion === null) throw Error('push encryption configuration');
    return Object.freeze({ workerEnabled: enabled, bookingIds, activeKeyVersion, keys, fcm });
  } catch {
    throw new TypeError('Invalid Notifications worker/key/provider configuration.');
  }
}
