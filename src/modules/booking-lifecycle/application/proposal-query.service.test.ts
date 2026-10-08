import { describe, expect, it, vi } from 'vitest';

import { createProposalQueryService } from './proposal-query.service.js';

describe('proposal workspace query', () => {
  it('separates the pending replacement from the effective planning timeline', async () => {
    const now = new Date('2026-10-08T00:00:00Z');
    const timeline = (id: string, title: string) => ({
      id,
      state: 'CURRENT',
      revisionNumber: 2,
      predecessorRevisionId: null,
      managerApprovedAt: now,
      coupleApprovedAt: null,
      items: [
        {
          itemId: id,
          displayOrder: 0,
          startTime: new Date('1970-01-01T18:00:00Z'),
          title,
          description: null,
        },
      ],
    });
    const booking = {
      id: 'booking',
      consultationId: 'consultation',
      phase: 'CONFIRMED',
      revision: 8,
      eventDate: now,
      planningHeadcount: 100,
      cancellationRequests: [{ id: 'request', reason: 'Plans changed', requestedAt: now }],
      hallId: 'hall',
      shiftCode: 'DINNER',
      currentTimelineRevisionId: 'pending',
      consultation: { managerAccountId: 'manager' },
      proposalSnapshot: {
        hallId: 'hall',
        hallName: 'Garden',
        hallDescription: '',
        hallMaxGuests: 200,
        shiftCode: 'DINNER',
        shiftStartTime: new Date('1970-01-01T17:00:00Z'),
        shiftEndTime: new Date('1970-01-01T22:00:00Z'),
        menuPackageVersionId: 'menu-version',
        menuPackageId: 'menu',
        menuVersionNumber: 1,
        menuName: 'Menu',
        menuDescription: '',
        menuPriceVndPerTable: 1000000,
        tableCount: 10,
        baseChargeVnd: 10000000,
        depositAmountVnd: 3000000,
      },
      currentTimelineRevision: timeline('pending', 'New welcome'),
      effectiveTimelineRevision: {
        ...timeline('effective', 'Approved welcome'),
        state: 'EFFECTIVE',
        coupleApprovedAt: now,
      },
    };
    const prisma = { booking: { findUnique: vi.fn().mockResolvedValue(booking) } };
    const access = { requireAccess: vi.fn().mockResolvedValue({ level: 'FULL' }) };
    const service = createProposalQueryService(prisma as never, access);
    const result = await service.get({
      bookingId: 'booking',
      actor: { accountId: 'couple', roles: ['COUPLE'] },
    });

    expect(result.timeline?.items[0]?.title).toBe('New welcome');
    expect(result.effectiveTimeline?.items[0]?.title).toBe('Approved welcome');
    expect(result.capabilities.canWithdrawApproval).toBe(false);
    expect(result.cancellationRequests).toEqual([
      { requestId: 'request', reason: 'Plans changed', requestedAt: now.toISOString() },
    ]);
    expect(access.requireAccess).toHaveBeenCalledWith({
      accountId: 'couple',
      consultationId: 'consultation',
      minimum: 'RESTRICTED',
    });
    expect(await service.getManagerSlotContext('booking', 'manager')).toEqual({
      hallId: 'hall',
      eventDate: '2026-10-08',
      shiftCode: 'DINNER',
      currentTimelineRevisionId: 'pending',
    });
    expect(await service.getCurrentTimelineRevisionId('booking')).toBe('pending');
    await expect(service.getManagerSlotContext('booking', 'outsider')).rejects.toMatchObject({
      code: 'BOOKING_NOT_FOUND',
    });

    access.requireAccess.mockClear();
    const owner = await service.get({
      bookingId: 'booking',
      actor: { accountId: 'manager', roles: ['MANAGER'] },
    });
    expect(owner.capabilities.accessLevel).toBe('FULL');
    expect(access.requireAccess).not.toHaveBeenCalled();

    prisma.booking.findUnique.mockResolvedValue({
      ...booking,
      phase: 'DRAFT',
      currentTimelineRevision: null,
      effectiveTimelineRevision: null,
      proposalSnapshot: {
        ...booking.proposalSnapshot,
        baseChargeVnd: { toNumber: () => 10000000 },
        depositAmountVnd: '3000000',
      },
    });
    const draft = await service.get({
      bookingId: 'booking',
      actor: { accountId: 'manager', roles: [] },
    });
    expect(draft.timeline).toBeNull();
    expect(draft.effectiveTimeline).toBeNull();
    expect(draft.capabilities.canApproveTimeline).toBe(false);
    expect(draft.capabilities.canWithdrawApproval).toBe(true);
    expect(draft.proposal.depositAmountVnd).toBe(3000000);
    expect(draft.proposal.baseChargeVnd).toBe(10000000);
    expect(access.requireAccess).toHaveBeenCalledOnce();

    prisma.booking.findUnique.mockResolvedValue({ ...booking, phase: 'CANCELLED' });
    expect(
      (
        await service.get({
          bookingId: 'booking',
          actor: { accountId: 'manager', roles: ['MANAGER'] },
        })
      ).capabilities.canEditTimeline,
    ).toBe(false);
    prisma.booking.findUnique.mockResolvedValue({ ...booking, proposalSnapshot: null });
    await expect(
      service.get({ bookingId: 'booking', actor: { accountId: 'manager', roles: ['MANAGER'] } }),
    ).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
    prisma.booking.findUnique.mockResolvedValue(null);
    await expect(
      service.get({ bookingId: 'booking', actor: { accountId: 'manager', roles: ['MANAGER'] } }),
    ).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
    await expect(service.getManagerSlotContext('booking', 'manager')).rejects.toMatchObject({
      code: 'BOOKING_NOT_FOUND',
    });
    await expect(service.getCurrentTimelineRevisionId('booking')).rejects.toMatchObject({
      code: 'BOOKING_NOT_FOUND',
    });
  });
});
