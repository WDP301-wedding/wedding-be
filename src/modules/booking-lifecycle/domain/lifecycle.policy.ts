import type { BookingPhase } from './booking-policy.js';

export type HeadcountEvidence = Readonly<{
  sourceGuestPlanRevisionId: string;
  sourceSequence: number;
  expectedAttendees: number;
}>;

export type HeadcountOutcome = 'APPLIED' | 'REPLAYED' | 'IGNORED_STALE';

export class BookingLifecyclePolicyError extends Error {
  override readonly name = 'BookingLifecyclePolicyError';

  constructor(
    readonly code:
      | 'HEADCOUNT_SOURCE_CONFLICT'
      | 'BOOKING_CANCELLATION_NOT_ALLOWED'
      | 'BOOKING_COMPLETION_NOT_DUE'
      | 'INVALID_BOOKING_TRANSITION',
    message: string,
  ) {
    super(message);
  }
}

export function applyHeadcountEvidence(
  current: HeadcountEvidence | null,
  next: HeadcountEvidence,
): Readonly<{ outcome: HeadcountOutcome; evidence: HeadcountEvidence }> {
  requireHeadcount(next);
  if (current === null || next.sourceSequence > current.sourceSequence) {
    return Object.freeze({ outcome: 'APPLIED', evidence: Object.freeze({ ...next }) });
  }
  if (next.sourceSequence < current.sourceSequence) {
    return Object.freeze({ outcome: 'IGNORED_STALE', evidence: current });
  }
  if (
    next.sourceGuestPlanRevisionId === current.sourceGuestPlanRevisionId &&
    next.expectedAttendees === current.expectedAttendees
  ) {
    return Object.freeze({ outcome: 'REPLAYED', evidence: current });
  }
  throw new BookingLifecyclePolicyError(
    'HEADCOUNT_SOURCE_CONFLICT',
    'The headcount evidence conflicts with the applied source sequence.',
  );
}

export function requireCancellationAllowed(
  phase: BookingPhase,
  eventDate: string,
  shiftStartTime: string,
  databaseNow: Date,
): void {
  if (phase !== 'DRAFT' && phase !== 'AWAITING_DEPOSIT' && phase !== 'CONFIRMED') {
    throw new BookingLifecyclePolicyError(
      'BOOKING_CANCELLATION_NOT_ALLOWED',
      'The booking phase cannot be cancelled.',
    );
  }
  if (databaseNow.getTime() >= localVietnamTime(eventDate, shiftStartTime).getTime()) {
    throw new BookingLifecyclePolicyError(
      'BOOKING_CANCELLATION_NOT_ALLOWED',
      'Cancellation is closed after the event starts.',
    );
  }
}

export function requireCompletionDue(
  phase: BookingPhase,
  eventDate: string,
  shiftEndTime: string,
  databaseNow: Date,
): void {
  const dueAt = new Date(
    localVietnamTime(eventDate, shiftEndTime).getTime() + 12 * 60 * 60 * 1_000,
  );
  if (phase !== 'CONFIRMED') {
    throw new BookingLifecyclePolicyError(
      'INVALID_BOOKING_TRANSITION',
      'Only a confirmed booking can be completed.',
    );
  }
  if (databaseNow.getTime() < dueAt.getTime()) {
    throw new BookingLifecyclePolicyError(
      'BOOKING_COMPLETION_NOT_DUE',
      'The booking completion guard has not elapsed.',
    );
  }
}

function requireHeadcount(value: HeadcountEvidence): void {
  if (
    !Number.isSafeInteger(value.sourceSequence) ||
    value.sourceSequence < 0 ||
    !Number.isSafeInteger(value.expectedAttendees) ||
    value.expectedAttendees < 0 ||
    value.expectedAttendees > 10_000
  ) {
    throw new RangeError('Headcount evidence is outside the supported bounds.');
  }
}

export function localVietnamTime(eventDate: string, time: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(eventDate);
  const clock = /^(\d{2}):(\d{2})$/u.exec(time);
  if (match === null || clock === null) throw new RangeError('Invalid local event timestamp.');
  return new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(clock[1]) - 7,
      Number(clock[2]),
    ),
  );
}
