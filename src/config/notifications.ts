import { z } from 'zod';
type Source = Readonly<Record<string, string | undefined>>;
export class NotificationConfigurationError extends Error {
  constructor(readonly variables: readonly string[]) {
    super(`Invalid notification configuration: ${variables.join(', ')}.`);
  }
}
export function parseNotificationConfiguration(
  source: Source,
  environment: string,
  emailEnabled: boolean,
) {
  const errors: string[] = [];
  const enabled = source['NOTIFICATIONS_WORKER_ENABLED']?.trim() || 'false';
  if (!['true', 'false'].includes(enabled) || (enabled === 'true' && !emailEnabled))
    errors.push('NOTIFICATIONS_WORKER_ENABLED');
  const activeKeyVersion = source['NOTIFICATIONS_ACTIVE_KEY_VERSION']?.trim() || null;
  let credentialKeys: Readonly<Record<string, string>> | null = null;
  const rawKeys = source['NOTIFICATIONS_CREDENTIAL_KEYS']?.trim();
  if (rawKeys) {
    try {
      const keys = z
        .record(z.string().regex(/^[A-Za-z0-9_-]{1,40}$/u), z.string())
        .parse(JSON.parse(rawKeys));
      if (
        Object.keys(keys).length < 1 ||
        Object.keys(keys).length > 10 ||
        !activeKeyVersion ||
        !Object.hasOwn(keys, activeKeyVersion)
      )
        throw new Error('keys');
      for (const value of Object.values(keys))
        if (
          Buffer.from(value, 'base64').length !== 32 ||
          Buffer.from(value, 'base64').toString('base64') !== value
        )
          throw new Error('key');
      credentialKeys = Object.freeze(keys);
    } catch {
      errors.push('NOTIFICATIONS_CREDENTIAL_KEYS', 'NOTIFICATIONS_ACTIVE_KEY_VERSION');
    }
  } else if (activeKeyVersion)
    errors.push('NOTIFICATIONS_CREDENTIAL_KEYS', 'NOTIFICATIONS_ACTIVE_KEY_VERSION');
  const list = (name: string, schema: z.ZodType<string>) => {
    const raw = source[name]?.trim();
    if (!raw) return null;
    const parsed = z
      .array(schema)
      .min(1)
      .max(500)
      .safeParse(raw.split(',').map((v) => v.trim()));
    if (!parsed.success) {
      errors.push(name);
      return null;
    }
    return Object.freeze([...new Set(parsed.data)].sort());
  };
  const emailAllowlist = list(
    'NOTIFICATIONS_EMAIL_ALLOWLIST',
    z.email().transform((v) => v.toLowerCase()),
  );
  const bookingAllowlist = list(
    'NOTIFICATIONS_BOOKING_ALLOWLIST',
    z.uuid().transform((v) => v.toLowerCase()),
  );
  let guestLinkUrl = source['NOTIFICATIONS_GUEST_LINK_URL']?.trim() || null;
  if (guestLinkUrl) {
    try {
      const url = new URL(guestLinkUrl);
      if (
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        guestLinkUrl.length > 2048 ||
        (url.protocol !== 'https:' &&
          !(
            url.protocol === 'http:' &&
            ['test', 'development'].includes(environment) &&
            ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
          ))
      )
        throw new Error('url');
      guestLinkUrl = url.toString();
    } catch {
      errors.push('NOTIFICATIONS_GUEST_LINK_URL');
    }
  }
  if (errors.length) throw new NotificationConfigurationError([...new Set(errors)].sort());
  return Object.freeze({
    workerEnabled: enabled === 'true',
    credentialKeys,
    activeKeyVersion,
    emailAllowlist,
    bookingAllowlist,
    guestLinkUrl,
  });
}
export type NotificationConfiguration = ReturnType<typeof parseNotificationConfiguration>;
