import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseNotificationConfiguration } from './notifications.js';

describe('notification runtime configuration', () => {
  it('defaults workers/push delivery to disabled and requires real email when the worker is enabled', () => {
    expect(parseNotificationConfiguration({}, 'test', false).workerEnabled).toBe(false);
    expect(() =>
      parseNotificationConfiguration({ NOTIFICATIONS_WORKER_ENABLED: 'true' }, 'test', false),
    ).toThrow('NOTIFICATIONS_WORKER_ENABLED');
  });
  it('validates versioned encryption keys and scopes test targets without echoing secrets', () => {
    const secret = randomBytes(32).toString('base64');
    const config = parseNotificationConfiguration(
      {
        NOTIFICATIONS_WORKER_ENABLED: 'true',
        NOTIFICATIONS_CREDENTIAL_KEYS: JSON.stringify({ v1: secret }),
        NOTIFICATIONS_ACTIVE_KEY_VERSION: 'v1',
        NOTIFICATIONS_EMAIL_ALLOWLIST: 'receiver@example.invalid',
        NOTIFICATIONS_BOOKING_ALLOWLIST: '00000000-0000-4000-8000-000000000001',
      },
      'test',
      true,
    );
    expect(config.emailAllowlist).toEqual(['receiver@example.invalid']);
    expect(config.credentialKeys?.['v1']).toBe(secret);
    expect(() =>
      parseNotificationConfiguration({ NOTIFICATIONS_CREDENTIAL_KEYS: secret }, 'test', true),
    ).toThrow('NOTIFICATIONS_CREDENTIAL_KEYS');
    expect(() =>
      parseNotificationConfiguration(
        { NOTIFICATIONS_GUEST_LINK_URL: 'https://user:secret@example.com/guest' },
        'production',
        true,
      ),
    ).toThrow('NOTIFICATIONS_GUEST_LINK_URL');
    expect(() =>
      parseNotificationConfiguration(
        { NOTIFICATIONS_GUEST_LINK_URL: 'http://example.com/guest' },
        'production',
        true,
      ),
    ).toThrow('NOTIFICATIONS_GUEST_LINK_URL');
  });
});
