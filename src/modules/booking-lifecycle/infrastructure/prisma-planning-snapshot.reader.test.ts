import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { PrismaBookingBoundary } from '../../../core/database/booking-boundary.js';
import { createPrismaPlanningSnapshotReader } from './prisma-planning-snapshot.reader.js';

function fixture(changes: Record<string, unknown> = {}) {
  const bookingId = randomUUID();
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([]),
    booking: {
      findUnique: vi.fn().mockResolvedValue({
        id: bookingId,
        phase: 'CONFIRMED',
        revision: 1,
        planningHeadcount: 20,
        ...changes,
      }),
    },
  };
  const prisma = {
    $transaction: (work: (transaction: typeof tx) => Promise<unknown>) => work(tx),
  } as unknown as PrismaClient;
  const boundary = new PrismaBookingBoundary(prisma);
  const context = {
    requestId: randomUUID(),
    causationId: randomUUID(),
    actorAccountId: randomUUID(),
    authority: 'AUTHENTICATED' as const,
  };
  const reader = createPrismaPlanningSnapshotReader(boundary);
  return {
    tx,
    read: () =>
      boundary.run({ bookingId, context }, (scope) => reader.getCurrent(bookingId, scope)),
    unscoped: () => reader.getCurrent(bookingId, { ...context, transactionScopeId: randomUUID() }),
    bookingId,
  };
}

describe('Booking planning snapshot validation', () => {
  it.each([0, 10_000])(
    'retains the explicitly entered planning boundary %i',
    async (planningHeadcount) => {
      const f = fixture({ planningHeadcount });
      expect(await f.read()).toEqual({
        bookingId: f.bookingId,
        bookingRevision: 1,
        planningHeadcount,
      });
    },
  );

  it.each(['DRAFT', 'CANCELLED', 'COMPLETED'])(
    'does not expose selection planning for a %s event',
    async (phase) => {
      await expect(fixture({ phase }).read()).rejects.toMatchObject({ status: 404 });
    },
  );

  it.each([
    { revision: 0 },
    { revision: 1.5 },
    { revision: Number.MAX_SAFE_INTEGER + 1 },
    { planningHeadcount: -1 },
    { planningHeadcount: 10_001 },
  ])('rejects invalid stored planning facts %j', async (changes) => {
    await expect(fixture(changes).read()).rejects.toMatchObject({ status: 422 });
  });

  it('rejects an unbound transaction context before reading any booking data', async () => {
    const f = fixture();
    await expect(f.unscoped()).rejects.toMatchObject({ status: 422 });
    expect(f.tx.booking.findUnique).not.toHaveBeenCalled();
  });
});
