/* eslint-disable @typescript-eslint/unbound-method -- Vitest intentionally inspects method spies. */
import { describe, expect, it, vi } from 'vitest';

import type { ConsultationAccessReader } from '../../identity-access/authorization/authorization.service.js';
import type { BookingLifecycleRepository } from '../infrastructure/lifecycle.repository.js';
import { createBookingLifecycleService } from './lifecycle.service.js';

describe('BookingLifecycleService', () => {
  it('requires FULL access for a Couple cancellation request', async () => {
    const repository = repositoryFixture();
    const access = accessReader();
    const service = createBookingLifecycleService({
      repository,
      access,
      createId: () => '00000000-0000-4000-8000-000000000010',
    });

    await service.requestCancellation({
      bookingId: 'booking',
      expectedBookingRevision: 4,
      reason: 'Plans changed',
      actor: { accountId: 'couple', roles: ['COUPLE'] },
      requestId: 'request',
    });

    expect(access.requireAccess).toHaveBeenCalledWith({
      accountId: 'couple',
      consultationId: 'consultation',
      minimum: 'FULL',
    });
    expect(repository.requestCancellation).toHaveBeenCalledWith(
      expect.objectContaining({
        cancellationRequestId: '00000000-0000-4000-8000-000000000010',
      }),
    );
  });

  it('allows only the owning Manager to decide cancellation and complete', async () => {
    const repository = repositoryFixture();
    const service = createBookingLifecycleService({ repository, access: accessReader() });
    const actor = { accountId: 'manager', roles: ['MANAGER'] as const };

    await service.decideCancellation({
      bookingId: 'booking',
      cancellationRequestId: 'cancel',
      expectedBookingRevision: 4,
      decision: 'REJECT',
      reason: 'Event proceeds',
      actor,
      requestId: 'request',
    });
    await service.complete({
      bookingId: 'booking',
      expectedBookingRevision: 4,
      actor,
      requestId: 'request',
    });

    expect(repository.decideCancellation).toHaveBeenCalledOnce();
    expect(repository.complete).toHaveBeenCalledOnce();
  });
});

function repositoryFixture(): BookingLifecycleRepository {
  return {
    getAuthorizationContext: vi.fn().mockResolvedValue({
      consultationId: 'consultation',
      managerAccountId: 'manager',
    }),
    synchronizeHeadcount: vi.fn(),
    cancel: vi.fn().mockResolvedValue({ phase: 'CANCELLED', bookingRevision: 5 }),
    requestCancellation: vi
      .fn()
      .mockResolvedValue({ cancellationRequestId: 'cancel', bookingRevision: 5 }),
    decideCancellation: vi.fn().mockResolvedValue({ phase: 'CONFIRMED', bookingRevision: 5 }),
    complete: vi.fn().mockResolvedValue({ phase: 'COMPLETED', bookingRevision: 5 }),
  };
}

function accessReader(): ConsultationAccessReader {
  return { requireAccess: vi.fn().mockResolvedValue({ level: 'FULL' }) };
}
