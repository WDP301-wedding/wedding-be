/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Vitest asymmetric matchers are typed as any. */
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
  it.each(['direct', 'approved request'] as const)(
    'releases the unpinned Draft hold when cancellation is %s',
    async (mode) => {
      const transaction = fixture();
      const booking = await transaction.booking.findUnique();
      transaction.booking.findUnique.mockResolvedValue({ ...booking, phase: 'DRAFT' });
      transaction.bookingCancellationRequest.findUnique.mockResolvedValue({
        id: 'request',
        bookingId: 'booking',
        status: 'PENDING',
      });
      const hold = { id: 'hold', status: 'ACTIVE', terminalAt: null as Date | null };
      transaction.bookingSlotHold.findMany.mockResolvedValue([hold]);
      transaction.bookingSlotHold.updateMany.mockImplementation(() => {
        hold.status = 'RELEASED';
        hold.terminalAt = new Date('2026-12-19T00:00:00Z');
        return Promise.resolve({ count: 1 });
      });
      const repository = createPrismaBookingLifecycleRepository(
        client(transaction),
        () => new Date('2026-12-19T00:00:00Z'),
        ids(),
      );
      const input = {
        bookingId: 'booking',
        expectedBookingRevision: 4,
        reason: 'Private reason',
        context,
      };
      const result =
        mode === 'direct'
          ? await repository.cancel(input)
          : await repository.decideCancellation({
              ...input,
              cancellationRequestId: 'request',
              decision: 'APPROVE',
            });
      expect(result).toEqual({ phase: 'CANCELLED', bookingRevision: 5 });
      expect(hold).toMatchObject({
        status: 'RELEASED',
        terminalAt: new Date('2026-12-19T00:00:00Z'),
      });
      expect(transaction.bookingSlotHold.findMany).toHaveBeenCalledWith({
        where: {
          bookingId: 'booking',
          status: 'ACTIVE',
          depositIntentPin: { notIn: ['ACTIVE', 'UNKNOWN'] },
        },
        select: { id: true },
      });
      expect(transaction.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'booking.slot-released' }),
        }),
      );
      expect(transaction.bookingOutboxEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ eventType: 'booking.slot-released' }),
        }),
      );
      expect(JSON.stringify(transaction.bookingOutboxEvent.create.mock.calls)).not.toContain(
        'Private reason',
      );
    },
  );

  it('preserves the hold when a cancellation request is rejected', async () => {
    const transaction = fixture();
    transaction.bookingCancellationRequest.findUnique.mockResolvedValue({
      id: 'request',
      bookingId: 'booking',
      status: 'PENDING',
    });
    const repository = createPrismaBookingLifecycleRepository(client(transaction));
    await expect(
      repository.decideCancellation({
        bookingId: 'booking',
        cancellationRequestId: 'request',
        expectedBookingRevision: 4,
        decision: 'REJECT',
        reason: 'Keep event',
        context,
      }),
    ).resolves.toEqual({ phase: 'CONFIRMED', bookingRevision: 5 });
    expect(transaction.bookingSlotHold.updateMany).not.toHaveBeenCalled();
    expect(transaction.bookingOutboxEvent.create).toHaveBeenCalledOnce();
  });

  it.each(['direct', 'approved request'] as const)(
    'does not release a deposit-pinned hold during blocked %s cancellation',
    async (mode) => {
      const transaction = fixture();
      transaction.bookingDepositIntent.findFirst.mockResolvedValue({ id: 'unknown-deposit' });
      transaction.bookingCancellationRequest.findUnique.mockResolvedValue({
        id: 'request',
        bookingId: 'booking',
        status: 'PENDING',
      });
      const repository = createPrismaBookingLifecycleRepository(
        client(transaction),
        () => new Date('2026-12-19T00:00:00Z'),
      );
      const input = {
        bookingId: 'booking',
        expectedBookingRevision: 4,
        reason: 'Cancel',
        context,
      };
      await expect(
        mode === 'direct'
          ? repository.cancel(input)
          : repository.decideCancellation({
              ...input,
              cancellationRequestId: 'request',
              decision: 'APPROVE',
            }),
      ).rejects.toMatchObject({ code: 'DEPOSIT_INTENT_ACTIVE' });
      expect(transaction.bookingSlotHold.updateMany).not.toHaveBeenCalled();
      expect(transaction.booking.updateMany).not.toHaveBeenCalled();
      expect(transaction.bookingOutboxEvent.create).not.toHaveBeenCalled();
    },
  );
  it('conceals missing booking facts and authorization and rejects stale commands', async () => {
    const transaction = fixture();
    const repository = createPrismaBookingLifecycleRepository(client(transaction));
    const booking = await transaction.booking.findUnique();
    for (const stored of [null, { ...booking, proposalSnapshot: null }]) {
      transaction.booking.findUnique.mockResolvedValue(stored);
      await expect(
        repository.complete({ bookingId: 'booking', expectedBookingRevision: 4, context }),
      ).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
    }
    transaction.booking.findUnique.mockResolvedValue(null);
    await expect(repository.getAuthorizationContext('booking')).rejects.toMatchObject({
      code: 'BOOKING_NOT_FOUND',
    });
    await expect(
      repository.synchronizeHeadcount(
        {
          bookingId: 'booking',
          sourceRsvpRevisionId: 'revision',
          sourceSequence: 1,
          expectedAttendees: 10,
        },
        context,
      ),
    ).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
    transaction.booking.findUnique.mockResolvedValue({
      ...booking,
      consultation: { id: 'consultation', managerAccountId: 'manager' },
    });
    expect(await repository.getAuthorizationContext('booking')).toEqual({
      consultationId: 'consultation',
      managerAccountId: 'manager',
    });
    const input = {
      bookingId: 'booking',
      cancellationRequestId: 'request',
      expectedBookingRevision: 3,
      reason: 'Reason',
      context,
    };
    for (const command of [
      () => repository.cancel(input),
      () => repository.requestCancellation(input),
      () => repository.decideCancellation({ ...input, decision: 'REJECT' }),
      () => repository.complete(input),
    ])
      await expect(command()).rejects.toMatchObject({ code: 'STALE_BOOKING_REVISION' });
  });

  it('refuses unresolved deposits, invalid reasons, absent request actors, and lost CAS writes', async () => {
    const transaction = fixture();
    const repository = createPrismaBookingLifecycleRepository(
      client(transaction),
      () => new Date('2026-12-19T00:00:00Z'),
    );
    const input = {
      bookingId: 'booking',
      cancellationRequestId: 'request',
      expectedBookingRevision: 4,
      reason: 'Reason',
      context,
    };
    transaction.bookingDepositIntent.findFirst.mockResolvedValue({ id: 'active-attempt' });
    await expect(repository.cancel(input)).rejects.toMatchObject({ code: 'DEPOSIT_INTENT_ACTIVE' });
    transaction.bookingDepositIntent.findFirst.mockResolvedValue(null);
    for (const reason of ['', ' '.repeat(501), 'a'.repeat(501)])
      await expect(repository.cancel({ ...input, reason })).rejects.toThrow('1 through 500');
    await expect(
      repository.requestCancellation({ ...input, context: { ...context, actorAccountId: null } }),
    ).rejects.toThrow('requires an account actor');
    transaction.booking.updateMany.mockResolvedValue({ count: 0 });
    await expect(repository.cancel(input)).rejects.toMatchObject({
      code: 'STALE_BOOKING_REVISION',
    });
    await expect(
      repository.synchronizeHeadcount(
        {
          bookingId: 'booking',
          sourceRsvpRevisionId: 'revision',
          sourceSequence: 1,
          expectedAttendees: 10,
        },
        context,
      ),
    ).rejects.toMatchObject({ code: 'STALE_BOOKING_REVISION' });
  });

  it('rejects mismatched cancellation decisions and prevents a raced decision from committing', async () => {
    const transaction = fixture();
    const repository = createPrismaBookingLifecycleRepository(
      client(transaction),
      () => new Date('2026-12-19T00:00:00Z'),
    );
    const input = {
      bookingId: 'booking',
      cancellationRequestId: 'request',
      expectedBookingRevision: 4,
      reason: 'Keep event',
      decision: 'REJECT' as const,
      context,
    };
    for (const stored of [
      null,
      { id: 'request', bookingId: 'other', status: 'PENDING' },
      { id: 'request', bookingId: 'booking', status: 'REJECTED' },
    ]) {
      transaction.bookingCancellationRequest.findUnique.mockResolvedValue(stored);
      await expect(repository.decideCancellation(input)).rejects.toMatchObject({
        code: 'CANCELLATION_REQUEST_CONFLICT',
      });
    }
    transaction.bookingCancellationRequest.findUnique.mockResolvedValue({
      id: 'request',
      bookingId: 'booking',
      status: 'PENDING',
    });
    expect(await repository.decideCancellation(input)).toEqual({
      phase: 'CONFIRMED',
      bookingRevision: 5,
    });
    transaction.bookingCancellationRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(repository.decideCancellation(input)).rejects.toMatchObject({
      code: 'CANCELLATION_REQUEST_CONFLICT',
    });
  });
  it('audits a cancellation request and omits personal reasons from its event', async () => {
    const transaction = fixture();
    const repository = createPrismaBookingLifecycleRepository(
      client(transaction),
      () => new Date('2026-12-19T00:00:00Z'),
      ids(),
    );
    await repository.requestCancellation({
      bookingId: 'booking',
      cancellationRequestId: 'request',
      expectedBookingRevision: 4,
      reason: ' Private reason ',
      context,
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            reason: 'Private reason',
            cancellationRequestId: 'request',
          }),
        }),
      }),
    );
    expect(transaction.bookingOutboxEvent.create).toHaveBeenCalledOnce();
    expect(JSON.stringify(transaction.bookingOutboxEvent.create.mock.calls)).not.toContain(
      'Private reason',
    );
  });

  it('resolves pending requests during direct Manager cancellation without leaking its reason', async () => {
    const transaction = fixture();
    const repository = createPrismaBookingLifecycleRepository(
      client(transaction),
      () => new Date('2026-12-19T00:00:00Z'),
      ids(),
    );
    await repository.cancel({
      bookingId: 'booking',
      expectedBookingRevision: 4,
      reason: 'Private decision',
      context,
    });
    expect(transaction.bookingCancellationRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bookingId: 'booking', status: 'PENDING' },
        data: expect.objectContaining({ status: 'APPROVED', decisionReason: 'Private decision' }),
      }),
    );
    expect(JSON.stringify(transaction.bookingOutboxEvent.create.mock.calls)).not.toContain(
      'Private decision',
    );
  });
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
    bookingSlotHold: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    bookingDepositSettlement: {},
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
  let value = 100;
  return () => `00000000-0000-4000-8000-${String(value++).padStart(12, '0')}`;
}
