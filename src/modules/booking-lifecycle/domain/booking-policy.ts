import type { MenuPackageSnapshot } from '../../venue-catalog/application/menu.service.js';
import { z } from 'zod';
import type { HallSnapshot, ShiftSnapshot } from '../../venue-catalog/application/venue.service.js';

export type BookingPhase = 'DRAFT' | 'AWAITING_DEPOSIT' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';

export type BookingTransition = 'REQUEST_DEPOSIT' | 'RECORD_DEPOSIT' | 'CANCEL' | 'COMPLETE';

export type BookingPolicyErrorCode =
  | 'BOOKING_TABLE_COUNT_INVALID'
  | 'BOOKING_MENU_SELECTION_INVALID'
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

export const proposalMenuSnapshotSchema = z.strictObject({
  versionId: z.uuid(),
  packageId: z.uuid(),
  versionNumber: z.int().positive(),
  name: z.string(),
  description: z.string(),
  priceVndPerTable: z.int().nonnegative(),
});
export const proposalMenuLineSchema = proposalMenuSnapshotSchema.extend({
  tableCount: z.int().min(1).max(500),
  lineTotalVnd: z.int().nonnegative(),
});
export const proposalMenuLinesSchema = z.array(proposalMenuLineSchema).min(1).max(50);
export type ProposalMenuSnapshot = Readonly<z.infer<typeof proposalMenuSnapshotSchema>>;
export type ProposalMenuLine = Readonly<z.infer<typeof proposalMenuLineSchema>>;
export type ProposalMenuSelection = Readonly<{ menuPackageVersionId: string; tableCount: number }>;
export type ProposalMenuInput = Readonly<{
  menuPackageVersionId?: string | undefined;
  tableCount?: number | undefined;
  menus?: readonly ProposalMenuSelection[] | undefined;
}>;

export function proposalMenuSelections(input: ProposalMenuInput): readonly ProposalMenuSelection[] {
  if (
    input.menus !== undefined &&
    input.menuPackageVersionId === undefined &&
    input.tableCount === undefined
  ) {
    return input.menus;
  }
  if (
    input.menus === undefined &&
    input.menuPackageVersionId !== undefined &&
    input.tableCount !== undefined
  ) {
    return [{ menuPackageVersionId: input.menuPackageVersionId, tableCount: input.tableCount }];
  }
  throw new BookingPolicyError(
    'BOOKING_MENU_SELECTION_INVALID',
    'Supply menus or the legacy menu and table count, exclusively.',
  );
}

export type ProposalSnapshot = Readonly<{
  hall: HallSnapshot;
  shift: ShiftSnapshot;
  /** Compatibility preview of the first menu; use menus for the complete selection. */
  menu: ProposalMenuSnapshot;
  menus?: readonly ProposalMenuLine[];
  eventDate: string;
  tableCount: number;
  planningHeadcount: number;
  baseChargeVnd: number;
  depositAmountVnd: number;
}>;

export type CreateProposalSnapshotInput = Readonly<{
  hall: HallSnapshot;
  shift: ShiftSnapshot;
  eventDate: string;
  planningHeadcount: number;
}> &
  (
    | Readonly<{ menu: MenuPackageSnapshot; tableCount: number }>
    | Readonly<{ menus: readonly Readonly<{ menu: MenuPackageSnapshot; tableCount: number }>[] }>
  );

export function createProposalSnapshot(input: CreateProposalSnapshotInput): ProposalSnapshot {
  const selections =
    'menus' in input ? input.menus : [{ menu: input.menu, tableCount: input.tableCount }];
  if (
    selections.length < 1 ||
    selections.length > 50 ||
    new Set(selections.map(({ menu }) => menu.menuPackageId)).size !== selections.length
  ) {
    throw new BookingPolicyError(
      'BOOKING_MENU_SELECTION_INVALID',
      'Select 1–50 distinct menu packages.',
    );
  }
  const menus = selections.map(({ menu, tableCount }) => {
    requireIntegerRange('tableCount', tableCount, 1, 500, 'BOOKING_TABLE_COUNT_INVALID');
    return {
      versionId: menu.id,
      packageId: menu.menuPackageId,
      versionNumber: menu.versionNumber,
      name: menu.name,
      description: menu.description,
      priceVndPerTable: menu.priceVndPerTable,
      tableCount,
      lineTotalVnd: multiplyVnd(menu.priceVndPerTable, tableCount),
    };
  });
  const tableCount = menus.reduce((sum, line) => sum + line.tableCount, 0);
  requireIntegerRange('tableCount', tableCount, 1, 500, 'BOOKING_TABLE_COUNT_INVALID');
  requireIntegerRange(
    'planningHeadcount',
    input.planningHeadcount,
    0,
    10_000,
    'BOOKING_HEADCOUNT_INVALID',
  );
  requireLocalDate(input.eventDate);
  const baseChargeVnd = toSafeVnd(menus.reduce((sum, line) => sum + BigInt(line.lineTotalVnd), 0n));
  const depositAmountVnd = toSafeVnd((BigInt(baseChargeVnd) * 30n + 99n) / 100n);
  const first = menus[0]!;

  return deepFreeze({
    hall: structuredClone(input.hall),
    shift: structuredClone(input.shift),
    menu: {
      versionId: first.versionId,
      packageId: first.packageId,
      versionNumber: first.versionNumber,
      name: first.name,
      description: first.description,
      priceVndPerTable: first.priceVndPerTable,
    },
    menus,
    eventDate: input.eventDate,
    tableCount,
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
