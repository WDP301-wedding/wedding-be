import { describe, expect, it } from 'vitest';

import {
  BookingSlotPolicyError,
  createSlotHold,
  expireSlotHold,
  slotKey,
} from './slot-hold.policy.js';

describe('slot hold policy', () => {
  it('uses the hall, local date, and shift as the slot identity', () => {
    expect(
      slotKey({
        hallId: '00000000-0000-4000-8000-000000000001',
        eventDate: '2026-12-20',
        shiftCode: 'DINNER',
      }),
    ).toBe('00000000-0000-4000-8000-000000000001:2026-12-20:DINNER');
  });

  it('creates an active hold for exactly fifteen minutes', () => {
    const acquiredAt = new Date('2026-10-07T10:00:00.000Z');
    const hold = createSlotHold({
      holdId: '00000000-0000-4000-8000-000000000002',
      bookingId: '00000000-0000-4000-8000-000000000003',
      hallId: '00000000-0000-4000-8000-000000000001',
      eventDate: '2026-12-20',
      shiftCode: 'DINNER',
      acquiredAt,
    });

    expect(hold.status).toBe('ACTIVE');
    expect(hold.expiresAt).toEqual(new Date('2026-10-07T10:15:00.000Z'));
    expect(Object.isFrozen(hold)).toBe(true);
  });

  it('expires at the boundary when no deposit intent is unresolved', () => {
    const hold = createSlotHold({
      holdId: '00000000-0000-4000-8000-000000000002',
      bookingId: '00000000-0000-4000-8000-000000000003',
      hallId: '00000000-0000-4000-8000-000000000001',
      eventDate: '2026-12-20',
      shiftCode: 'LUNCH',
      acquiredAt: new Date('2026-10-07T10:00:00.000Z'),
    });

    expect(expireSlotHold(hold, hold.expiresAt, 'NONE')).toMatchObject({
      status: 'EXPIRED',
      terminalAt: hold.expiresAt,
    });
  });

  it.each(['ACTIVE', 'UNKNOWN'] as const)(
    'keeps an elapsed hold active while a %s deposit intent pins it',
    (depositIntentStatus) => {
      const hold = createSlotHold({
        holdId: '00000000-0000-4000-8000-000000000002',
        bookingId: '00000000-0000-4000-8000-000000000003',
        hallId: '00000000-0000-4000-8000-000000000001',
        eventDate: '2026-12-20',
        shiftCode: 'DINNER',
        acquiredAt: new Date('2026-10-07T10:00:00.000Z'),
      });

      expect(expireSlotHold(hold, new Date('2026-10-07T10:30:00.000Z'), depositIntentStatus)).toBe(
        hold,
      );
    },
  );

  it('rejects malformed local dates and invalid clock values', () => {
    expect(() =>
      createSlotHold({
        holdId: 'hold',
        bookingId: 'booking',
        hallId: 'hall',
        eventDate: '2026-02-30',
        shiftCode: 'DINNER',
        acquiredAt: new Date('invalid'),
      }),
    ).toThrow(BookingSlotPolicyError);
  });
});
