import { AppError } from '../../../core/errors/app-error.js';

export const STAFF_OPERATIONS_LIMITS = Object.freeze({
  arrivalCount: { min: 1, max: 100 },
  correctionDelta: { min: -100, max: 100 },
  reasonLength: { min: 10, max: 500 },
  searchLimit: { min: 1, max: 50, default: 20 },
  windowStartOffsetHours: 2,
  windowEndOffsetHours: 12,
});

export type StaffAssignmentStatus = 'ACTIVE' | 'REVOKED';

export class EventAssignmentRequiredError extends AppError {
  constructor(message = 'Active event assignment is required for staff operations.') {
    super({
      status: 403,
      code: 'EVENT_ASSIGNMENT_REQUIRED',
      message,
    });
  }
}

export class ArrivalCountInvalidError extends AppError {
  constructor(message = 'Arrival attendee count must be an integer between 1 and 100.') {
    super({
      status: 422,
      code: 'ARRIVAL_COUNT_INVALID',
      message,
    });
  }
}

export class AttendanceCorrectionConflictError extends AppError {
  constructor(message = 'Attendance correction conflict: expected ledger revision is stale.') {
    super({
      status: 409,
      code: 'ATTENDANCE_CORRECTION_CONFLICT',
      message,
    });
  }
}

export class CheckInWindowClosedError extends AppError {
  constructor(message = 'Check-in window is closed for this event. Manager override required.') {
    super({
      status: 409,
      code: 'CHECK_IN_WINDOW_CLOSED',
      message,
    });
  }
}

export class AttendanceCorrectionInvalidError extends AppError {
  constructor(message = 'Attendance correction would cause effective attendees to fall below zero.') {
    super({
      status: 422,
      code: 'ATTENDANCE_CORRECTION_INVALID',
      message,
    });
  }
}

export class AssignmentConflictError extends AppError {
  constructor(message = 'Staff account already has an active assignment for this booking.') {
    super({
      status: 409,
      code: 'ASSIGNMENT_CONFLICT',
      message,
    });
  }
}

export function validateArrivalCount(count: number): number {
  if (
    !Number.isInteger(count) ||
    count < STAFF_OPERATIONS_LIMITS.arrivalCount.min ||
    count > STAFF_OPERATIONS_LIMITS.arrivalCount.max
  ) {
    throw new ArrivalCountInvalidError();
  }
  return count;
}

export function validateCorrectionDelta(delta: number): number {
  if (
    !Number.isInteger(delta) ||
    delta === 0 ||
    delta < STAFF_OPERATIONS_LIMITS.correctionDelta.min ||
    delta > STAFF_OPERATIONS_LIMITS.correctionDelta.max
  ) {
    throw new AppError({
      status: 422,
      code: 'CORRECTION_DELTA_INVALID',
      message: 'Correction delta must be a nonzero integer between -100 and +100.',
    });
  }
  return delta;
}

export function validateReason(reason: string, field = 'reason'): string {
  const trimmed = reason.trim();
  const len = [...trimmed].length;
  if (
    len < STAFF_OPERATIONS_LIMITS.reasonLength.min ||
    len > STAFF_OPERATIONS_LIMITS.reasonLength.max
  ) {
    throw new AppError({
      status: 422,
      code: 'VALIDATION_ERROR',
      message: `${field} must be between ${String(STAFF_OPERATIONS_LIMITS.reasonLength.min)} and ${String(STAFF_OPERATIONS_LIMITS.reasonLength.max)} characters.`,
    });
  }
  return trimmed;
}

export function isWithinEventWindow(
  eventStartTime: Date,
  eventEndTime: Date,
  now: Date = new Date(),
): boolean {
  const windowStart = new Date(
    eventStartTime.getTime() - STAFF_OPERATIONS_LIMITS.windowStartOffsetHours * 3600 * 1000,
  );
  const windowEnd = new Date(
    eventEndTime.getTime() + STAFF_OPERATIONS_LIMITS.windowEndOffsetHours * 3600 * 1000,
  );
  return now.getTime() >= windowStart.getTime() && now.getTime() <= windowEnd.getTime();
}
