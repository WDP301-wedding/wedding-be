/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Vitest asymmetric matchers are typed as any. */
import { describe, expect, it, vi } from 'vitest';

import {
  BookingDepositConflictError,
  createPrismaBookingDepositRepository,
} from './deposit.repository.js';

const now = new Date('2026-10-07T10:00:00.000Z');

describe('PrismaBookingDepositRepository', () => {
  it('requires exact reservation replay and rejects stale, competing, invalid-amount, expired, and raced attempts', async () => {
    const transaction = fixture();
    const repository = createPrismaBookingDepositRepository(client(transaction), () => now, ids());
    const input = {
      bookingId: 'booking',
      timelineRevisionId: 'timeline',
      paymentAttemptId: 'attempt',
      expectedBookingRevision: 4,
      amountVnd: 3_000_001,
      expiresAt: '2026-10-07T10:15:00.000Z',
      requestId: 'request',
      actorAccountId: 'couple',
    };
    const stored = {
      ...input,
      id: input.paymentAttemptId,
      expiresAt: new Date(input.expiresAt),
      bookingRevisionReserved: 5,
    };
    transaction.bookingDepositIntent.findUnique.mockResolvedValue(stored);
    expect(await repository.reserve(input)).toEqual({
      paymentAttemptId: 'attempt',
      bookingRevision: 5,
      replayed: true,
    });
    for (const patch of [
      { bookingId: 'other' },
      { timelineRevisionId: 'other' },
      { amountVnd: 1 },
      { expiresAt: now },
    ]) {
      transaction.bookingDepositIntent.findUnique.mockResolvedValue({ ...stored, ...patch });
      await expect(repository.reserve(input)).rejects.toMatchObject({
        code: 'PAYMENT_EVIDENCE_CONFLICT',
      });
    }
    transaction.bookingDepositIntent.findUnique.mockResolvedValue(null);
    transaction.bookingDepositIntent.findFirst.mockResolvedValue({ id: 'other-attempt' });
    await expect(repository.reserve(input)).rejects.toMatchObject({
      code: 'DEPOSIT_INTENT_ACTIVE',
    });
    transaction.bookingDepositIntent.findFirst.mockResolvedValue(null);
    for (const [patch, code] of [
      [{ expectedBookingRevision: 3 }, 'STALE_BOOKING_REVISION'],
      [{ amountVnd: 1 }, 'PAYMENT_EVIDENCE_CONFLICT'],
      [{ expiresAt: 'invalid' }, 'BOOKING_NOT_PAYABLE'],
      [{ expiresAt: now.toISOString() }, 'BOOKING_NOT_PAYABLE'],
    ] as const)
      await expect(repository.reserve({ ...input, ...patch })).rejects.toMatchObject({ code });
    transaction.booking.updateMany.mockResolvedValue({ count: 0 });
    await expect(repository.reserve(input)).rejects.toMatchObject({
      code: 'STALE_BOOKING_REVISION',
    });
  });

  it('fails closed on missing eligibility facts and distinguishes unavailable, superseded and unapproved timelines', async () => {
    const transaction = fixture();
    const repository = createPrismaBookingDepositRepository(client(transaction), () => now);
    const booking = await transaction.booking.findUnique();
    const input = { bookingId: 'booking', timelineRevisionId: 'timeline' };
    for (const stored of [null, { ...booking, proposalSnapshot: null }]) {
      transaction.booking.findUnique.mockResolvedValue(stored);
      await expect(repository.requireDepositEligibility(input)).rejects.toMatchObject({
        code: 'BOOKING_NOT_FOUND',
      });
    }
    transaction.booking.findUnique.mockResolvedValue(booking);
    transaction.consultationAccess.findFirst.mockResolvedValue(null);
    await expect(repository.requireDepositEligibility(input)).rejects.toMatchObject({
      code: 'BOOKING_NOT_FOUND',
    });
    transaction.consultationAccess.findFirst.mockResolvedValue({ accountId: 'couple' });
    for (const [patch, reasonCode] of [
      [{ phase: 'CONFIRMED' }, 'BOOKING_NOT_PAYABLE'],
      [{ currentTimelineRevisionId: 'other' }, 'REVISION_SUPERSEDED'],
      [{ currentTimelineRevision: null }, 'TIMELINE_NOT_MUTUALLY_APPROVED'],
      [{ slotHolds: [] }, 'SLOT_NOT_AVAILABLE'],
      [{ slotHolds: [{ expiresAt: now, depositIntentPin: 'NONE' }] }, 'SLOT_NOT_AVAILABLE'],
    ] as const) {
      transaction.booking.findUnique.mockResolvedValue({ ...booking, ...patch });
      expect(await repository.requireDepositEligibility(input)).toMatchObject({
        eligible: false,
        reasonCode,
      });
      await expect(
        repository.reserve({
          ...input,
          paymentAttemptId: 'attempt',
          expectedBookingRevision: 4,
          amountVnd: 3_000_001,
          expiresAt: '2026-10-07T10:15:00.000Z',
          requestId: 'request',
          actorAccountId: null,
        }),
      ).rejects.toMatchObject({ code: reasonCode });
    }
    for (const pin of ['ACTIVE', 'UNKNOWN']) {
      transaction.booking.findUnique.mockResolvedValue({
        ...booking,
        proposalSnapshot: { depositAmountVnd: { toNumber: () => 3_000_001 } },
        slotHolds: [{ expiresAt: now, depositIntentPin: pin }],
      });
      expect(await repository.requireDepositEligibility(input)).toMatchObject({
        eligible: true,
        depositAmountVnd: 3_000_001,
      });
    }
  });

  it('only releases a verified matching failure, replays its evidence, and refuses mismatched UNKNOWN outcomes', async () => {
    const transaction = fixture();
    const repository = createPrismaBookingDepositRepository(client(transaction), () => now);
    const input = {
      bookingId: 'booking',
      paymentAttemptId: 'attempt',
      providerEvidenceId: 'failure-proof',
      requestId: 'request',
    };
    for (const stored of [
      null,
      { bookingId: 'other', status: 'UNKNOWN' },
      { bookingId: 'booking', status: 'SETTLED' },
      { bookingId: 'booking', status: 'RELEASED', providerEvidenceId: 'different-proof' },
    ]) {
      transaction.bookingDepositIntent.findUnique.mockResolvedValue(stored);
      await expect(repository.releaseVerifiedFailure(input)).rejects.toMatchObject({
        code: 'PAYMENT_EVIDENCE_CONFLICT',
      });
    }
    transaction.bookingDepositIntent.findUnique.mockResolvedValue({
      bookingId: 'booking',
      status: 'RELEASED',
      providerEvidenceId: input.providerEvidenceId,
    });
    await repository.releaseVerifiedFailure(input);
    expect(transaction.bookingDepositIntent.update).not.toHaveBeenCalled();
    for (const status of ['ACTIVE', 'UNKNOWN']) {
      transaction.bookingDepositIntent.findUnique.mockResolvedValue({
        bookingId: 'booking',
        status,
      });
      await repository.releaseVerifiedFailure(input);
    }
    expect(transaction.bookingDepositIntent.update).toHaveBeenCalledTimes(2);
    transaction.bookingDepositIntent.updateMany.mockResolvedValue({ count: 0 });
    for (const stored of [
      null,
      { bookingId: 'other', status: 'UNKNOWN' },
      { bookingId: 'booking', status: 'SETTLED' },
    ]) {
      transaction.bookingDepositIntent.findUnique.mockResolvedValue(stored);
      await expect(repository.recordUnknown(input)).rejects.toMatchObject({
        code: 'PAYMENT_EVIDENCE_CONFLICT',
      });
    }
  });

  it('guards settlement replays, missing reservations, and promotion completion evidence', async () => {
    const transaction = fixture();
    const repository = createPrismaBookingDepositRepository(client(transaction), () => now);
    const input = {
      bookingId: 'booking',
      timelineRevisionId: 'timeline',
      paymentId: 'payment',
      amountVnd: 3_000_001,
      settledAt: now,
    };
    const stored = { ...input, promotionStatus: 'PENDING' };
    for (const patch of [{ timelineRevisionId: 'other' }, { amountVnd: 1 }]) {
      transaction.bookingDepositSettlement.findUnique.mockResolvedValue({ ...stored, ...patch });
      await expect(repository.settle(input)).rejects.toMatchObject({
        code: 'PAYMENT_EVIDENCE_CONFLICT',
      });
    }
    transaction.bookingDepositSettlement.findUnique.mockResolvedValue(stored);
    await expect(repository.settle(input)).rejects.toMatchObject({
      code: 'PAYMENT_EVIDENCE_CONFLICT',
    });
    transaction.bookingDepositIntent.findFirst.mockResolvedValue({
      coupleAccountId: 'couple',
      requestId: 'request',
    });
    transaction.booking.findUnique.mockResolvedValue(null);
    await expect(repository.settle(input)).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
    transaction.bookingDepositSettlement.findUnique.mockResolvedValue(null);
    await expect(repository.settle(input)).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
    transaction.bookingDepositSettlement.updateMany.mockResolvedValue({ count: 0 });
    for (const current of [null, { promotionStatus: 'PENDING' }]) {
      transaction.bookingDepositSettlement.findUnique.mockResolvedValue(current);
      await expect(repository.markPromotionSucceeded(input.paymentId, now)).rejects.toMatchObject({
        code: 'PAYMENT_EVIDENCE_CONFLICT',
      });
    }
    transaction.bookingDepositSettlement.findUnique.mockResolvedValue({
      promotionStatus: 'SUCCEEDED',
    });
    await repository.markPromotionSucceeded(input.paymentId, now);
  });
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

  it('rejects a replay that changes the immutable settlement timestamp', async () => {
    const transaction = fixture();
    transaction.bookingDepositSettlement.findUnique.mockResolvedValue({
      paymentId: 'payment',
      bookingId: 'booking',
      timelineRevisionId: 'timeline',
      amountVnd: 3_000_001,
      settledAt: now,
      promotionStatus: 'SUCCEEDED',
    });
    transaction.bookingDepositIntent.findFirst.mockResolvedValue({
      coupleAccountId: 'couple',
      requestId: 'request',
    });
    const repository = createPrismaBookingDepositRepository(client(transaction), () => now, ids());
    await expect(
      repository.settle({
        bookingId: 'booking',
        timelineRevisionId: 'timeline',
        paymentId: 'payment',
        amountVnd: 3_000_001,
        settledAt: new Date(now.getTime() + 1),
      }),
    ).rejects.toMatchObject({ code: 'PAYMENT_EVIDENCE_CONFLICT' });
    expect(transaction.bookingDepositSettlement.create).not.toHaveBeenCalled();
  });

  it('replays an UNKNOWN outcome without releasing its slot pin', async () => {
    const transaction = fixture();
    transaction.bookingDepositIntent.updateMany.mockResolvedValue({ count: 0 });
    transaction.bookingDepositIntent.findUnique.mockResolvedValue({
      id: 'attempt',
      bookingId: 'booking',
      status: 'UNKNOWN',
    });
    const repository = createPrismaBookingDepositRepository(client(transaction), () => now, ids());
    await expect(
      repository.recordUnknown({
        bookingId: 'booking',
        paymentAttemptId: 'attempt',
        requestId: 'request',
      }),
    ).resolves.toBeUndefined();
    expect(transaction.bookingSlotHold.updateMany).toHaveBeenCalledWith({
      where: { bookingId: 'booking', status: 'ACTIVE' },
      data: { depositIntentPin: 'UNKNOWN' },
    });
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
      update: vi.fn().mockResolvedValue({}),
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
