import { describe, expect, it, vi } from 'vitest';

import type { TimelineRevision } from '../domain/timeline.policy.js';
import { createPrismaTimelineRepository } from './timeline.repository.js';

const revision: TimelineRevision = Object.freeze({
  revisionId: '00000000-0000-4000-8000-000000000001',
  bookingId: '00000000-0000-4000-8000-000000000002',
  revisionNumber: 2,
  predecessorRevisionId: '00000000-0000-4000-8000-000000000003',
  state: 'CURRENT',
  managerApprovedAt: null,
  coupleApprovedAt: null,
  mutuallyApproved: false,
  items: Object.freeze([
    Object.freeze({
      itemId: '00000000-0000-4000-8000-000000000004',
      order: 0,
      startTime: '18:00',
      title: 'Welcome',
      description: null,
    }),
  ]),
  createdAt: new Date('2026-10-07T10:00:00.000Z'),
});

describe('PrismaTimelineRepository', () => {
  it('atomically supersedes the predecessor and stores an immutable successor', async () => {
    const transaction = fixture();
    transaction.booking.findUnique.mockResolvedValue({
      id: revision.bookingId,
      revision: 1,
      currentTimelineRevisionId: revision.predecessorRevisionId,
    });
    const repository = createPrismaTimelineRepository(client(transaction), ids());

    await expect(
      repository.save({
        revision,
        expectedBookingRevision: 1,
        actorAccountId: '00000000-0000-4000-8000-000000000005',
        party: 'COUPLE',
        requestId: '00000000-0000-4000-8000-000000000006',
      }),
    ).resolves.toMatchObject({ changed: true, bookingRevision: 2 });

    expect(transaction.bookingTimelineRevision.updateMany).toHaveBeenCalledWith({
      where: {
        id: revision.predecessorRevisionId,
        bookingId: revision.bookingId,
        state: 'CURRENT',
      },
      data: { state: 'SUPERSEDED' },
    });
    expect(transaction.bookingTimelineRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: revision.revisionId,
        items: {
          create: [
            expect.objectContaining({
              itemId: revision.items[0]!.itemId,
              displayOrder: 0,
              title: 'Welcome',
            }),
          ],
        },
      }),
    });
    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
    expect(transaction.bookingOutboxEvent.create).toHaveBeenCalledOnce();
  });

  it('records an exact party approval as immutable decision evidence', async () => {
    const transaction = fixture();
    transaction.booking.findUnique.mockResolvedValue({
      id: revision.bookingId,
      revision: 1,
      currentTimelineRevisionId: revision.revisionId,
    });
    const approvedAt = new Date('2026-10-07T10:05:00.000Z');
    const repository = createPrismaTimelineRepository(client(transaction), ids());
    const approvedRevision = { ...revision, managerApprovedAt: approvedAt };

    await repository.approve({
      bookingId: revision.bookingId,
      timelineRevisionId: revision.revisionId,
      expectedBookingRevision: 1,
      approvedRevision,
      decisionAt: approvedAt,
      actorAccountId: '00000000-0000-4000-8000-000000000005',
      party: 'MANAGER',
      requestId: '00000000-0000-4000-8000-000000000006',
    });

    expect(transaction.bookingTimelineRevision.updateMany).toHaveBeenCalledWith({
      where: { id: revision.revisionId, bookingId: revision.bookingId, state: 'CURRENT' },
      data: { managerApprovedAt: approvedAt, coupleApprovedAt: null },
    });
    expect(transaction.bookingTimelineDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ party: 'MANAGER', decision: 'APPROVED', sequence: 1 }),
    });
  });

  it('records withdrawal without changing the immutable timeline items', async () => {
    const transaction = fixture();
    transaction.booking.findUnique.mockResolvedValue({
      id: revision.bookingId,
      revision: 1,
      currentTimelineRevisionId: revision.revisionId,
    });
    const repository = createPrismaTimelineRepository(client(transaction), ids());
    await repository.withdraw({
      bookingId: revision.bookingId,
      timelineRevisionId: revision.revisionId,
      expectedBookingRevision: 1,
      withdrawnRevision: revision,
      decisionAt: new Date('2026-10-07T10:06:00.000Z'),
      reason: 'Needs another review',
      actorAccountId: '00000000-0000-4000-8000-000000000005',
      party: 'COUPLE',
      requestId: '00000000-0000-4000-8000-000000000006',
    });

    expect(transaction.bookingTimelineDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        party: 'COUPLE',
        decision: 'WITHDRAWN',
        reason: 'Needs another review',
      }),
    });
    expect('updateMany' in transaction.bookingTimelineItem).toBe(false);
  });
});

function fixture() {
  return {
    booking: {
      findUnique: vi.fn().mockResolvedValue({
        id: revision.bookingId,
        revision: 1,
        currentTimelineRevisionId: revision.predecessorRevisionId,
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    bookingTimelineRevision: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({}),
    },
    bookingTimelineDecision: {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({}),
    },
    bookingTimelineItem: {},
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    bookingOutboxEvent: { create: vi.fn().mockResolvedValue({}) },
  };
}

function client(transaction: object) {
  return {
    booking: (transaction as ReturnType<typeof fixture>).booking,
    $transaction: vi.fn(async (operation: (value: object) => Promise<unknown>) =>
      operation(transaction),
    ),
  } as never;
}

function ids(): () => string {
  let value = 10;
  return () => `00000000-0000-4000-8000-${String(value++).padStart(12, '0')}`;
}
