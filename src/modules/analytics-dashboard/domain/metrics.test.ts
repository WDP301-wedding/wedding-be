import { describe, expect, it } from 'vitest';
import { cashWindow, sumVnd, attendanceResult } from './metrics.js';

describe('SPEC-10 authoritative formulas', () => {
  it('translates inclusive Vietnam dates to half-open UTC cash boundaries', () => {
    expect(cashWindow('2026-10-13', '2026-10-13')).toEqual({
      from: '2026-10-12T17:00:00.000Z',
      to: '2026-10-13T17:00:00.000Z',
    });
  });
  it('checks integer VND including signed deltas and aggregate overflow', () => {
    expect(sumVnd([100, -30, 20])).toBe(90);
    expect(() => sumVnd([Number.MAX_SAFE_INTEGER, 1])).toThrow();
    expect(() => sumVnd([1.1])).toThrow();
  });
  it('keeps disabled measurement unknown and planning independent from an empty list', () => {
    expect(attendanceResult('b', 300, 0, undefined)).toEqual({
      bookingId: 'b',
      planningHeadcount: 300,
      listedGuestCount: 0,
      checkInMode: 'NONE',
      measurementStatus: 'NOT_RECORDED',
      checkedInGuestCount: null,
      byGuestGroup: [],
    });
  });
  it('labels enabled zero/partial lists and preserves archived group measurements', () => {
    const source = {
      checkInMode: 'BY_GUEST_NAME' as const,
      measurementStatus: 'LISTED_GUESTS_ONLY' as const,
      checkedInGuestCount: 1,
      byGuestGroup: [
        {
          guestGroupId: 'g',
          groupNameSnapshot: 'Old label',
          groupColorSnapshot: '#FFFFFF',
          checkedInGuestCount: 1,
        },
      ],
    };
    const result = attendanceResult('b', 300, 20, source);
    expect(result.checkedInGuestCount).toBe(1);
    expect(result.byGuestGroup[0]?.groupNameSnapshot).toBe('Old label');
    expect(Object.keys(result)).not.toContain('turnoutRate');
    expect(
      attendanceResult('b', 300, 20, { ...source, checkedInGuestCount: 0, byGuestGroup: [] })
        .checkedInGuestCount,
    ).toBe(0);
  });
});
