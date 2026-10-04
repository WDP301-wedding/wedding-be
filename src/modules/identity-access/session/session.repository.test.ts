import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import { createPrismaSessionRepository } from './session.repository.js';

const now = new Date('2026-10-03T00:00:00.000Z');
const idleExpiresAt = new Date('2026-11-02T00:00:00.000Z');
const absoluteExpiresAt = new Date('2027-01-01T00:00:00.000Z');

describe('Prisma session repository', () => {
  it('creates one session family with only credential hashes', async () => {
    const sessionId = randomUUID();
    const transaction = {
      session: {
        create: vi.fn(() => Promise.resolve({ id: sessionId, accountId: 'account-1' })),
      },
    };
    const repository = createPrismaSessionRepository(transactionalPrisma(transaction));

    await expect(
      repository.createSession({
        accountId: 'account-1',
        clientKind: 'WEB',
        accessTokenHash: 'a'.repeat(43),
        refreshTokenHash: 'b'.repeat(43),
        accessExpiresAt: new Date('2026-10-03T00:10:00.000Z'),
        idleExpiresAt,
        absoluteExpiresAt,
        now,
      }),
    ).resolves.toEqual({ sessionId, accountId: 'account-1' });
    expect(JSON.stringify(transaction.session.create.mock.calls)).not.toMatch(/wia_|wir_/u);
  });

  it('rotates an active refresh and clamps both successors to absolute expiry', async () => {
    const sessionId = randomUUID();
    const transaction = activeRotationTransaction(sessionId);
    const repository = createPrismaSessionRepository(transactionalPrisma(transaction));

    await expect(
      repository.rotateRefresh({
        presentedTokenHash: 'b'.repeat(43),
        successorTokenHash: 'c'.repeat(43),
        accessTokenHash: 'd'.repeat(43),
        requestedAccessExpiresAt: new Date('2027-02-01T00:00:00.000Z'),
        requestedIdleExpiresAt: new Date('2027-02-01T00:00:00.000Z'),
        now,
      }),
    ).resolves.toMatchObject({
      outcome: 'ROTATED',
      sessionId,
      accessExpiresAt: absoluteExpiresAt,
      refreshExpiresAt: absoluteExpiresAt,
    });
    expect(transaction.refreshCredential.create).toHaveBeenCalledOnce();
    expect(transaction.accessCredential.create).toHaveBeenCalledOnce();
  });

  it('keeps requested expiries when they are earlier than the absolute limit', async () => {
    const sessionId = randomUUID();
    const transaction = activeRotationTransaction(sessionId);
    const repository = createPrismaSessionRepository(transactionalPrisma(transaction));
    const accessExpiry = new Date('2026-10-03T00:10:00.000Z');

    await expect(
      repository.rotateRefresh({
        presentedTokenHash: 'b'.repeat(43),
        successorTokenHash: 'c'.repeat(43),
        accessTokenHash: 'd'.repeat(43),
        requestedAccessExpiresAt: accessExpiry,
        requestedIdleExpiresAt: idleExpiresAt,
        now,
      }),
    ).resolves.toMatchObject({
      outcome: 'ROTATED',
      accessExpiresAt: accessExpiry,
      refreshExpiresAt: idleExpiresAt,
    });
  });

  it('retries a serializable transaction conflict once', async () => {
    const transaction = activeRotationTransaction(randomUUID());
    const retryError = new Prisma.PrismaClientKnownRequestError('retry', {
      code: 'P2034',
      clientVersion: '7.10.0',
    });
    const execute = vi
      .fn()
      .mockRejectedValueOnce(retryError)
      .mockImplementationOnce((operation: (candidate: object) => Promise<unknown>) =>
        operation(transaction),
      );
    const repository = createPrismaSessionRepository(prisma({ $transaction: execute }));

    await expect(
      repository.rotateRefresh({
        presentedTokenHash: 'b'.repeat(43),
        successorTokenHash: 'c'.repeat(43),
        accessTokenHash: 'd'.repeat(43),
        requestedAccessExpiresAt: new Date('2026-10-03T00:10:00.000Z'),
        requestedIdleExpiresAt: idleExpiresAt,
        now,
      }),
    ).resolves.toMatchObject({ outcome: 'ROTATED' });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-transaction error', async () => {
    const failure = new Error('database unavailable');
    const execute = vi.fn(() => Promise.reject(failure));
    const repository = createPrismaSessionRepository(prisma({ $transaction: execute }));

    await expect(
      repository.rotateRefresh({
        presentedTokenHash: 'b'.repeat(43),
        successorTokenHash: 'c'.repeat(43),
        accessTokenHash: 'd'.repeat(43),
        requestedAccessExpiresAt: new Date('2026-10-03T00:10:00.000Z'),
        requestedIdleExpiresAt: idleExpiresAt,
        now,
      }),
    ).rejects.toBe(failure);
    expect(execute).toHaveBeenCalledOnce();
  });

  it('revokes the active family when a consumed refresh is replayed', async () => {
    const sessionId = randomUUID();
    const transaction = activeRotationTransaction(sessionId, 'CONSUMED');
    const repository = createPrismaSessionRepository(transactionalPrisma(transaction));

    await expect(
      repository.rotateRefresh({
        presentedTokenHash: 'b'.repeat(43),
        successorTokenHash: 'c'.repeat(43),
        accessTokenHash: 'd'.repeat(43),
        requestedAccessExpiresAt: new Date('2026-10-03T00:10:00.000Z'),
        requestedIdleExpiresAt: idleExpiresAt,
        now,
      }),
    ).resolves.toMatchObject({ outcome: 'REPLAYED', sessionId });
    expect(transaction.sessionUpdates[0]).toMatchObject({
      data: { status: 'COMPROMISED' },
    });
    expect(transaction.refreshCredential.updateMany).toHaveBeenCalledOnce();
    expect(transaction.accessCredential.updateMany).toHaveBeenCalledOnce();
  });

  it.each([
    [null],
    [{ ...refreshRecord(randomUUID()), status: 'REVOKED' }],
    [{ ...refreshRecord(randomUUID()), expiresAt: now }],
    [
      {
        ...refreshRecord(randomUUID()),
        session: { ...refreshRecord(randomUUID()).session, status: 'REVOKED' },
      },
    ],
    [
      {
        ...refreshRecord(randomUUID()),
        session: { ...refreshRecord(randomUUID()).session, idleExpiresAt: now },
      },
    ],
    [
      {
        ...refreshRecord(randomUUID()),
        session: { ...refreshRecord(randomUUID()).session, absoluteExpiresAt: now },
      },
    ],
    [
      {
        ...refreshRecord(randomUUID()),
        session: {
          ...refreshRecord(randomUUID()).session,
          account: { status: 'DISABLED' },
        },
      },
    ],
  ])('rejects missing or stale refresh state', async (record) => {
    const transaction = activeRotationTransaction(randomUUID());
    transaction.refreshCredential.findUnique.mockResolvedValue(record);
    const repository = createPrismaSessionRepository(transactionalPrisma(transaction));

    await expect(
      repository.rotateRefresh({
        presentedTokenHash: 'b'.repeat(43),
        successorTokenHash: 'c'.repeat(43),
        accessTokenHash: 'd'.repeat(43),
        requestedAccessExpiresAt: new Date('2026-10-03T00:10:00.000Z'),
        requestedIdleExpiresAt: idleExpiresAt,
        now,
      }),
    ).resolves.toEqual({ outcome: 'INVALID' });
  });

  it('treats a lost consume race as replay and compromises the session', async () => {
    const sessionId = randomUUID();
    const transaction = activeRotationTransaction(sessionId);
    transaction.refreshCredential.updateMany.mockResolvedValue({ count: 0 });
    const repository = createPrismaSessionRepository(transactionalPrisma(transaction));

    await expect(
      repository.rotateRefresh({
        presentedTokenHash: 'b'.repeat(43),
        successorTokenHash: 'c'.repeat(43),
        accessTokenHash: 'd'.repeat(43),
        requestedAccessExpiresAt: new Date('2026-10-03T00:10:00.000Z'),
        requestedIdleExpiresAt: idleExpiresAt,
        now,
      }),
    ).resolves.toMatchObject({ outcome: 'REPLAYED' });
  });

  it('revokes only an owned session and keeps the operation idempotent', async () => {
    const sessionId = randomUUID();
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: sessionId, status: 'REVOKED' }])
      .mockResolvedValueOnce([{ id: sessionId, status: 'ACTIVE' }]);
    const transaction = revocationTransaction(findMany);
    const repository = createPrismaSessionRepository(transactionalPrisma(transaction));
    const input = { accountId: randomUUID(), sessionId, reason: 'owner-revoked', now };

    await expect(repository.revokeSession(input)).resolves.toBe(false);
    await expect(repository.revokeSession(input)).resolves.toBe(true);
    await expect(repository.revokeSession({ sessionId, reason: 'internal', now })).resolves.toBe(
      true,
    );
    expect(transaction.session.updateMany).toHaveBeenCalledOnce();
  });

  it('revokes all active sessions and returns the affected count', async () => {
    const findMany = vi.fn(() => Promise.resolve([{ id: randomUUID() }, { id: randomUUID() }]));
    const transaction = revocationTransaction(findMany);
    const repository = createPrismaSessionRepository(transactionalPrisma(transaction));

    await expect(
      repository.revokeAllSessions({ accountId: randomUUID(), reason: 'password-reset', now }),
    ).resolves.toBe(2);
    expect(transaction.accessCredential.updateMany).toHaveBeenCalledOnce();
    expect(transaction.refreshCredential.updateMany).toHaveBeenCalledOnce();
  });

  it('does no credential work when an account has no active sessions', async () => {
    const transaction = revocationTransaction(vi.fn(() => Promise.resolve([])));
    const repository = createPrismaSessionRepository(transactionalPrisma(transaction));

    await expect(
      repository.revokeAllSessions({ accountId: randomUUID(), reason: 'account-disabled', now }),
    ).resolves.toBe(0);
    expect(transaction.accessCredential.updateMany).not.toHaveBeenCalled();
    expect(transaction.refreshCredential.updateMany).not.toHaveBeenCalled();
  });

  it('returns safe summaries and current actor state without credential material', async () => {
    const sessionId = randomUUID();
    const accountId = randomUUID();
    const session = {
      id: sessionId,
      clientKind: 'ANDROID',
      status: 'ACTIVE',
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt,
      absoluteExpiresAt,
    };
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        status: 'ACTIVE',
        expiresAt: new Date('2026-10-03T00:10:00.000Z'),
        session: {
          ...session,
          accountId,
          account: {
            displayEmail: 'couple@example.com',
            status: 'ACTIVE',
            roles: [{ role: 'COUPLE' }],
          },
        },
      });
    const findManySessions = vi.fn(() => Promise.resolve([session]));
    const repository = createPrismaSessionRepository(
      prisma({
        session: { findMany: findManySessions },
        accessCredential: { findUnique },
      }),
    );

    await expect(repository.listSessions(accountId, { limit: 20 })).resolves.toEqual({
      sessions: [
        {
          sessionId,
          clientKind: 'ANDROID',
          status: 'ACTIVE',
          createdAt: now,
          lastSeenAt: now,
          idleExpiresAt,
          absoluteExpiresAt,
        },
      ],
      nextCursor: null,
    });
    expect(findManySessions).toHaveBeenCalledWith(expect.objectContaining({ take: 21 }));
    await expect(repository.findActorByAccessTokenHash('x'.repeat(43))).resolves.toBeNull();
    await expect(repository.findActorByAccessTokenHash('y'.repeat(43))).resolves.toMatchObject({
      accountId,
      sessionId,
      displayEmail: 'couple@example.com',
      roles: ['COUPLE'],
    });
  });
});

function refreshRecord(sessionId: string) {
  return {
    id: randomUUID(),
    sessionId,
    status: 'ACTIVE',
    expiresAt: idleExpiresAt,
    session: {
      id: sessionId,
      accountId: randomUUID(),
      clientKind: 'WEB',
      status: 'ACTIVE',
      idleExpiresAt,
      absoluteExpiresAt,
      account: { status: 'ACTIVE' },
    },
  };
}

function activeRotationTransaction(sessionId: string, status = 'ACTIVE') {
  const sessionUpdates: unknown[] = [];
  return {
    sessionUpdates,
    refreshCredential: {
      findUnique: vi.fn<() => Promise<unknown>>(() =>
        Promise.resolve({ ...refreshRecord(sessionId), status }),
      ),
      updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
      create: vi.fn(() => Promise.resolve({})),
    },
    accessCredential: {
      updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
      create: vi.fn(() => Promise.resolve({})),
    },
    session: {
      updateMany: vi.fn((input: unknown) => {
        sessionUpdates.push(input);
        return Promise.resolve({ count: 1 });
      }),
      update: vi.fn(() => Promise.resolve({})),
    },
  };
}

function revocationTransaction(findMany: ReturnType<typeof vi.fn>) {
  return {
    session: {
      findMany,
      updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
    },
    accessCredential: { updateMany: vi.fn(() => Promise.resolve({ count: 1 })) },
    refreshCredential: { updateMany: vi.fn(() => Promise.resolve({ count: 1 })) },
  };
}

function prisma(value: object): PrismaClient {
  return value as unknown as PrismaClient;
}

function transactionalPrisma(transaction: object): PrismaClient {
  return prisma({
    $transaction: (operation: (candidate: object) => Promise<unknown>) => operation(transaction),
  });
}
