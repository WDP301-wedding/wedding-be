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
    const result = await createProposalQueryService(prisma as never, access as never).get({
      bookingId: 'booking',
      actor: { accountId: 'couple', roles: ['COUPLE'] },
    });

    expect(result.timeline?.items[0]?.title).toBe('New welcome');
    expect(result.effectiveTimeline?.items[0]?.title).toBe('Approved welcome');
    expect(result.capabilities.canWithdrawApproval).toBe(false);
    expect(access.requireAccess).toHaveBeenCalledWith({
      accountId: 'couple',
      consultationId: 'consultation',
      minimum: 'RESTRICTED',
    });
  });
});
