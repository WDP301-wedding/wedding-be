import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { EmailProvider, SendEmailCommand } from '../../integrations/email/email-provider.js';
import { createIdentityEmailNotificationPort } from './identity-notification.port.js';

describe('identity email notification adapter', () => {
  it('places reset and invitation credentials in URL fragments at the final provider boundary', async () => {
    const commands: SendEmailCommand[] = [];
    const provider: EmailProvider = {
      send: vi.fn((command: SendEmailCommand) => {
        commands.push(command);
        return Promise.resolve({ idempotencyKey: command.idempotencyKey, messageId: randomUUID() });
      }),
    };
    const notifications = createIdentityEmailNotificationPort(
      provider,
      'https://couple.example.com',
    );
    const resetToken = `wip_${'a'.repeat(43)}`;
    const invitationToken = `wii_${'b'.repeat(43)}`;

    await notifications.sendPasswordReset({
      credentialId: randomUUID(),
      recipientEmail: 'couple@example.com',
      resetToken,
    });
    await notifications.sendWorkspaceInvitation({
      invitationId: randomUUID(),
      recipientEmail: 'couple@example.com',
      invitationToken,
    });

    expect(commands[0]?.text).toContain(`#${resetToken}`);
    expect(commands[1]?.text).toContain(`#${invitationToken}`);
    expect(commands.every(({ text }) => !text.includes(`?${resetToken}`))).toBe(true);
    expect(commands[0]?.idempotencyKey).toMatch(/^password-reset\//u);
    expect(commands[1]?.idempotencyKey).toMatch(/^workspace-invitation\//u);
  });

  it('rejects non-HTTPS public origins except loopback development URLs', () => {
    expect(() =>
      createIdentityEmailNotificationPort({ send: vi.fn() }, 'http://public.example.com'),
    ).toThrow(TypeError);
    expect(() =>
      createIdentityEmailNotificationPort({ send: vi.fn() }, 'http://localhost:3000'),
    ).not.toThrow();
  });

  it('uses the persisted delivery intent so a rotated credential has a distinct provider key', async () => {
    const keys: string[] = [];
    const notifications = createIdentityEmailNotificationPort(
      {
        send: (command) => {
          keys.push(command.idempotencyKey);
          return Promise.resolve({
            idempotencyKey: command.idempotencyKey,
            messageId: randomUUID(),
          });
        },
      },
      'https://couple.example.com',
    );
    const invitationId = randomUUID();
    const first = {
      invitationId,
      deliveryIntentId: randomUUID(),
      recipientEmail: 'couple@example.com',
      invitationToken: 'wii_first',
    };
    await notifications.sendWorkspaceInvitation(first);
    await notifications.sendWorkspaceInvitation(first);
    await notifications.sendWorkspaceInvitation({
      ...first,
      deliveryIntentId: randomUUID(),
      invitationToken: 'wii_rotated',
    });
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });
});
