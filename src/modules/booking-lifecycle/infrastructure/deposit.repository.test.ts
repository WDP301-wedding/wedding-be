/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Vitest asymmetric matchers are typed as any. */
import { describe, expect, it, vi } from 'vitest';

import {
  BookingDepositConflictError,
  createPrismaBookingDepositRepository,
} from './deposit.repository.js';

const now = new Date('2026-10-07T10:00:00.000Z');

describe('PrismaBookingDepositRepository', () => {
  it('derives eligibility and amount from current stored booking facts', async () => {
    const transaction = fixture();
    const repository = createPrismaBookingDepositRepository(client(transaction), () => now, ids());

    await expect(
      repository.requireDepositEligibility({
        bookingId: 'booking',
        timelineRevisionId: 'timeline',
      }),
    ).resolves.toEqual({
      eligible: true,
      reasonCode: 'ELIGIBLE',
      consultationId: 'consultation',
      coupleAccountId: 'couple',
      bookingRevision: 4,
      depositAmountVnd: 3_000_001,
    });
  });

  it('reserves one exact payment attempt and pins the slot atomically', async () => {
    const transaction = fixture();
    const repository = createPrismaBookingDepositRepository(client(transaction), () => now, ids());
    await repository.reserve({
      bookingId: 'booking',
      timelineRevisionId: 'timeline',
      paymentAttemptId: 'attempt',
      expectedBookingRevision: 4,
      amountVnd: 3_000_001,
      expiresAt: '2026-10-07T10:15:00.000Z',
      requestId: 'request',
      actorAccountId: 'couple',
    });

    expect(transaction.bookingDepositIntent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'attempt',
        status: 'ACTIVE',
        amountVnd: 3_000_001,
        coupleAccountId: 'couple',
      }),
    });
    expect(transaction.bookingSlotHold.updateMany).toHaveBeenCalledWith({
      where: { bookingId: 'booking', status: 'ACTIVE' },
      data: { depositIntentPin: 'ACTIVE' },
    });
    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
    expect(transaction.bookingOutboxEvent.create).toHaveBeenCalledOnce();
  });

  it('records settlement once and confirms the exact reserved booking facts', async () => {
    const transaction = fixture();
    transaction.bookingDepositIntent.findFirst.mockResolvedValue({
      id: 'attempt',
      bookingId: 'booking',
      timelineRevisionId: 'timeline',
      amountVnd: 3_000_001,
      status: 'ACTIVE',
      coupleAccountId: 'couple',
      requestId: 'request',
    });
    transaction.booking.findUnique.mockResolvedValue({
      id: 'booking',
      consultationId: 'consultation',
      phase: 'AWAITING_DEPOSIT',
      revision: 4,
      currentTimelineRevisionId: 'timeline',
    });
    const repository = createPrismaBookingDepositRepository(client(transaction), () => now, ids());

    await expect(
      repository.settle({
        bookingId: 'booking',
        timelineRevisionId: 'timeline',
        paymentId: 'payment',
        amountVnd: 3_000_001,
        settledAt: now,
      }),
    ).resolves.toMatchObject({ phase: 'CONFIRMED', replayed: false, promotionPending: true });

    expect(transaction.bookingDepositSettlement.create).toHaveBeenCalledOnce();
    expect(transaction.booking.updateMany).toHaveBeenCalledWith({
      where: { id: 'booking', revision: 4, phase: 'AWAITING_DEPOSIT' },
      data: {
        phase: 'CONFIRMED',
        effectiveTimelineRevisionId: 'timeline',
        revision: { increment: 1 },
      },
    });
  });

  it('rejects settlement evidence that changes an existing payment', async () => {
    const transaction = fixture();
    transaction.bookingDepositSettlement.findUnique.mockResolvedValue({
      paymentId: 'payment',
      bookingId: 'other-booking',
      timelineRevisionId: 'timeline',
      amountVnd: 3_000_001,
      promotionStatus: 'SUCCEEDED',
    });
    const repository = createPrismaBookingDepositRepository(client(transaction), () => now, ids());

    await expect(
      repository.settle({
        bookingId: 'booking',
        timelineRevisionId: 'timeline',
        paymentId: 'payment',
        amountVnd: 3_000_001,
        settledAt: now,
      }),
    ).rejects.toBeInstanceOf(BookingDepositConflictError);
  });
});

function fixture() {
  const booking = {
    id: 'booking',
    consultationId: 'consultation',
    phase: 'DRAFT',
    revision: 4,
    currentTimelineRevisionId: 'timeline',
    currentTimelineRevision: {
      id: 'timeline',
      managerApprovedAt: new Date('2026-10-07T09:00:00.000Z'),
      coupleApprovedAt: new Date('2026-10-07T09:05:00.000Z'),
    },
    proposalSnapshot: { depositAmountVnd: 3_000_001 },
    slotHolds: [
      {
        id: 'hold',
        status: 'ACTIVE',
        expiresAt: new Date('2026-10-07T10:15:00.000Z'),
        depositIntentPin: 'NONE',
      },
    ],
  };
  return {
    booking: {
      findUnique: vi.fn().mockResolvedValue(booking),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    consultationAccess: {
      findFirst: vi.fn().mockResolvedValue({ accountId: 'couple' }),
    },
    bookingDepositIntent: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    bookingDepositSettlement: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    bookingSlotHold: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    bookingTimelineRevision: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    bookingOutboxEvent: { create: vi.fn().mockResolvedValue({}) },
  };
}

function client(transaction: object) {
  const value = transaction as ReturnType<typeof fixture>;
  return {
    booking: value.booking,
    consultationAccess: value.consultationAccess,
    bookingDepositSettlement: value.bookingDepositSettlement,
    $transaction: vi.fn(async (operation: (client_: object) => Promise<unknown>) =>
      operation(transaction),
    ),
  } as never;
}

function ids(): () => string {
  let value = 10;
  return () => `00000000-0000-4000-8000-${String(value++).padStart(12, '0')}`;
}
