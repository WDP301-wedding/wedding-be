import type { RestaurantShiftCode } from '../../venue-catalog/application/venue.service.js';

export type SlotIdentity = Readonly<{
  hallId: string;
  eventDate: string;
  shiftCode: RestaurantShiftCode;
}>;

export type SlotHoldStatus = 'ACTIVE' | 'EXPIRED' | 'RELEASED' | 'CONSUMED';
export type DepositIntentPinStatus = 'NONE' | 'ACTIVE' | 'UNKNOWN' | 'SETTLED' | 'FAILED';

export type SlotHold = Readonly<
  SlotIdentity & {
    holdId: string;
    bookingId: string;
    status: SlotHoldStatus;
    acquiredAt: Date;
    expiresAt: Date;
    terminalAt: Date | null;
  }
>;

export class BookingSlotPolicyError extends Error {
  override readonly name = 'BookingSlotPolicyError';

  constructor(
    readonly code: 'BOOKING_SLOT_INVALID' | 'SLOT_HOLD_TRANSITION_INVALID',
    message: string,
  ) {
    super(message);
  }
}

const HOLD_DURATION_MS = 15 * 60 * 1_000;

export function slotKey(slot: SlotIdentity): string {
  requireSlot(slot);
  return `${slot.hallId}:${slot.eventDate}:${slot.shiftCode}`;
}

export function createSlotHold(
  input: SlotIdentity &
    Readonly<{
      holdId: string;
      bookingId: string;
      acquiredAt: Date;
    }>,
): SlotHold {
  requireSlot(input);
  requireTimestamp(input.acquiredAt);
  return deepFreeze({
    holdId: input.holdId,
    bookingId: input.bookingId,
    hallId: input.hallId,
    eventDate: input.eventDate,
    shiftCode: input.shiftCode,
    status: 'ACTIVE' as const,
    acquiredAt: new Date(input.acquiredAt),
    expiresAt: new Date(input.acquiredAt.getTime() + HOLD_DURATION_MS),
    terminalAt: null,
  });
}

export function expireSlotHold(
  hold: SlotHold,
  databaseNow: Date,
  depositIntentStatus: DepositIntentPinStatus,
): SlotHold {
  requireTimestamp(databaseNow);
  if (hold.status !== 'ACTIVE' || databaseNow.getTime() < hold.expiresAt.getTime()) return hold;
  if (depositIntentStatus === 'ACTIVE' || depositIntentStatus === 'UNKNOWN') return hold;
  return deepFreeze({ ...hold, status: 'EXPIRED' as const, terminalAt: new Date(databaseNow) });
}

function requireSlot(slot: SlotIdentity): void {
  if (
    slot.hallId.trim().length === 0 ||
    (slot.shiftCode !== 'LUNCH' && slot.shiftCode !== 'DINNER')
  ) {
    throw new BookingSlotPolicyError('BOOKING_SLOT_INVALID', 'The booking slot is invalid.');
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(slot.eventDate);
  if (match === null) {
    throw new BookingSlotPolicyError('BOOKING_SLOT_INVALID', 'The event date is invalid.');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new BookingSlotPolicyError('BOOKING_SLOT_INVALID', 'The event date is invalid.');
  }
}

function requireTimestamp(value: Date): void {
  if (!Number.isFinite(value.getTime())) {
    throw new BookingSlotPolicyError('BOOKING_SLOT_INVALID', 'The hold timestamp is invalid.');
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
