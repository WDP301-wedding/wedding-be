import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createReportingFeed } from './reporting-feed.js';
import type { PrismaClient, Prisma } from '../../generated/prisma/client.js';
const context = {
  authority: 'AUTHENTICATED' as const,
  actorAccountId: 'manager',
  requestId: 'request',
  causationId: 'request',
};
function fixture() {
  const tx = {
    account: {
      findUnique: vi.fn(
        async () => await Promise.resolve({ status: 'ACTIVE', roles: [{ role: 'MANAGER' }] }),
      ),
    },
    reportingSequence: {
      findUniqueOrThrow: vi.fn(async () => await Promise.resolve({ value: 3 })),
    },
    reportingFact: {
      findMany: vi.fn(
        async () =>
          await Promise.resolve(
            [1, 2, 3].map((sequence) => ({
              recordId: String(sequence),
              sequence,
              changedAt: new Date('2026-10-13T00:00:00Z'),
              value: { id: String(sequence) },
            })),
          ),
      ),
    },
  };
  const prisma = {
    $transaction: async <T>(work: (t: Prisma.TransactionClient) => Promise<T>) =>
      await Promise.resolve(work(tx as unknown as Prisma.TransactionClient)),
  } as unknown as PrismaClient;
  return { tx, reader: createReportingFeed(prisma, 'booking', z.strictObject({ id: z.string() })) };
}
describe('strict owner reporting feed', () => {
  it('pages through a frozen commit-ordered fence and parses minimal DTOs', async () => {
    const f = fixture();
    const page = await f.reader.readPage({ afterSequence: 0, limit: 2 }, context);
    expect(page.rows.map((r) => r.sequence)).toEqual([1, 2]);
    expect(page.nextCursor).not.toBeNull();
    f.tx.reportingFact.findMany.mockResolvedValue([
      { recordId: '3', sequence: 3, changedAt: new Date(), value: { id: '3' } },
    ]);
    const next = await f.reader.readPage(
      { afterSequence: 0, throughSequence: 3, limit: 2, cursor: page.nextCursor! },
      context,
    );
    expect(next.nextCursor).toBeNull();
    expect(f.tx.reportingFact.findMany).toHaveBeenLastCalledWith({
      where: { owner: 'booking', sequence: { gt: 2, lte: 3 } },
      orderBy: { sequence: 'asc' },
      take: 3,
    });
  });
  it('rejects malformed/foreign/stale/out-of-range cursors and query bounds', async () => {
    const f = fixture();
    const encode = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
    for (const cursor of [
      'bad',
      encode({ owner: 'staff', afterSequence: 0, throughSequence: 3, sequence: 1 }),
      encode({ owner: 'booking', afterSequence: 1, throughSequence: 3, sequence: 1 }),
      encode({ owner: 'booking', afterSequence: 0, throughSequence: 2, sequence: 1 }),
      encode({ owner: 'booking', afterSequence: 0, throughSequence: 3, sequence: 4 }),
    ])
      await expect(
        f.reader.readPage({ afterSequence: 0, throughSequence: 3, limit: 2, cursor }, context),
      ).rejects.toMatchObject({ status: 422 });
    await expect(
      f.reader.readPage({ afterSequence: 3, throughSequence: 2, limit: 1 }, context),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      f.reader.readPage({ afterSequence: 0, throughSequence: 4, limit: 1 }, context),
    ).rejects.toMatchObject({ status: 422 });
    await expect(f.reader.readPage({ afterSequence: 0, limit: 501 }, context)).rejects.toThrow();
  });
  it('checks active Manager even on empty pages and refuses SYSTEM/anonymous readers', async () => {
    const f = fixture();
    for (const c of [
      { ...context, authority: 'SYSTEM' as const, actorAccountId: null },
      { ...context, actorAccountId: null },
    ])
      await expect(f.reader.readPage({ afterSequence: 0, limit: 1 }, c)).rejects.toMatchObject({
        status: 403,
      });
    f.tx.account.findUnique.mockResolvedValue({
      status: 'SUSPENDED',
      roles: [{ role: 'MANAGER' }],
    });
    await expect(f.reader.readPage({ afterSequence: 0, limit: 1 }, context)).rejects.toMatchObject({
      status: 403,
    });
    f.tx.account.findUnique.mockResolvedValue({ status: 'ACTIVE', roles: [{ role: 'STAFF' }] });
    await expect(f.reader.readPage({ afterSequence: 0, limit: 1 }, context)).rejects.toMatchObject({
      status: 403,
    });
  });
});
