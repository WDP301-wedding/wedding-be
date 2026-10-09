import { describe, expect, it } from 'vitest';

import {
  BookingPolicyError,
  createProposalSnapshot,
  transitionBookingPhase,
} from './booking-policy.js';

const hall = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Sảnh Ánh Dương',
  description: 'Sảnh tiệc hướng vườn',
  maxGuests: 500,
} as const;

const shift = { code: 'DINNER', startTime: '17:30', endTime: '22:00' } as const;

const menu = {
  id: '00000000-0000-4000-8000-000000000002',
  menuPackageId: '00000000-0000-4000-8000-000000000003',
  versionNumber: 3,
  state: 'PUBLISHED',
  revision: 2,
  name: 'Thực đơn Vườn Thu',
  description: 'Thực đơn đã công bố',
  priceVndPerTable: 5_500_001,
  items: [],
} as const;

describe('booking proposal policy', () => {
  it('creates an immutable commercial snapshot and rounds the 30 percent deposit upward', () => {
    const snapshot = createProposalSnapshot({
      hall,
      shift,
      menu,
      eventDate: '2026-11-15',
      tableCount: 10,
      planningHeadcount: 320,
    });

    expect(snapshot.baseChargeVnd).toBe(55_000_010);
    expect(snapshot.depositAmountVnd).toBe(16_500_003);
    expect(snapshot.hall).toEqual(hall);
    expect(snapshot.menu.versionId).toBe(menu.id);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.hall)).toBe(true);
  });

  it.each([
    { tableCount: 0, planningHeadcount: 10, code: 'BOOKING_TABLE_COUNT_INVALID' },
    { tableCount: 501, planningHeadcount: 10, code: 'BOOKING_TABLE_COUNT_INVALID' },
    { tableCount: 10, planningHeadcount: -1, code: 'BOOKING_HEADCOUNT_INVALID' },
    { tableCount: 10, planningHeadcount: 10_001, code: 'BOOKING_HEADCOUNT_INVALID' },
  ])('rejects proposal bounds with $code', ({ tableCount, planningHeadcount, code }) => {
    expect(() =>
      createProposalSnapshot({
        hall,
        shift,
        menu,
        eventDate: '2026-11-15',
        tableCount,
        planningHeadcount,
      }),
    ).toThrow(expect.objectContaining({ code }));
  });

  it('rejects unsafe commercial arithmetic', () => {
    expect(() =>
      createProposalSnapshot({
        hall,
        shift,
        menu: { ...menu, priceVndPerTable: Number.MAX_SAFE_INTEGER },
        eventDate: '2026-11-15',
        tableCount: 2,
        planningHeadcount: 10,
      }),
    ).toThrow(BookingPolicyError);
  });

  it('moves a draft to awaiting deposit only for the mutually approved current revision', () => {
    expect(
      transitionBookingPhase('DRAFT', 'REQUEST_DEPOSIT', {
        isCurrentTimelineRevision: true,
        managerApproved: true,
        coupleApproved: true,
      }),
    ).toBe('AWAITING_DEPOSIT');

    expect(() =>
      transitionBookingPhase('DRAFT', 'REQUEST_DEPOSIT', {
        isCurrentTimelineRevision: false,
        managerApproved: true,
        coupleApproved: true,
      }),
    ).toThrow(expect.objectContaining({ code: 'TIMELINE_REVISION_SUPERSEDED' }));
  });

  it('allows only the approved forward lifecycle and terminal cancellation paths', () => {
    expect(transitionBookingPhase('AWAITING_DEPOSIT', 'RECORD_DEPOSIT')).toBe('CONFIRMED');
    expect(transitionBookingPhase('CONFIRMED', 'COMPLETE')).toBe('COMPLETED');
    expect(transitionBookingPhase('DRAFT', 'CANCEL')).toBe('CANCELLED');
    expect(() => transitionBookingPhase('COMPLETED', 'CANCEL')).toThrow(
      expect.objectContaining({ code: 'INVALID_BOOKING_TRANSITION' }),
    );
  });
});
