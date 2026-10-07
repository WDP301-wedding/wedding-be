import type { MenuPackageSnapshot } from '../../venue-catalog/application/menu.service.js';
import type { HallSnapshot, ShiftSnapshot } from '../../venue-catalog/application/venue.service.js';

export type BookingPhase = 'DRAFT' | 'AWAITING_DEPOSIT' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';

export type BookingTransition = 'REQUEST_DEPOSIT' | 'RECORD_DEPOSIT' | 'CANCEL' | 'COMPLETE';

export type BookingPolicyErrorCode =
  | 'BOOKING_TABLE_COUNT_INVALID'
  | 'BOOKING_HEADCOUNT_INVALID'
  | 'BOOKING_EVENT_DATE_INVALID'
  | 'BOOKING_COMMERCIAL_VALUE_INVALID'
  | 'TIMELINE_NOT_MUTUALLY_APPROVED'
  | 'TIMELINE_REVISION_SUPERSEDED'
  | 'INVALID_BOOKING_TRANSITION';

export class BookingPolicyError extends Error {
  override readonly name = 'BookingPolicyError';

  constructor(
    readonly code: BookingPolicyErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type ProposalSnapshot = Readonly<{
  hall: HallSnapshot;
  shift: ShiftSnapshot;
  menu: Readonly<{
    versionId: string;
    packageId: string;
    versionNumber: number;
    name: string;
    description: string;
    priceVndPerTable: number;
  }>;
  eventDate: string;
  tableCount: number;
  planningHeadcount: number;
  baseChargeVnd: number;
  depositAmountVnd: number;
}>;

export type CreateProposalSnapshotInput = Readonly<{
  hall: HallSnapshot;
  shift: ShiftSnapshot;
  menu: MenuPackageSnapshot;
  eventDate: string;
  tableCount: number;
  planningHeadcount: number;
}>;

export function createProposalSnapshot(input: CreateProposalSnapshotInput): ProposalSnapshot {
  requireIntegerRange('tableCount', input.tableCount, 1, 500, 'BOOKING_TABLE_COUNT_INVALID');
  requireIntegerRange(
    'planningHeadcount',
    input.planningHeadcount,
    0,
    10_000,
    'BOOKING_HEADCOUNT_INVALID',
  );
  requireLocalDate(input.eventDate);
  const baseChargeVnd = multiplyVnd(input.menu.priceVndPerTable, input.tableCount);
  const depositAmountVnd = toSafeVnd((BigInt(baseChargeVnd) * 30n + 99n) / 100n);

  return deepFreeze({
    hall: structuredClone(input.hall),
    shift: structuredClone(input.shift),
    menu: {
      versionId: input.menu.id,
      packageId: input.menu.menuPackageId,
      versionNumber: input.menu.versionNumber,
      name: input.menu.name,
      description: input.menu.description,
      priceVndPerTable: input.menu.priceVndPerTable,
    },
    eventDate: input.eventDate,
    tableCount: input.tableCount,
    planningHeadcount: input.planningHeadcount,
    baseChargeVnd,
    depositAmountVnd,
  });
}

export function transitionBookingPhase(
  phase: BookingPhase,
  transition: BookingTransition,
  timeline?: Readonly<{
    isCurrentTimelineRevision: boolean;
    managerApproved: boolean;
    coupleApproved: boolean;
  }>,
): BookingPhase {
  if (phase === 'DRAFT' && transition === 'REQUEST_DEPOSIT') {
    if (timeline?.isCurrentTimelineRevision !== true) {
      throw new BookingPolicyError(
        'TIMELINE_REVISION_SUPERSEDED',
        'Deposit eligibility requires the current timeline revision.',
      );
    }
    if (timeline.managerApproved !== true || timeline.coupleApproved !== true) {
      throw new BookingPolicyError(
        'TIMELINE_NOT_MUTUALLY_APPROVED',
        'Deposit eligibility requires both timeline approvals.',
      );
    }
    return 'AWAITING_DEPOSIT';
  }
  if (phase === 'AWAITING_DEPOSIT' && transition === 'RECORD_DEPOSIT') return 'CONFIRMED';
  if (phase === 'CONFIRMED' && transition === 'COMPLETE') return 'COMPLETED';
  if (
    transition === 'CANCEL' &&
    (phase === 'DRAFT' || phase === 'AWAITING_DEPOSIT' || phase === 'CONFIRMED')
  ) {
    return 'CANCELLED';
  }
  throw new BookingPolicyError(
    'INVALID_BOOKING_TRANSITION',
    `Cannot apply ${transition} while the booking is ${phase}.`,
  );
}

function multiplyVnd(priceVnd: number, quantity: number): number {
  if (!Number.isSafeInteger(priceVnd) || priceVnd < 0) {
    throw new BookingPolicyError(
      'BOOKING_COMMERCIAL_VALUE_INVALID',
      'The snapshotted menu price must be a non-negative safe integer.',
    );
  }
  return toSafeVnd(BigInt(priceVnd) * BigInt(quantity));
}

function toSafeVnd(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new BookingPolicyError(
      'BOOKING_COMMERCIAL_VALUE_INVALID',
      'The calculated commercial value is outside the safe integer range.',
    );
  }
  return Number(value);
}

function requireIntegerRange(
  field: string,
  value: number,
  min: number,
  max: number,
  code: BookingPolicyErrorCode,
): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new BookingPolicyError(code, `${field} must be an integer from ${min} through ${max}.`);
  }
}

function requireLocalDate(value: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) {
    throw new BookingPolicyError(
      'BOOKING_EVENT_DATE_INVALID',
      'eventDate must be an ISO local date.',
    );
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
    throw new BookingPolicyError(
      'BOOKING_EVENT_DATE_INVALID',
      'eventDate must be a real calendar date.',
    );
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
