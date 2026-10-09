import { describe, expect, it, vi } from 'vitest';

import type { ConsultationAccessReader } from '../../identity-access/authorization/authorization.service.js';
import {
  createBookingLifecycleReader,
  type BookingAccessContextRepository,
} from './booking-readers.js';

describe('BookingLifecycleReader', () => {
  it('conceals booking access behind the identity-owned consultation grant', async () => {
    const requireAccess = vi.fn<ConsultationAccessReader['requireAccess']>().mockResolvedValue({
      level: 'RESTRICTED',
    });
    const repository = repositoryFixture();
    const reader = createBookingLifecycleReader({
      repository,
      access: { requireAccess },
      deposits: {
        requireDepositEligibility: vi.fn().mockRejectedValue(new Error('unused')),
      },
    });

    await expect(
      reader.requireBookingAccess({
        bookingId: 'booking',
        accountId: 'account',
        minimum: 'RESTRICTED',
      }),
    ).resolves.toEqual({ consultationId: 'consultation', bookingId: 'booking', phase: 'DRAFT' });
    expect(requireAccess).toHaveBeenCalledWith({
      accountId: 'account',
      consultationId: 'consultation',
      minimum: 'RESTRICTED',
    });
  });

  it('delegates the fresh deposit eligibility read without caching', async () => {
    const requireDepositEligibility = vi.fn().mockResolvedValue({
      eligible: true,
      reasonCode: 'ELIGIBLE',
      consultationId: 'consultation',
      coupleAccountId: 'couple',
      bookingRevision: 4,
      depositAmountVnd: 15_000_000,
    });
    const reader = createBookingLifecycleReader({
      repository: repositoryFixture(),
      access: {
        requireAccess: vi.fn().mockResolvedValue({ level: 'FULL' }),
      },
      deposits: { requireDepositEligibility },
    });

    await reader.requireDepositEligibility({
      bookingId: 'booking',
      timelineRevisionId: 'timeline',
    });
    expect(requireDepositEligibility).toHaveBeenCalledTimes(1);
  });
});

function repositoryFixture(): BookingAccessContextRepository {
  return {
    getAccessContext: () =>
      Promise.resolve({ consultationId: 'consultation', bookingId: 'booking', phase: 'DRAFT' }),
    requireConfirmedEventContext: () => Promise.reject(new Error('unused')),
  };
}
