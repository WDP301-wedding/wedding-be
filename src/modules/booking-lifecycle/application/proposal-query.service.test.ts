import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { commercialDocumentFixture } from '../../../../tests/fixtures/commercial-contract.js';
import { documentDigest } from '../domain/commercial-contract.js';
import { appendixDigest } from '../domain/commercial-appendix.js';

import { createProposalQueryService } from './proposal-query.service.js';

const hallCapacity = () => ({
  hall: { findUnique: vi.fn().mockResolvedValue({ lifecycle: 'ACTIVE', maxGuests: 200 }) },
  layoutTemplateVersion: {
    findMany: vi.fn().mockResolvedValue([{ _count: { geometry: 12 } }]),
  },
});

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
      depositIntents: [],
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
    const prisma = {
      ...hallCapacity(),
      booking: { findUnique: vi.fn().mockResolvedValue(booking) },
    };
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
    expect(draft.capabilities.canWithdrawApproval).toBe(false);
    expect(draft.proposal.depositAmountVnd).toBe(3000000);
    expect(draft.proposal.baseChargeVnd).toBe(10000000);
    expect(draft.proposal.menus).toEqual([
      { ...draft.proposal.menu, tableCount: 10, lineTotalVnd: 10000000 },
    ]);
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

describe('proposal workspace effective commercial scale', () => {
  function fixture() {
    const now = new Date('2026-11-09T00:00:00Z');
    const rootId = randomUUID();
    const original = commercialDocumentFixture();
    const contractDocument = {
      ...original,
      tableCount: 11,
      lines: [
        { ...original.lines[0]!, name: 'Menu hợp đồng', quantity: 11, lineTotalVnd: 38500000 },
      ],
      contractTotalVnd: 38500000,
      depositAmountVnd: 11550000,
    };
    const digest = documentDigest(contractDocument);
    const approvals = (documentDigest: string) => [
      { party: 'MANAGER', actorAccountId: randomUUID(), documentDigest, occurredAt: now },
      { party: 'COUPLE', actorAccountId: randomUUID(), documentDigest, occurredAt: now },
    ];
    const contract = {
      id: rootId,
      state: 'APPROVED',
      document: contractDocument,
      documentDigest: digest,
      approvedAt: now,
      approvals: approvals(digest),
      timelineRevisionId: original.timelineRevisionId,
      contractTotalVnd: contractDocument.contractTotalVnd,
      depositAmountVnd: contractDocument.depositAmountVnd,
    };
    const appendixDocument = {
      bookingId: original.bookingId,
      contractRevisionId: rootId,
      predecessorRevisionId: rootId,
      brideName: original.brideName!,
      groomName: original.groomName!,
      reason: 'Thêm thực đơn và số bàn',
      beforeLines: contractDocument.lines,
      afterLines: [
        {
          ...original.lines[0]!,
          name: 'Menu chính có hiệu lực',
          quantity: 10,
          unitPriceVnd: 3220000,
          lineTotalVnd: 32200000,
        },
        {
          ...original.lines[0]!,
          sourceId: randomUUID(),
          sourceRevisionId: randomUUID(),
          name: 'Menu chay có hiệu lực',
          quantity: 5,
          unitPriceVnd: 2590000,
          lineTotalVnd: 12950000,
        },
        {
          ...original.lines[0]!,
          sourceId: randomUUID(),
          sourceRevisionId: randomUUID(),
          name: 'Menu tiệc có hiệu lực',
          quantity: 5,
          unitPriceVnd: 3970000,
          lineTotalVnd: 19850000,
        },
      ],
      beforeTotalVnd: 38500000,
      afterTotalVnd: 65000000,
      deltaVnd: 26500000,
      tableCount: 20,
    };
    const effectiveDigest = appendixDigest(appendixDocument);
    const effective = {
      id: randomUUID(),
      revisionNumber: 1,
      state: 'APPROVED',
      document: appendixDocument,
      documentDigest: effectiveDigest,
      approvedAt: now,
      effectiveTotalVnd: 65000000,
      deltaVnd: 26500000,
      approvals: approvals(effectiveDigest),
    };
    const booking = {
      id: original.bookingId,
      hallId: original.hallId,
      shiftCode: 'DINNER',
      consultationId: randomUUID(),
      consultation: { managerAccountId: 'manager' },
      phase: 'CONFIRMED',
      revision: 21,
      eventDate: new Date('2026-11-19T00:00:00Z'),
      planningHeadcount: 100,
      depositIntents: [],
      cancellationRequests: [],
      currentTimelineRevision: null,
      effectiveTimelineRevision: null,
      commercialContract: { currentRevision: contract },
      commercialAppendices: {
        currentRevision: effective,
        effectiveRevision: effective,
        effectiveRevisionId: effective.id,
      },
      proposalSnapshot: {
        hallId: original.hallId,
        hallName: 'Orchid',
        hallDescription: '',
        hallMaxGuests: 200,
        shiftCode: 'DINNER',
        shiftStartTime: new Date('1970-01-01T17:00:00Z'),
        shiftEndTime: new Date('1970-01-01T22:00:00Z'),
        menuPackageId: original.lines[0]!.sourceId,
        menuPackageVersionId: original.lines[0]!.sourceRevisionId,
        menuVersionNumber: 1,
        menuName: 'Menu tư vấn',
        menuDescription: '',
        menuPriceVndPerTable: 3500000,
        tableCount: 10,
        baseChargeVnd: 35000000,
        depositAmountVnd: 10500000,
      },
    };
    const prisma = {
      ...hallCapacity(),
      booking: { findUnique: vi.fn().mockResolvedValue(booking) },
    };
    Object.assign(prisma, {
      menuPackageVersion: {
        findMany: vi.fn().mockResolvedValue(
          appendixDocument.afterLines.map((line) => ({
            id: line.sourceRevisionId,
            versionNumber: 1,
          })),
        ),
      },
    });
    const service = createProposalQueryService(prisma as never, { requireAccess: vi.fn() });
    const read = () =>
      service.get({
        bookingId: original.bookingId,
        actor: { accountId: 'manager', roles: ['MANAGER'] },
      });
    return { booking, effective, prisma, read };
  }

  it('shows all 20 approved appendix tables and menus while retaining the original agreed deposit', async () => {
    const f = fixture();
    const result = await f.read();
    expect(result.proposal.tableCount).toBe(20);
    expect(
      result.proposal.menus.map((menu) => [menu.name, menu.tableCount, menu.lineTotalVnd]),
    ).toEqual([
      ['Menu chính có hiệu lực', 10, 32200000],
      ['Menu chay có hiệu lực', 5, 12950000],
      ['Menu tiệc có hiệu lực', 5, 19850000],
    ]);
    expect(result.proposal.menu.name).toBe('Menu chính có hiệu lực');
    expect(result.proposal.baseChargeVnd).toBe(65000000);
    expect(result.proposal.depositAmountVnd).toBe(11550000);
    expect(f.booking.proposalSnapshot.tableCount).toBe(10);
    expect(f.booking.commercialContract.currentRevision.document.tableCount).toBe(11);
  });

  it('keeps the effective appendix when its successor still awaits the second approval', async () => {
    const f = fixture();
    f.prisma.booking.findUnique.mockResolvedValue({
      ...f.booking,
      commercialAppendices: {
        ...f.booking.commercialAppendices,
        currentRevision: {
          ...f.effective,
          id: randomUUID(),
          revisionNumber: 2,
          state: 'AWAITING_APPROVAL',
          document: { ...f.effective.document, tableCount: 25 },
          approvals: [f.effective.approvals[0]!],
        },
      },
    });
    const result = await f.read();
    expect(result.proposal.tableCount).toBe(20);
    expect(result.proposal.menus.map((menu) => menu.tableCount)).toEqual([10, 5, 5]);
    expect(result.completion.pending).toBe(true);
  });

  it('uses approved contract menus before the proposal and falls back until both contract parties approve', async () => {
    const f = fixture();
    f.prisma.booking.findUnique.mockResolvedValue({ ...f.booking, commercialAppendices: null });
    const contract = await f.read();
    expect(contract.proposal.tableCount).toBe(11);
    expect(contract.proposal.menus.map((menu) => [menu.name, menu.tableCount])).toEqual([
      ['Menu hợp đồng', 11],
    ]);
    f.prisma.booking.findUnique.mockResolvedValue({
      ...f.booking,
      commercialAppendices: null,
      commercialContract: {
        currentRevision: {
          ...f.booking.commercialContract.currentRevision,
          state: 'AWAITING_APPROVAL',
          approvals: [f.booking.commercialContract.currentRevision.approvals[0]!],
        },
      },
    });
    const proposal = await f.read();
    expect(proposal.proposal.tableCount).toBe(10);
    expect(proposal.proposal.menus.map((menu) => [menu.name, menu.tableCount])).toEqual([
      ['Menu tư vấn', 10],
    ]);
  });
});
