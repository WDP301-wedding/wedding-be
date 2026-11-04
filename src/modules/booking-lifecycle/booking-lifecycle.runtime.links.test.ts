import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { parseEnvironment } from '../../config/env.js';
import { publicWebBaseUrl } from './booking-lifecycle.runtime.js';
import { createIdentityEmailNotificationPort } from '../identity-access/identity-notification.port.js';
import type { EmailProvider } from '../../integrations/email/email-provider.js';

function configuration(
  origin?: string,
  environment: 'production' | 'staging' | 'test' = 'production',
) {
  const config = parseEnvironment({
    NODE_ENV: 'test',
    CORS_ALLOWED_ORIGINS: 'http://localhost:3000,https://manage.example.test',
    ...(origin ? { PUBLIC_INVITATION_WEB_ORIGIN: origin } : {}),
  });
  return { ...config, runtime: { ...config.runtime, environment } };
}

describe('production identity email destinations', () => {
  it('uses the explicit production website even when localhost is the first CORS origin', async () => {
    const send = vi.fn<EmailProvider['send']>((command) =>
      Promise.resolve({ idempotencyKey: command.idempotencyKey, messageId: 'controlled' }),
    );
    const port = createIdentityEmailNotificationPort(
      { send },
      publicWebBaseUrl(configuration('https://couple.example.test')),
    );
    await port.sendWorkspaceInvitation({
      invitationId: randomUUID(),
      recipientEmail: 'invitee@example.test',
      invitationToken: 'wii_controlled',
    });
    const message = send.mock.calls[0]![0];
    expect(message.text).toContain(
      'https://couple.example.test/workspace-invitation#wii_controlled',
    );
    expect(message.text).not.toContain('localhost');
    expect(message.text).not.toContain('?');
  });

  it.each(['production', 'staging'] as const)(
    'refuses to derive credential links from CORS in %s',
    (environment) => {
      expect(() => publicWebBaseUrl(configuration(undefined, environment))).toThrow(
        'PUBLIC_INVITATION_WEB_ORIGIN',
      );
    },
  );

  it.each(['http://localhost:3000', 'http://127.0.0.1:3000', 'https://localhost', 'https://[::1]'])(
    'refuses deployed loopback destination %s',
    (origin) => {
      expect(() => publicWebBaseUrl(configuration(origin))).toThrow(TypeError);
    },
  );

  it('keeps explicit and default loopback URLs available for local tests', () => {
    expect(publicWebBaseUrl(configuration('http://127.0.0.1:3000', 'test'))).toBe(
      'http://127.0.0.1:3000',
    );
    expect(publicWebBaseUrl(configuration(undefined, 'test'))).toBe('http://localhost:3000');
    expect(publicWebBaseUrl(parseEnvironment({ NODE_ENV: 'test' }))).toBe('http://localhost:3000');
  });
});
