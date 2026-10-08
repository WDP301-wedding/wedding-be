import { describe, expect, it, vi } from 'vitest';
import { createPrismaBookingAutomationRepository } from './automation.repository.js';

const input = {
  bookingId: '00000000-0000-4000-8000-000000000001',
  commandId: '00000000-0000-4000-8000-000000000002',
  expectedBookingRevision: 4,
  now: '2026-12-21T03:00:00.000Z',
};
const context = {
  requestId: input.commandId,
  causationId: input.commandId,
  authority: 'SYSTEM' as const,
  actorAccountId: null,
};
function fixture() {
  const tx = {
    $executeRaw: vi.fn(),
    bookingAutomationCommand: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
    booking: {
      findUnique: vi.fn().mockResolvedValue({
        id: input.bookingId,
        phase: 'CONFIRMED',
        revision: 4,
        eventDate: new Date('2026-12-20'),
        proposalSnapshot: { shiftEndTime: new Date('1970-01-01T22:00:00Z') },
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    auditLog: { create: vi.fn() },
    bookingOutboxEvent: { create: vi.fn() },
  };
  const prisma = {
    $transaction: vi.fn(async (work: (tx: object) => Promise<unknown>) => work(tx)),
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
  return {
    tx,
    prisma,
    repository: createPrismaBookingAutomationRepository(prisma as never, () => new Date(input.now)),
  };
}
describe('booking automation persistence', () => {
  it('completes once with an atomic command journal, audit and outbox', async () => {
    const { tx, repository } = fixture();
    await expect(repository.completeDue(input, context)).resolves.toEqual({ outcome: 'COMPLETED' });
    expect(tx.bookingAutomationCommand.create).toHaveBeenCalledOnce();
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
    expect(tx.bookingOutboxEvent.create).toHaveBeenCalledOnce();
    tx.bookingAutomationCommand.findUnique.mockResolvedValue({
      bookingId: input.bookingId,
      expectedRevision: 4,
      requestedAt: new Date(input.now),
    });
    await expect(repository.completeDue(input, context)).resolves.toEqual({ outcome: 'REPLAYED' });
    await expect(
      repository.completeDue({ ...input, expectedBookingRevision: 5 }, context),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(tx.booking.updateMany).toHaveBeenCalledOnce();
  });
  it.each(['CANCELLED', 'COMPLETED', 'DRAFT'])('skips %s without writes', async (phase) => {
    const { tx, repository } = fixture();
    tx.booking.findUnique.mockResolvedValue({ ...(await tx.booking.findUnique()), phase });
    await expect(repository.completeDue(input, context)).resolves.toMatchObject({
      outcome: phase === 'DRAFT' ? 'NOT_DUE' : 'SKIPPED_TERMINAL',
    });
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
  });
  it('rejects stale, missing, and raced commands; leaves early completion pending', async () => {
    const { tx, repository } = fixture();
    await expect(
      repository.completeDue({ ...input, expectedBookingRevision: 3 }, context),
    ).rejects.toMatchObject({ code: 'STALE_BOOKING_REVISION' });
    tx.booking.updateMany.mockResolvedValue({ count: 0 });
    await expect(repository.completeDue(input, context)).rejects.toMatchObject({
      code: 'STALE_BOOKING_REVISION',
    });
    tx.booking.findUnique.mockResolvedValue({
      ...(await tx.booking.findUnique()),
      eventDate: new Date('2026-12-22'),
    });
    await expect(repository.completeDue(input, context)).resolves.toMatchObject({
      outcome: 'NOT_DUE',
    });
    tx.booking.findUnique.mockResolvedValue(null);
    await expect(repository.completeDue(input, context)).rejects.toMatchObject({ status: 404 });
  });
  it('binds the worker cursor to its due query and returns bounded pages', async () => {
    const { prisma, repository } = fixture();
    const row = {
      bookingId: input.bookingId,
      bookingRevision: 4,
      dueAt: new Date(input.now),
      coupleAccountId: input.commandId,
    };
    prisma.$queryRaw.mockResolvedValue([row, row]);
    const query = { kind: 'COMPLETION' as const, dueBefore: input.now, limit: 1 };
    const page = await repository.listDue(query, context);
    expect(page.items).toHaveLength(1);
    await expect(
      repository.listDue({ ...query, cursor: page.nextCursor!, kind: 'D3_REMINDER' }, context),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      repository.listDue({ ...query, cursor: 'invalid' }, context),
    ).rejects.toMatchObject({ status: 422 });
    prisma.$queryRaw.mockResolvedValue([]);
    await expect(
      repository.listDue({ ...query, cursor: page.nextCursor! }, context),
    ).resolves.toMatchObject({ nextCursor: null, items: [] });
    await expect(
      repository.listDue({ ...query, kind: 'D3_REMINDER' }, context),
    ).resolves.toMatchObject({ nextCursor: null });
  });
});
