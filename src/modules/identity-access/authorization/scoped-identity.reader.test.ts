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
        $queryRaw: vi.fn().mockResolvedValue([]),
        accessCredential: {
          findUnique: vi
            .fn()
            .mockResolvedValueOnce({ id: randomUUID(), session: { id: sessionId, accountId } })
            .mockResolvedValueOnce({
              session: {
                id: target === 'session' ? randomUUID() : sessionId,
                accountId: target === 'account' ? randomUUID() : accountId,
              },
            }),
        },
      };
      const boundary = { current: () => tx } as unknown as PrismaBookingBoundary;
      const reader = createScopedIdentityReaders({} as PrismaClient, boundary);
      await expect(
        reader.resolver.resolve(issueOpaqueToken('access', 32).token),
      ).rejects.toMatchObject({ status: 401 });
      expect(tx.$queryRaw).toHaveBeenCalledTimes(4);
    },
  );
});
