import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseFcmConfiguration } from './fcm.js';

const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString();
const account = {
  type: 'service_account',
  project_id: 'wedding-test',
  client_email: 'worker@wedding-test.iam.gserviceaccount.com',
  private_key: privateKey,
};
const source = {
  NOTIFICATIONS_FCM_ENABLED: 'true',
  NOTIFICATIONS_FCM_SERVICE_ACCOUNT: JSON.stringify(account),
};
describe('FCM configuration', () => {
  it('defaults disabled and never treats credentials alone as enablement', () => {
    expect(parseFcmConfiguration({})).toEqual({ enabled: false });
    expect(parseFcmConfiguration({ NOTIFICATIONS_FCM_SERVICE_ACCOUNT: 'bad' })).toEqual({
      enabled: false,
    });
    expect(() => parseFcmConfiguration({ NOTIFICATIONS_FCM_ENABLED: 'yes' })).toThrow(
      'NOTIFICATIONS_FCM_ENABLED',
    );
  });
  it('validates service account and optional test account scope without exposing secrets', () => {
    expect(parseFcmConfiguration(source)).toMatchObject({
      enabled: true,
      projectId: 'wedding-test',
      accountAllowlist: null,
    });
    const id = '00000000-0000-4000-8000-000000000001';
    expect(
      parseFcmConfiguration({ ...source, NOTIFICATIONS_FCM_ACCOUNT_ALLOWLIST: `${id}, ${id}` }),
    ).toMatchObject({ accountAllowlist: [id] });
    for (const invalid of [
      '',
      'not-json',
      JSON.stringify({ ...account, private_key: 'SECRET_INVALID_KEY' }),
      JSON.stringify({ ...account, project_id: '../other' }),
    ]) {
      try {
        parseFcmConfiguration({ ...source, NOTIFICATIONS_FCM_SERVICE_ACCOUNT: invalid });
        expect.fail('expected rejection');
      } catch (error) {
        expect(String(error)).toContain('NOTIFICATIONS_FCM_SERVICE_ACCOUNT');
        expect(String(error)).not.toContain('SECRET_INVALID_KEY');
      }
    }
    expect(() => parseFcmConfiguration({ NOTIFICATIONS_FCM_ENABLED: 'true' })).toThrow(
      'NOTIFICATIONS_FCM_SERVICE_ACCOUNT',
    );
    expect(() =>
      parseFcmConfiguration({ ...source, NOTIFICATIONS_FCM_ACCOUNT_ALLOWLIST: 'not-uuid' }),
    ).toThrow('NOTIFICATIONS_FCM_ACCOUNT_ALLOWLIST');
    const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    expect(() =>
      parseFcmConfiguration({
        ...source,
        NOTIFICATIONS_FCM_SERVICE_ACCOUNT: JSON.stringify({ ...account, private_key: ec }),
      }),
    ).toThrow('NOTIFICATIONS_FCM_SERVICE_ACCOUNT');
  });
});
