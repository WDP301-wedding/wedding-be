import { describe, expect, it } from 'vitest';

import {
  BookingPolicyError,
  createProposalSnapshot,
  proposalMenuSelections,
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
  it('requires an unambiguous legacy or multi-menu selection', () => {
    expect(proposalMenuSelections({ menuPackageVersionId: menu.id, tableCount: 3 })).toEqual([
      { menuPackageVersionId: menu.id, tableCount: 3 },
    ]);
    for (const input of [
      {},
      { menuPackageVersionId: menu.id },
      { tableCount: 3 },
      { menus: [], tableCount: 3 },
    ]) {
      expect(() => proposalMenuSelections(input)).toThrow(
        expect.objectContaining({ code: 'BOOKING_MENU_SELECTION_INVALID' }),
      );
    }
  });
  it.each([
    { menus: [] },
    {
      menus: Array.from({ length: 51 }, (_, i) => ({
        menu: { ...menu, menuPackageId: String(i) },
        tableCount: 1,
      })),
    },
  ])('rejects an empty or oversized menu list', ({ menus }) => {
    expect(() =>
      createProposalSnapshot({ hall, shift, eventDate: '2026-11-15', planningHeadcount: 1, menus }),
    ).toThrow(expect.objectContaining({ code: 'BOOKING_MENU_SELECTION_INVALID' }));
  });
  it('rejects aggregate table counts above 500', () => {
    expect(() =>
      createProposalSnapshot({
        hall,
        shift,
        eventDate: '2026-11-15',
        planningHeadcount: 1,
        menus: [
          { menu, tableCount: 500 },
          { menu: { ...menu, menuPackageId: 'another-package' }, tableCount: 1 },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: 'BOOKING_TABLE_COUNT_INVALID' }));
  });
  it('snapshots 20 and 40 tables at different menu prices with independently entered headcount', () => {
    const snapshot = createProposalSnapshot({
      hall,
      shift,
      eventDate: '2026-11-15',
      planningHeadcount: 350,
      menus: [
        { menu, tableCount: 20 },
        {
          menu: {
            ...menu,
            id: 'premium-version',
            menuPackageId: 'premium',
            priceVndPerTable: 7_000_002,
          },
          tableCount: 40,
        },
      ],
    });
    expect(snapshot.tableCount).toBe(60);
    expect(snapshot.planningHeadcount).toBe(350);
    expect(snapshot.baseChargeVnd).toBe(390_000_100);
    expect(snapshot.depositAmountVnd).toBe(117_000_030);
    expect(snapshot.menus?.map((line) => [line.tableCount, line.lineTotalVnd])).toEqual([
      [20, 110_000_020],
      [40, 280_000_080],
    ]);
    expect(Object.isFrozen(snapshot.menus)).toBe(true);
    expect(Object.isFrozen(snapshot.menus?.[1])).toBe(true);
  });
  it('rejects aggregate overflow even when each menu line is individually safe', () => {
    expect(() =>
      createProposalSnapshot({
        hall,
        shift,
        eventDate: '2026-11-15',
        planningHeadcount: 20,
        menus: [
          { menu: { ...menu, priceVndPerTable: Number.MAX_SAFE_INTEGER }, tableCount: 1 },
          {
            menu: {
              ...menu,
              id: 'another-version',
              menuPackageId: 'another-menu',
              priceVndPerTable: 1,
            },
            tableCount: 1,
          },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: 'BOOKING_COMMERCIAL_VALUE_INVALID' }));
  });
  it('rounds the deposit once on the combined total rather than on each menu', () => {
    const snapshot = createProposalSnapshot({
      hall,
      shift,
      eventDate: '2026-11-15',
      planningHeadcount: 1,
      menus: [
        { menu: { ...menu, priceVndPerTable: 1 }, tableCount: 1 },
        {
          menu: { ...menu, id: 'other-version', menuPackageId: 'other-menu', priceVndPerTable: 1 },
          tableCount: 1,
        },
      ],
    });
    expect(snapshot.baseChargeVnd).toBe(2);
    expect(snapshot.depositAmountVnd).toBe(1);
  });
  it('rejects two versions of the same menu package', () => {
    expect(() =>
      createProposalSnapshot({
        hall,
        shift,
        eventDate: '2026-11-15',
        planningHeadcount: 20,
        menus: [
          { menu, tableCount: 1 },
          { menu: { ...menu, id: 'another-version' }, tableCount: 1 },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: 'BOOKING_MENU_SELECTION_INVALID' }));
  });
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
