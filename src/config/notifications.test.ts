import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseNotificationSettings } from './notifications.js';
describe('Notification config', () => {
  it('defaults worker off, bounds scope and loads versioned backend keys', () => {
    expect(parseNotificationSettings({})).toMatchObject({
      workerEnabled: false,
      activeKeyVersion: null,
      fcm: null,
    });
    const configured = parseNotificationSettings({
      NOTIFICATIONS_WORKER_ENABLED: 'true',
      NOTIFICATIONS_BOOKING_IDS: '11111111-1111-4111-a111-111111111111',
      NOTIFICATIONS_ENCRYPTION_KEY_VERSION: 'v1',
      NOTIFICATIONS_ENCRYPTION_KEYS: JSON.stringify({ v1: randomBytes(32).toString('base64') }),
    });
    expect(configured.workerEnabled).toBe(true);
    expect(configured.keys.get('v1')).toHaveLength(32);
    expect(configured.bookingIds).toHaveLength(1);
    expect(parseNotificationSettings({ NOTIFICATIONS_BOOKING_IDS: '' }).bookingIds).toEqual([]);
  });
  it.each([
    { NOTIFICATIONS_WORKER_ENABLED: 'yes' },
    { NOTIFICATIONS_BOOKING_IDS: 'bad' },
    { NOTIFICATIONS_ENCRYPTION_KEY_VERSION: 'v1' },
    { NOTIFICATIONS_ENCRYPTION_KEYS: '{"v1":"secret"}' },
    { NOTIFICATIONS_ENCRYPTION_KEYS: JSON.stringify({ v1: randomBytes(32).toString('base64') }) },
    { NOTIFICATIONS_FCM_SERVICE_ACCOUNT: '{bad-secret' },
    {
      NOTIFICATIONS_FCM_SERVICE_ACCOUNT: JSON.stringify({
        project_id: 'abcde',
        client_email: 'test@example.test',
        private_key: 'private-secret',
      }),
    },
  ])('fails closed without revealing malformed values', (input) => {
    expect(() => parseNotificationSettings(input)).toThrow(
      'Invalid Notifications worker/key/provider configuration.',
    );
  });
});
