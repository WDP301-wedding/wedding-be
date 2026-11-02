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
  deliveryIntentId?: string;
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
        subject: 'Đặt lại mật khẩu tài khoản Hỷ Yến',
        text: `Mở liên kết này để đặt lại mật khẩu: ${link.toString()}`,
        to: [command.recipientEmail],
      });
    },

    async sendWorkspaceInvitation(command: WorkspaceInvitationNotification) {
      const link = new URL('/workspace-invitation', baseUrl);
      link.hash = command.invitationToken;
      await emailProvider.send({
        idempotencyKey: createEmailIntentIdempotencyKey({
          entityId: command.deliveryIntentId ?? command.invitationId,
          intentType: 'workspace-invitation',
        }),
        subject: 'Lời mời tham gia không gian tiệc cưới Hỷ Yến',
        text: `Mở liên kết này để nhận lời mời tham gia quản lý tiệc cưới: ${link.toString()}`,
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
