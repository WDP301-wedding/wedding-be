import { describe, expect, it, vi } from 'vitest';

import {
  createPrismaBookingLifecycleRepository,
  type BookingLifecycleMutationContext,
} from './lifecycle.repository.js';

const context: BookingLifecycleMutationContext = Object.freeze({
  requestId: '00000000-0000-4000-8000-000000000001',
  actorAccountId: '00000000-0000-4000-8000-000000000002',
});
const now = new Date('2026-12-21T03:00:00.000Z');

describe('PrismaBookingLifecycleRepository', () => {
  it('applies a newer aggregate headcount sequence and ignores an older one', async () => {
    const transaction = fixture();
    const repository = createPrismaBookingLifecycleRepository(
      client(transaction),
      () => now,
      ids(),
    );
    await expect(
      repository.synchronizeHeadcount(
        {
          bookingId: 'booking',
          sourceRsvpRevisionId: '00000000-0000-4000-8000-000000000010',
          sourceSequence: 10,
          expectedAttendees: 120,
        },
        context,
      ),
    ).resolves.toMatchObject({ outcome: 'APPLIED', appliedSourceSequence: 10, bookingRevision: 5 });

    expect(transaction.bookingHeadcountEvidence.upsert).toHaveBeenCalledOnce();
    expect(transaction.booking.updateMany).toHaveBeenCalledWith({
      where: { id: 'booking', revision: 4 },
      data: { planningHeadcount: 120, revision: { increment: 1 } },
    });

    transaction.bookingHeadcountEvidence.findUnique.mockResolvedValue({
      sourceRsvpRevisionId: '00000000-0000-4000-8000-000000000010',
      sourceSequence: 10,
      expectedAttendees: 120,
    });
    await expect(
      repository.synchronizeHeadcount(
        {
          bookingId: 'booking',
          sourceRsvpRevisionId: '00000000-0000-4000-8000-000000000009',
          sourceSequence: 9,
          expectedAttendees: 110,
        },
        context,
      ),
    ).resolves.toMatchObject({ outcome: 'IGNORED_STALE', bookingRevision: 4 });
  });

  it('approves a pending cancellation and preserves historical money facts', async () => {
    const transaction = fixture();
    transaction.booking.findUnique.mockResolvedValue({
      id: 'booking',
      revision: 4,
      phase: 'CONFIRMED',
      eventDate: new Date('2026-12-22T00:00:00.000Z'),
      proposalSnapshot: {
        shiftStartTime: new Date('1970-01-01T17:30:00.000Z'),
        shiftEndTime: new Date('1970-01-01T22:00:00.000Z'),
      },
    });
    transaction.bookingCancellationRequest.findUnique.mockResolvedValue({
      id: 'request',
      bookingId: 'booking',
      status: 'PENDING',
    });
    const repository = createPrismaBookingLifecycleRepository(
      client(transaction),
      () => now,
      ids(),
    );

    await repository.decideCancellation({
      bookingId: 'booking',
      cancellationRequestId: 'request',
      expectedBookingRevision: 4,
      decision: 'APPROVE',
      reason: 'Approved by manager',
      context,
    });

    expect(transaction.booking.updateMany).toHaveBeenCalledWith({
      where: { id: 'booking', revision: 4, phase: 'CONFIRMED' },
      data: { phase: 'CANCELLED', cancelledAt: now, revision: { increment: 1 } },
    });
    expect('updateMany' in transaction.bookingDepositSettlement).toBe(false);
  });

  it('completes only a confirmed event after the twelve-hour guard', async () => {
    const transaction = fixture();
    const repository = createPrismaBookingLifecycleRepository(
      client(transaction),
      () => now,
      ids(),
    );
    await repository.complete({ bookingId: 'booking', expectedBookingRevision: 4, context });

    expect(transaction.booking.updateMany).toHaveBeenCalledWith({
      where: { id: 'booking', revision: 4, phase: 'CONFIRMED' },
      data: { phase: 'COMPLETED', completedAt: now, revision: { increment: 1 } },
    });
  });
});

function fixture() {
  return {
    booking: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'booking',
        revision: 4,
        phase: 'CONFIRMED',
        eventDate: new Date('2026-12-20T00:00:00.000Z'),
        proposalSnapshot: {
          shiftStartTime: new Date('1970-01-01T17:30:00.000Z'),
          shiftEndTime: new Date('1970-01-01T22:00:00.000Z'),
        },
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    bookingHeadcountEvidence: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    bookingCancellationRequest: {
      findUnique: vi.fn(),
      create: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    bookingDepositIntent: { findFirst: vi.fn().mockResolvedValue(null) },
    bookingDepositSettlement: {},
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    bookingOutboxEvent: { create: vi.fn().mockResolvedValue({}) },
  };
}

function client(transaction: object) {
  return {
    $transaction: vi.fn(async (operation: (value: object) => Promise<unknown>) =>
      operation(transaction),
    ),
  } as never;
}

function ids(): () => string {
  let value = 100;
  return () => `00000000-0000-4000-8000-${String(value++).padStart(12, '0')}`;
}
