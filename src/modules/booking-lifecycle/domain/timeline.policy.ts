import type { BookingPhase } from './booking-policy.js';

export type TimelineParty = 'MANAGER' | 'COUPLE';
export type TimelineRevisionState = 'CURRENT' | 'SUPERSEDED' | 'EFFECTIVE';

export type TimelineItem = Readonly<{
  itemId: string;
  order: number;
  startTime: string;
  title: string;
  description: string | null;
}>;

export type TimelineRevision = Readonly<{
  revisionId: string;
  bookingId: string;
  revisionNumber: number;
  predecessorRevisionId: string | null;
  state: TimelineRevisionState;
  managerApprovedAt: Date | null;
  coupleApprovedAt: Date | null;
  mutuallyApproved: boolean;
  items: readonly TimelineItem[];
  createdAt: Date;
}>;

export type BookingTimelinePolicyErrorCode =
  | 'TIMELINE_ITEM_COUNT_INVALID'
  | 'TIMELINE_ITEM_ID_DUPLICATE'
  | 'TIMELINE_ITEM_ORDER_INVALID'
  | 'TIMELINE_ITEM_TIME_INVALID'
  | 'TIMELINE_ITEM_TEXT_INVALID'
  | 'TIMELINE_REVISION_SUPERSEDED'
  | 'TIMELINE_APPROVAL_REQUIRES_ITEM'
  | 'TIMELINE_WITHDRAWAL_NOT_ALLOWED';

export class BookingTimelinePolicyError extends Error {
  override readonly name = 'BookingTimelinePolicyError';

  constructor(
    readonly code: BookingTimelinePolicyErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function createTimelineRevision(
  input: Readonly<{
    revisionId: string;
    bookingId: string;
    predecessor: TimelineRevision | null;
    items: readonly TimelineItem[];
    shift: Readonly<{ startTime: string; endTime: string }>;
    createdAt: Date;
  }>,
): Readonly<{ changed: boolean; revision: TimelineRevision }> {
  const items = validateItems(input.items, input.shift);
  if (
    input.predecessor !== null &&
    canonicalItems(input.predecessor.items) === canonicalItems(items)
  ) {
    return Object.freeze({ changed: false, revision: input.predecessor });
  }
  const nextRevision = (input.predecessor?.revisionNumber ?? 0) + 1;
  if (!Number.isSafeInteger(nextRevision)) {
    throw new RangeError('Timeline revision exceeded the safe integer range.');
  }
  return Object.freeze({
    changed: true,
    revision: deepFreeze({
      revisionId: input.revisionId,
      bookingId: input.bookingId,
      revisionNumber: nextRevision,
      predecessorRevisionId: input.predecessor?.revisionId ?? null,
      state: 'CURRENT' as const,
      managerApprovedAt: null,
      coupleApprovedAt: null,
      mutuallyApproved: false,
      items,
      createdAt: new Date(input.createdAt),
    }),
  });
}

export function approveTimelineRevision(
  revision: TimelineRevision,
  party: TimelineParty,
  approvedAt: Date,
): TimelineRevision {
  requireCurrent(revision);
  if (revision.items.length === 0) {
    throw new BookingTimelinePolicyError(
      'TIMELINE_APPROVAL_REQUIRES_ITEM',
      'A timeline needs at least one item before approval.',
    );
  }
  const next = {
    ...revision,
    managerApprovedAt:
      party === 'MANAGER'
        ? (revision.managerApprovedAt ?? new Date(approvedAt))
        : revision.managerApprovedAt,
    coupleApprovedAt:
      party === 'COUPLE'
        ? (revision.coupleApprovedAt ?? new Date(approvedAt))
        : revision.coupleApprovedAt,
  };
  return deepFreeze({
    ...next,
    mutuallyApproved: next.managerApprovedAt !== null && next.coupleApprovedAt !== null,
  });
}

export function withdrawTimelineApproval(
  revision: TimelineRevision,
  party: TimelineParty,
  bookingPhase: BookingPhase,
): TimelineRevision {
  requireCurrent(revision);
  if (bookingPhase !== 'DRAFT' && bookingPhase !== 'AWAITING_DEPOSIT') {
    throw new BookingTimelinePolicyError(
      'TIMELINE_WITHDRAWAL_NOT_ALLOWED',
      'Timeline approval can be withdrawn only before deposit settlement.',
    );
  }
  const next = {
    ...revision,
    managerApprovedAt: party === 'MANAGER' ? null : revision.managerApprovedAt,
    coupleApprovedAt: party === 'COUPLE' ? null : revision.coupleApprovedAt,
    mutuallyApproved: false,
  };
  return deepFreeze(next);
}

function validateItems(
  input: readonly TimelineItem[],
  shift: Readonly<{ startTime: string; endTime: string }>,
): readonly TimelineItem[] {
  if (input.length > 100) {
    throw new BookingTimelinePolicyError(
      'TIMELINE_ITEM_COUNT_INVALID',
      'A timeline can contain at most 100 items.',
    );
  }
  const shiftStart = minutes(shift.startTime);
  const shiftEnd = minutes(shift.endTime);
  const ids = new Set<string>();
  const items = input.map((item, index) => {
    if (ids.has(item.itemId)) {
      throw new BookingTimelinePolicyError(
        'TIMELINE_ITEM_ID_DUPLICATE',
        'Timeline item IDs must be unique.',
      );
    }
    ids.add(item.itemId);
    if (item.order !== index) {
      throw new BookingTimelinePolicyError(
        'TIMELINE_ITEM_ORDER_INVALID',
        'Timeline item order must be contiguous and start at zero.',
      );
    }
    const start = minutes(item.startTime);
    if (start < shiftStart || start >= shiftEnd) {
      throw new BookingTimelinePolicyError(
        'TIMELINE_ITEM_TIME_INVALID',
        'Timeline item time must be inside the booking shift.',
      );
    }
    const title = item.title.trim().normalize('NFC');
    const description = item.description?.trim().normalize('NFC') ?? null;
    if (title.length < 1 || title.length > 120 || (description?.length ?? 0) > 2_000) {
      throw new BookingTimelinePolicyError(
        'TIMELINE_ITEM_TEXT_INVALID',
        'Timeline item text is outside the supported bounds.',
      );
    }
    return Object.freeze({ ...item, title, description });
  });
  return deepFreeze(items);
}

function minutes(value: string): number {
  const match = /^(\d{2}):(\d{2})$/u.exec(value);
  const hour = Number(match?.[1]);
  const minute = Number(match?.[2]);
  if (match === null || hour > 23 || minute > 59) {
    throw new BookingTimelinePolicyError(
      'TIMELINE_ITEM_TIME_INVALID',
      'Timeline item time must use HH:mm.',
    );
  }
  return hour * 60 + minute;
}

function canonicalItems(items: readonly TimelineItem[]): string {
  return JSON.stringify(items);
}

function requireCurrent(revision: TimelineRevision): void {
  if (revision.state !== 'CURRENT') {
    throw new BookingTimelinePolicyError(
      'TIMELINE_REVISION_SUPERSEDED',
      'Only the current timeline revision can be changed.',
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
