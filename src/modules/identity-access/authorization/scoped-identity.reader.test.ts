import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { PrismaBookingBoundary } from '../../../core/database/booking-boundary.js';
import { issueOpaqueToken } from '../crypto/token.js';
import { createScopedIdentityReaders } from './scoped-identity.reader.js';

describe('Identity scoped authority follows only the locked immutable references', () => {
  it.each(['session', 'account'])(
    'rejects a concurrent reparenting of %s between lookup and lock',
    async (target) => {
      const accountId = randomUUID(),
        sessionId = randomUUID();
      const tx = {
        $queryRaw: vi
          .fn()
          .mockResolvedValueOnce([{ id: randomUUID(), sessionId, accountId }])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            {
              sessionId: target === 'session' ? randomUUID() : sessionId,
              accountId: target === 'account' ? randomUUID() : accountId,
            },
          ]),
      };
      const boundary = { current: () => tx } as unknown as PrismaBookingBoundary;
      const reader = createScopedIdentityReaders({} as PrismaClient, boundary);
      await expect(
        reader.resolver.resolve(issueOpaqueToken('access', 32).token),
      ).rejects.toMatchObject({ status: 401 });
      expect(tx.$queryRaw).toHaveBeenCalledTimes(6);
    },
  );

  it('reuses verified authority within the same transaction scope, avoiding redundant row locks', async () => {
    const accountId = randomUUID(),
      sessionId = randomUUID(),
      credId = randomUUID();
    const token = issueOpaqueToken('access', 32).token;
    const tx = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ id: credId, sessionId, accountId }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            sessionId,
            accountId,
            accountStatus: 'ACTIVE',
            sessionStatus: 'ACTIVE',
            credentialStatus: 'ACTIVE',
            roles: ['COUPLE'],
            credentialExpiresAt: new Date(Date.now() + 60_000),
            idleExpiresAt: new Date(Date.now() + 60_000),
            absoluteExpiresAt: new Date(Date.now() + 60_000),
            displayEmail: 'test@example.com',
          },
        ]),
    };
    const boundary = { current: () => tx } as unknown as PrismaBookingBoundary;
    const reader = createScopedIdentityReaders({} as PrismaClient, boundary);

    const first = await reader.resolver.resolve(token);
    expect(first.accountId).toBe(accountId);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(6);

    // Second resolution within the same transaction scope should hit cache
    const second = await reader.resolver.resolve(token);
    expect(second.accountId).toBe(accountId);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(6);
  });
});
