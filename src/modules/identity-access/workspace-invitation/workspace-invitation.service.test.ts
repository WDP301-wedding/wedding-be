import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type {
  PersistInvitationInput,
  WorkspaceInvitationRepository,
} from './workspace-invitation.repository.js';
import { createWorkspaceInvitationService } from './workspace-invitation.service.js';

class FakeRepository implements WorkspaceInvitationRepository {
  persisted: PersistInvitationInput[] = [];

  issue(input: PersistInvitationInput) {
    this.persisted.push(input);
    return Promise.resolve({ invitationId: randomUUID(), sequence: 1 });
  }

  reissue(input: PersistInvitationInput) {
    this.persisted.push(input);
    return Promise.resolve({ invitationId: randomUUID(), sequence: 2 });
  }

  revoke(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

describe('IA-10 workspace invitation service', () => {
  it('exposes explicit issue, reissue, and idempotent revoke operations', async () => {
    const repository = new FakeRepository();
    const notifications: unknown[] = [];
    const service = createWorkspaceInvitationService({
      repository,
      notificationPort: {
        sendPasswordReset: vi.fn(() => Promise.resolve()),
        sendWorkspaceInvitation(command) {
          notifications.push(command);
          return Promise.resolve();
        },
      },
      tokenEntropyBytes: 32,
      lifetimeSeconds: 259_200,
      reissueLimit: 3,
      reissueWindowSeconds: 86_400,
      now: () => new Date('2026-10-03T00:00:00.000Z'),
    });
    const input = {
      consultationId: randomUUID(),
      recipientEmail: 'Couple@example.com',
      issuedByAccountId: randomUUID(),
      requestId: randomUUID(),
    };

    const issued = await service.issue(input);
    const reissued = await service.reissue(input);
    await expect(
      service.revoke({
        invitationId: issued.invitationId,
        actorAccountId: input.issuedByAccountId,
        requestId: randomUUID(),
      }),
    ).resolves.toEqual({ revoked: true });

    expect(issued.sequence).toBe(1);
    expect(reissued.sequence).toBe(2);
    expect(notifications).toHaveLength(2);
    expect(
      repository.persisted.every((value) => /^[A-Za-z0-9_-]{43}$/u.test(value.tokenHash)),
    ).toBe(true);
    expect(JSON.stringify(repository.persisted)).not.toContain(issued.invitationToken);
  });

  it('does not roll back persisted invitation state when the provider fails', async () => {
    const repository = new FakeRepository();
    const service = createWorkspaceInvitationService({
      repository,
      notificationPort: {
        sendPasswordReset: vi.fn(() => Promise.resolve()),
        sendWorkspaceInvitation: () => Promise.reject(new Error('provider raw detail')),
      },
      tokenEntropyBytes: 32,
      lifetimeSeconds: 259_200,
      reissueLimit: 3,
      reissueWindowSeconds: 86_400,
    });

    await expect(
      service.issue({
        consultationId: randomUUID(),
        recipientEmail: 'couple@example.com',
        issuedByAccountId: randomUUID(),
        requestId: randomUUID(),
      }),
    ).rejects.toThrow('provider raw detail');
    expect(repository.persisted).toHaveLength(1);
  });
});
