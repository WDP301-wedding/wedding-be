/* eslint-disable @typescript-eslint/unbound-method -- Vitest intentionally inspects method spies. */
import { describe, expect, it, vi } from 'vitest';

import type { CoupleAccessPromoter } from '../../identity-access/authorization/couple-access-promotion.js';
import { createBookingDepositService, type BookingDepositRepository } from './deposit.service.js';

describe('BookingDepositService', () => {
  it('delegates reservation with immutable contract context', async () => {
    const repository = repositoryFixture();
    const service = createBookingDepositService({ repository, promoter: promoter() });
    await service.reserve(
      {
        bookingId: 'booking',
        timelineRevisionId: 'timeline',
        paymentAttemptId: 'attempt',
        expectedBookingRevision: 4,
        amountVnd: 3_000_001,
        expiresAt: '2026-10-07T10:15:00.000Z',
      },
      context,
    );

    expect(repository.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: context.requestId,
        actorAccountId: context.actorAccountId,
      }),
    );
  });

  it('persists settlement before promoting the same restricted identity', async () => {
    const repository = repositoryFixture();
    const accessPromoter = promoter();
    const service = createBookingDepositService({ repository, promoter: accessPromoter });

    await expect(
      service.recordSuccessfulDeposit({
        bookingId: 'booking',
        timelineRevisionId: 'timeline',
        paymentId: 'payment',
        amountVnd: 3_000_001,
        settledAt: new Date('2026-10-07T10:10:00.000Z'),
      }),
    ).resolves.toEqual({ phase: 'CONFIRMED', replayed: false });

    expect(repository.settle).toHaveBeenCalledBefore(accessPromoter.promote as never);
    expect(accessPromoter.promote).toHaveBeenCalledWith({
      accountId: 'couple-account',
      consultationId: 'consultation',
      sourcePaymentId: 'payment',
      requestId: 'request',
    });
    expect(repository.markPromotionSucceeded).toHaveBeenCalledWith(
      'payment',
      new Date('2026-10-07T10:10:00.000Z'),
    );
  });

  it('retries pending identity promotion on an exact settlement replay', async () => {
    const repository = repositoryFixture();
    vi.mocked(repository.settle).mockResolvedValue({
      phase: 'CONFIRMED',
      replayed: true,
      promotionPending: true,
      accountId: 'couple-account',
      consultationId: 'consultation',
      requestId: 'request',
    });
    const accessPromoter = promoter();
    const service = createBookingDepositService({ repository, promoter: accessPromoter });

    await service.recordSuccessfulDeposit({
      bookingId: 'booking',
      timelineRevisionId: 'timeline',
      paymentId: 'payment',
      amountVnd: 3_000_001,
      settledAt: new Date('2026-10-07T10:10:00.000Z'),
    });

    expect(accessPromoter.promote).toHaveBeenCalledOnce();
  });
});

const context = Object.freeze({
  requestId: 'request',
  causationId: 'cause',
  actorAccountId: 'actor',
  authority: 'AUTHENTICATED' as const,
});

function repositoryFixture(): BookingDepositRepository {
  return {
    requireDepositEligibility: vi.fn(),
    reserve: vi
      .fn()
      .mockResolvedValue({ paymentAttemptId: 'attempt', bookingRevision: 5, replayed: false }),
    recordUnknown: vi.fn().mockResolvedValue(undefined),
    releaseVerifiedFailure: vi.fn().mockResolvedValue(undefined),
    settle: vi.fn().mockResolvedValue({
      phase: 'CONFIRMED',
      replayed: false,
      promotionPending: true,
      accountId: 'couple-account',
      consultationId: 'consultation',
      requestId: 'request',
    }),
    markPromotionSucceeded: vi.fn().mockResolvedValue(undefined),
  };
}

function promoter(): CoupleAccessPromoter {
  return {
    promote: vi.fn().mockResolvedValue({ level: 'FULL', replayed: false, accessId: 'access' }),
  };
}
