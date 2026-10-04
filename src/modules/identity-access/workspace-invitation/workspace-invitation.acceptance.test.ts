import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { RateLimitError } from '../../../core/errors/app-error.js';
import type { ScryptPasswordVerifier } from '../crypto/password.js';
import { createInMemoryAttemptThrottle } from '../session/session.service.js';
import type {
  AcceptInvitationInput,
  InvitationAcceptancePreview,
  WorkspaceInvitationAcceptanceRepository,
} from './workspace-invitation.repository.js';
import {
  createWorkspaceInvitationAcceptanceService,
  InvalidOrExpiredInvitationError,
} from './workspace-invitation.acceptance.js';

const verifier: ScryptPasswordVerifier = Object.freeze({
  algorithm: 'scrypt',
  version: 1,
  parameters: Object.freeze({
    cost: 2,
    blockSize: 1,
    parallelization: 1,
    keyLengthBytes: 16,
    maxMemoryBytes: 4096,
  }),
  saltEncoded: 'c2FsdC1zYWx0LXNhbHQtMQ',
  derivedKeyEncoded: 'ZGVyaXZlZC1rZXktMDE',
});

class FakeAcceptanceRepository implements WorkspaceInvitationAcceptanceRepository {
  preview: InvitationAcceptancePreview | null = null;
  accepted: AcceptInvitationInput[] = [];
  acceptSucceeds = true;

  previewAcceptance(): Promise<InvitationAcceptancePreview | null> {
    return Promise.resolve(this.preview);
  }

  accept(input: AcceptInvitationInput) {
    this.accepted.push(input);
    return Promise.resolve(
      this.acceptSucceeds
        ? {
            account: {
              accountId: input.expectedAccountId ?? randomUUID(),
              displayEmail: 'Couple@example.com',
              roles: [] as const,
            },
            consultationAccessId: randomUUID(),
            sessionId: randomUUID(),
          }
        : null,
    );
  }
}

function service(repository: FakeAcceptanceRepository) {
  return createWorkspaceInvitationAcceptanceService({
    repository,
    passwordCrypto: {
      hash: vi.fn(() => Promise.resolve(verifier)),
      verify: vi.fn((password: string) =>
        Promise.resolve({ matches: password === 'existing-password', needsRehash: false }),
      ),
    },
    throttle: createInMemoryAttemptThrottle(),
    config: {
      tokenEntropyBytes: 32,
      accessTokenTtlSeconds: 600,
      refreshIdleTtlSeconds: 2_592_000,
      refreshAbsoluteTtlSeconds: 7_776_000,
      tokenConsumeRateLimit: { maxAttempts: 10, windowSeconds: 900 },
    },
    now: () => new Date('2026-10-03T00:00:00.000Z'),
  });
}

describe('IA-11 workspace invitation acceptance', () => {
  it('sets the first password and creates a restricted Web session for a new account', async () => {
    const repository = new FakeAcceptanceRepository();
    repository.preview = {
      invitationId: randomUUID(),
      consultationId: randomUUID(),
      recipientEmailNormalized: 'couple@example.com',
      displayEmail: 'Couple@example.com',
      account: null,
    };
    const invitationToken = `wii_${'i'.repeat(43)}`;

    const result = await service(repository).accept({
      invitationToken,
      password: 'new-password-123',
      clientIp: '127.0.0.1',
      requestId: randomUUID(),
    });

    expect(result.clientKind).toBe('WEB');
    expect(result.account.roles).toEqual([]);
    expect(result.accessToken).toMatch(/^wia_/u);
    expect(result.refreshToken).toMatch(/^wir_/u);
    expect(repository.accepted).toHaveLength(1);
    expect(repository.accepted[0]).toMatchObject({
      expectedAccountId: null,
      newAccountPasswordVerifier: verifier,
    });
    expect(JSON.stringify(repository.accepted)).not.toContain(invitationToken);
  });

  it('verifies an existing password without replacing its verifier', async () => {
    const repository = new FakeAcceptanceRepository();
    const accountId = randomUUID();
    repository.preview = {
      invitationId: randomUUID(),
      consultationId: randomUUID(),
      recipientEmailNormalized: 'couple@example.com',
      displayEmail: 'Couple@example.com',
      account: {
        accountId,
        status: 'ACTIVE',
        passwordVerifier: verifier,
        passwordUpdatedAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    };

    await service(repository).accept({
      invitationToken: `wii_${'e'.repeat(43)}`,
      password: 'existing-password',
      clientIp: '127.0.0.1',
      requestId: randomUUID(),
    });

    expect(repository.accepted[0]).toMatchObject({
      expectedAccountId: accountId,
      newAccountPasswordVerifier: null,
    });
  });

  it('uses one generic failure for invalid, expired, replayed, and password-mismatch inputs', async () => {
    const missing = new FakeAcceptanceRepository();
    const existing = new FakeAcceptanceRepository();
    existing.preview = {
      invitationId: randomUUID(),
      consultationId: randomUUID(),
      recipientEmailNormalized: 'couple@example.com',
      displayEmail: 'Couple@example.com',
      account: {
        accountId: randomUUID(),
        status: 'ACTIVE',
        passwordVerifier: verifier,
        passwordUpdatedAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    };

    await expect(
      service(missing).accept({
        invitationToken: `wii_${'x'.repeat(43)}`,
        password: 'new-password-123',
        clientIp: '127.0.0.1',
        requestId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(InvalidOrExpiredInvitationError);
    await expect(
      service(existing).accept({
        invitationToken: `wii_${'y'.repeat(43)}`,
        password: 'wrong-password',
        clientIp: '127.0.0.1',
        requestId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(InvalidOrExpiredInvitationError);
    expect(existing.accepted).toHaveLength(0);
  });

  it('fails closed for malformed input, inactive accounts, and a lost transaction race', async () => {
    const repository = new FakeAcceptanceRepository();
    repository.preview = {
      invitationId: randomUUID(),
      consultationId: randomUUID(),
      recipientEmailNormalized: 'couple@example.com',
      displayEmail: 'Couple@example.com',
      account: {
        accountId: randomUUID(),
        status: 'DISABLED',
        passwordVerifier: verifier,
        passwordUpdatedAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    };
    const acceptance = service(repository);

    await expect(
      acceptance.accept({
        invitationToken: 'malformed',
        password: 'new-password-123',
        clientIp: '127.0.0.1',
        requestId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(InvalidOrExpiredInvitationError);
    await expect(
      acceptance.accept({
        invitationToken: `wii_${'d'.repeat(43)}`,
        password: 'existing-password',
        clientIp: '127.0.0.2',
        requestId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(InvalidOrExpiredInvitationError);

    repository.preview = { ...repository.preview, account: null };
    repository.acceptSucceeds = false;
    await expect(
      acceptance.accept({
        invitationToken: `wii_${'r'.repeat(43)}`,
        password: 'new-password-123',
        clientIp: '127.0.0.3',
        requestId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(InvalidOrExpiredInvitationError);
  });

  it('rejects invalid client IPs and throttles repeated token consumption', async () => {
    const repository = new FakeAcceptanceRepository();
    const acceptance = createWorkspaceInvitationAcceptanceService({
      repository,
      passwordCrypto: {
        hash: vi.fn(() => Promise.resolve(verifier)),
        verify: vi.fn(() => Promise.resolve({ matches: true, needsRehash: false })),
      },
      throttle: createInMemoryAttemptThrottle(),
      config: {
        tokenEntropyBytes: 32,
        accessTokenTtlSeconds: 600,
        refreshIdleTtlSeconds: 2_592_000,
        refreshAbsoluteTtlSeconds: 7_776_000,
        tokenConsumeRateLimit: { maxAttempts: 1, windowSeconds: 900 },
      },
      now: () => new Date('2026-10-03T00:00:00.000Z'),
    });
    const command = {
      invitationToken: `wii_${'t'.repeat(43)}`,
      password: 'new-password-123',
      clientIp: '127.0.0.1',
      requestId: randomUUID(),
    };

    await expect(acceptance.accept({ ...command, clientIp: 'invalid' })).rejects.toBeInstanceOf(
      TypeError,
    );
    await expect(acceptance.accept(command)).rejects.toBeInstanceOf(
      InvalidOrExpiredInvitationError,
    );
    await expect(acceptance.accept(command)).rejects.toBeInstanceOf(RateLimitError);
  });
});
