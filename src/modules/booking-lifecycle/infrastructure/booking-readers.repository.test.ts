import { describe, expect, it, vi } from 'vitest';

import {
  createPrismaBookingAccessContextRepository,
  createPrismaBookingCommercialSnapshotReader,
  createPrismaBookingPlanningSnapshotReader,
  createPrismaBookingTimelineSnapshotReader,
} from './booking-readers.repository.js';

const context = {
  requestId: 'request',
  causationId: 'cause',
  actorAccountId: 'actor',
  authority: 'AUTHENTICATED' as const,
};
const approvedAt = new Date('2026-10-07T10:00:00Z');
const laterApproval = new Date('2026-10-07T10:01:00Z');
function fixture() {
  const booking = vi.fn();
  const timeline = vi.fn();
  return {
    booking,
    timeline,
    prisma: {
      booking: { findUnique: booking },
      bookingTimelineRevision: { findUnique: timeline },
      commercialContract: { findUnique: vi.fn().mockResolvedValue(null) },
    } as never,
  };
}
function confirmed() {
  return {
    id: 'booking',
    consultationId: 'consultation',
    phase: 'CONFIRMED',
    hallId: 'hall',
    shiftCode: 'DINNER',
    eventDate: new Date('2026-12-20T00:00:00Z'),
    effectiveTimelineRevisionId: 'timeline',
    planningHeadcount: 100,
    revision: 4,
  };
}
function revision() {
  return {
    id: 'timeline',
    bookingId: 'booking',
    revisionNumber: 2,
    managerApprovedAt: approvedAt,
    coupleApprovedAt: laterApproval,
    booking: {
      eventDate: confirmed().eventDate,
      shiftCode: 'DINNER',
      effectiveTimelineRevisionId: 'timeline',
      proposalSnapshot: {
        hallName: 'Garden Hall',
        shiftStartTime: new Date('1970-01-01T17:00:00Z'),
        shiftEndTime: new Date('1970-01-01T22:00:00Z'),
      },
    },
    items: [
      {
        itemId: 'item',
        displayOrder: 0,
        startTime: new Date('1970-01-01T18:00:00Z'),
        title: 'Welcome',
        description: null,
      },
    ],
  };
}
function commercial() {
  return {
    id: 'booking',
    revision: 4,
    currentTimelineRevisionId: 'timeline',
    timelineRevisions: [{ managerApprovedAt: approvedAt, coupleApprovedAt: laterApproval }],
    proposalSnapshot: {
      id: 'commercial',
      commercialRevisionId: 'commercial',
      commercialAcceptedAt: approvedAt,
      baseChargeVnd: 10000000 as unknown,
      depositAmountVnd: 3000000 as unknown,
      menuPackageVersionId: 'menu-v1',
      tableCount: 2,
    },
  };
}

describe('booking provider snapshot repositories', () => {
  it('reads owned access and confirmed event context from persisted facts', async () => {
    const f = fixture();
    f.booking.mockResolvedValue(confirmed());
    const access = createPrismaBookingAccessContextRepository(f.prisma);
    expect(await access.getAccessContext('booking')).toEqual({
      bookingId: 'booking',
      consultationId: 'consultation',
      phase: 'CONFIRMED',
    });
    expect(await access.requireConfirmedEventContext('booking')).toEqual({
      bookingId: 'booking',
      consultationId: 'consultation',
      hallId: 'hall',
      shiftCode: 'DINNER',
      eventDate: '2026-12-20',
      effectiveTimelineRevisionId: 'timeline',
      planningHeadcount: 100,
    });
    expect(
      await createPrismaBookingPlanningSnapshotReader(f.prisma).getCurrent('booking', context),
    ).toEqual({ bookingId: 'booking', bookingRevision: 4, planningHeadcount: 100 });
  });

  it('conceals missing access and planning records', async () => {
    const f = fixture();
    f.booking.mockResolvedValue(null);
    await expect(
      createPrismaBookingAccessContextRepository(f.prisma).getAccessContext('booking'),
    ).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
    await expect(
      createPrismaBookingPlanningSnapshotReader(f.prisma).getCurrent('booking', context),
    ).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
  });

  it.each([
    null,
    { ...confirmed(), phase: 'DRAFT' },
    { ...confirmed(), effectiveTimelineRevisionId: null },
  ])('does not expose an unconfirmed event (%j)', async (value) => {
    const f = fixture();
    f.booking.mockResolvedValue(value);
    await expect(
      createPrismaBookingAccessContextRepository(f.prisma).requireConfirmedEventContext('booking'),
    ).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
  });

  it('returns the exact approved historical timeline and immutable ordering', async () => {
    const f = fixture();
    f.timeline.mockResolvedValue(revision());
    const reader = createPrismaBookingTimelineSnapshotReader(f.prisma);
    const snapshot = await reader.resolveApprovedRevision(
      { bookingId: 'booking', timelineRevisionId: 'timeline' },
      context,
    );
    expect(snapshot).toMatchObject({
      timelineRevisionId: 'timeline',
      revisionNumber: 2,
      eventDate: '2026-12-20',
      hallName: 'Garden Hall',
      shiftStartTime: '17:00',
      shiftEndTime: '22:00',
      isEffective: true,
      approvedByManagerAt: approvedAt.toISOString(),
      approvedByCoupleAt: laterApproval.toISOString(),
    });
    expect(snapshot.items).toEqual([
      { itemId: 'item', order: 0, startTime: '18:00', title: 'Welcome', description: null },
    ]);
    expect(Object.isFrozen(snapshot.items[0])).toBe(true);
    f.timeline.mockResolvedValue({
      ...revision(),
      booking: { ...revision().booking, effectiveTimelineRevisionId: 'successor' },
    });
    expect(
      (
        await reader.resolveApprovedRevision(
          { bookingId: 'booking', timelineRevisionId: 'timeline' },
          context,
        )
      ).isEffective,
    ).toBe(false);
  });

  it.each([
    null,
    { ...revision(), bookingId: 'other' },
    { ...revision(), managerApprovedAt: null },
    { ...revision(), coupleApprovedAt: null },
    { ...revision(), booking: { ...revision().booking, proposalSnapshot: null } },
  ])('refuses incomplete or unowned timeline evidence (%j)', async (value) => {
    const f = fixture();
    f.timeline.mockResolvedValue(value);
    await expect(
      createPrismaBookingTimelineSnapshotReader(f.prisma).resolveApprovedRevision(
        { bookingId: 'booking', timelineRevisionId: 'timeline' },
        context,
      ),
    ).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
  });

  it('reads exact accepted commercial values and the later approval time', async () => {
    const f = fixture();
    const value = commercial();
    f.booking.mockResolvedValue(value);
    const reader = createPrismaBookingCommercialSnapshotReader(f.prisma);
    expect(
      await reader.getAccepted({ bookingId: 'booking', timelineRevisionId: 'timeline' }, context),
    ).toEqual({
      bookingId: 'booking',
      commercialRevisionId: 'commercial',
      bookingRevision: 4,
      baseChargeVnd: 10000000,
      depositAmountVnd: 3000000,
      menuPackageVersionId: 'menu-v1',
      tableCount: 2,
      acceptedAt: approvedAt.toISOString(),
      modelVersion: 'LEGACY_PROPOSAL_V1',
      contractRevisionId: null,
      documentDigest: null,
    });
    f.booking.mockResolvedValue({
      ...value,
      timelineRevisions: [{ managerApprovedAt: laterApproval, coupleApprovedAt: approvedAt }],
      proposalSnapshot: {
        ...value.proposalSnapshot,
        baseChargeVnd: { toNumber: () => 10000000 },
        depositAmountVnd: '3000000',
      },
    });
    expect(
      await reader.getAccepted({ bookingId: 'booking', timelineRevisionId: 'timeline' }, context),
    ).toMatchObject({
      baseChargeVnd: 10000000,
      depositAmountVnd: 3000000,
      acceptedAt: approvedAt.toISOString(),
    });
  });

  it.each([
    null,
    { ...commercial(), proposalSnapshot: null },
    { ...commercial(), timelineRevisions: [] },
    {
      ...commercial(),
      timelineRevisions: [{ managerApprovedAt: null, coupleApprovedAt: laterApproval }],
    },
    {
      ...commercial(),
      timelineRevisions: [{ managerApprovedAt: approvedAt, coupleApprovedAt: null }],
    },
    {
      ...commercial(),
      proposalSnapshot: { ...commercial().proposalSnapshot, commercialAcceptedAt: null },
    },
  ])('refuses stale or incomplete commercial evidence (%j)', async (value) => {
    const f = fixture();
    f.booking.mockResolvedValue(value);
    await expect(
      createPrismaBookingCommercialSnapshotReader(f.prisma).getAccepted(
        { bookingId: 'booking', timelineRevisionId: 'timeline' },
        context,
      ),
    ).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
  });
  it('resolves an accepted historical timeline after its successor becomes current', async () => {
    const f = fixture();
    f.booking.mockResolvedValue({ ...commercial(), currentTimelineRevisionId: 'successor' });
    await expect(
      createPrismaBookingCommercialSnapshotReader(f.prisma).getAccepted(
        { bookingId: 'booking', timelineRevisionId: 'timeline' },
        context,
      ),
    ).resolves.toMatchObject({
      commercialRevisionId: 'commercial',
      acceptedAt: approvedAt.toISOString(),
    });
  });
});
