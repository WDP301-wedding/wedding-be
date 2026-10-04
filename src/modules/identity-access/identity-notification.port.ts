import {
  createEmailIntentIdempotencyKey,
  type EmailProvider,
} from '../../integrations/email/email-provider.js';

export type PasswordResetNotification = Readonly<{
  credentialId: string;
  recipientEmail: string;
  resetToken: string;
}>;

export type WorkspaceInvitationNotification = Readonly<{
  invitationId: string;
  recipientEmail: string;
  invitationToken: string;
}>;

export interface IdentityNotificationPort {
  sendPasswordReset(command: PasswordResetNotification): Promise<void>;
  sendWorkspaceInvitation(command: WorkspaceInvitationNotification): Promise<void>;
}

export function createIdentityEmailNotificationPort(
  emailProvider: EmailProvider,
  publicWebBaseUrl: string,
): IdentityNotificationPort {
  const baseUrl = parseBaseUrl(publicWebBaseUrl);

  return Object.freeze({
    async sendPasswordReset(command: PasswordResetNotification) {
      const link = new URL('/reset-password', baseUrl);
      link.hash = command.resetToken;
      await emailProvider.send({
        idempotencyKey: createEmailIntentIdempotencyKey({
          entityId: command.credentialId,
          intentType: 'password-reset',
        }),
        subject: 'Reset your password',
        text: `Open this link to reset your password: ${link.toString()}`,
        to: [command.recipientEmail],
      });
    },

    async sendWorkspaceInvitation(command: WorkspaceInvitationNotification) {
      const link = new URL('/workspace-invitation', baseUrl);
      link.hash = command.invitationToken;
      await emailProvider.send({
        idempotencyKey: createEmailIntentIdempotencyKey({
          entityId: command.invitationId,
          intentType: 'workspace-invitation',
        }),
        subject: 'Your wedding workspace invitation',
        text: `Open this link to accept your invitation: ${link.toString()}`,
        to: [command.recipientEmail],
      });
    },
  });
}

function parseBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
    throw new TypeError('The public Web base URL must use HTTPS.');
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new TypeError(
      'The public Web base URL must not contain credentials, query, or fragment.',
    );
  }
  return url;
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}
