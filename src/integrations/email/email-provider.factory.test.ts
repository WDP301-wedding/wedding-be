import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseEnvironment } from '../../config/env.js';
import { createIdentityEmailNotificationPort } from '../../modules/identity-access/identity-notification.port.js';
import { createEmailProvider } from './email-provider.factory.js';
import { FakeEmailProvider } from './fake-email-provider.js';
import { ResendEmailProvider } from './resend-email-provider.js';

afterEach(() => vi.unstubAllGlobals());

describe('createEmailProvider', () => {
  it('keeps offline configuration on the fake and legacy Resend credentials on Resend', () => {
    expect(createEmailProvider(parseEnvironment({}).email)).toBeInstanceOf(FakeEmailProvider);
    expect(
      createEmailProvider(
        parseEnvironment({ RESEND_API_KEY: 'test-only', RESEND_FROM_EMAIL: 'sender@example.com' })
          .email,
      ),
    ).toBeInstanceOf(ResendEmailProvider);
  });

  it('delivers password reset and workspace invitation notifications through configured Brevo', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ messageId: '<test-message@brevo.example>' }), {
          status: 201,
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const provider = createEmailProvider(
      parseEnvironment({
        BREVO_API_KEY: 'test-only-key',
        BREVO_FROM_EMAIL: 'Wedding <sender@gmail.com>',
      }).email,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    const notification = createIdentityEmailNotificationPort(
      provider,
      'https://wedding.example.com',
    );
    await notification.sendPasswordReset({
      credentialId: '0195df70-4518-7ef8-b9db-063dc57b78d9',
      recipientEmail: 'couple@example.com',
      resetToken: 'test-reset-token',
    });
    await notification.sendWorkspaceInvitation({
      invitationId: '0195df70-4518-7ef8-b9db-063dc57b78d9',
      recipientEmail: 'couple@example.com',
      invitationToken: 'test-invitation-token',
    });
    const requestBodies = fetchMock.mock.calls.map(([, options]) => {
      if (typeof options?.body !== 'string') throw new Error('Expected JSON email request');
      return JSON.parse(options.body) as Record<string, unknown>;
    });
    expect(requestBodies[0]).toMatchObject({
      sender: { email: 'sender@gmail.com', name: 'Wedding' },
      to: [{ email: 'couple@example.com' }],
      textContent:
        'Open this link to reset your password: https://wedding.example.com/reset-password#test-reset-token',
    });
    expect(requestBodies[1]).toMatchObject({
      textContent:
        'Open this link to accept your invitation: https://wedding.example.com/workspace-invitation#test-invitation-token',
    });
    expect(requestBodies[0]?.headers).not.toEqual(requestBodies[1]?.headers);
  });
});
