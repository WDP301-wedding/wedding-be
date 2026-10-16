import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { withRequestDeadline } from '../http/request-deadline.js';
import { safeReadQuery } from './safe-read.js';

describe('explicit safe query enrollment', () => {
  const prisma = {} as PrismaClient;
  it('preserves the normal path without a request scope or when rollout is off', async () => {
    const read = vi.fn().mockResolvedValue('result');
    expect(await safeReadQuery(prisma, read, true)).toBe('result');
    await withRequestDeadline({ expiresAt: 0, signal: new AbortController().signal }, () =>
      safeReadQuery(prisma, read, false),
    );
    expect(read).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledWith(prisma);
  });
  it('does not return a completed read when the client disconnects before it finishes', async () => {
    const controller = new AbortController();
    const tx = { $executeRaw: vi.fn(), $queryRaw: vi.fn() };
    const client = {
      $transaction: (work: (t: typeof tx) => Promise<unknown>) => work(tx),
    } as unknown as PrismaClient;
    await expect(
      withRequestDeadline({ expiresAt: performance.now() + 1000, signal: controller.signal }, () =>
        safeReadQuery(
          client,
          () => {
            controller.abort();
            return Promise.resolve(1);
          },
          true,
        ),
      ),
    ).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
  });
});
