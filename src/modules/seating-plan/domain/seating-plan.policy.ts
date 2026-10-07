import { createHash } from 'node:crypto';

import { AppError } from '../../../core/errors/app-error.js';

export const SEATING_PLAN_LIMITS = Object.freeze({
  exceptionReason: { min: 10, max: 500 },
  labelCount: { max: 500 },
});

export type SeatingPlanStatus = 'DRAFT' | 'CONFIRMED' | 'REQUIRES_REVIEW';

export interface LabelInput {
  readonly layoutTableId: string;
  readonly guestGroupId: string;
}

// ─── Error classes ────────────────────────────────────────────────────────────

export class SeatingRevisionStaleError extends AppError {
  constructor() {
    super({
      status: 409,
      code: 'SEATING_REVISION_STALE',
      message: 'The seating plan revision is stale.',
    });
  }
}

export class HeadcountOutsideLayoutRangeError extends AppError {
  constructor() {
    super({
      status: 409,
      code: 'HEADCOUNT_OUTSIDE_LAYOUT_RANGE',
      message: 'The planning headcount is outside the selected layout range.',
    });
  }
}

export class LayoutRetiredError extends AppError {
  constructor() {
    super({
      status: 409,
      code: 'LAYOUT_RETIRED',
      message: 'The selected layout has been retired.',
    });
  }
}

export class TableNotInLayoutError extends AppError {
  constructor() {
    super({
      status: 409,
      code: 'TABLE_NOT_IN_LAYOUT',
      message: 'A labelled table does not belong to the selected layout.',
    });
  }
}

export class GuestGroupUnavailableError extends AppError {
  constructor() {
    super({
      status: 409,
      code: 'GUEST_GROUP_UNAVAILABLE',
      message: 'A referenced guest group is unavailable.',
    });
  }
}

export class ExceptionExceedsPhysicalCapacityError extends AppError {
  constructor() {
    super({
      status: 409,
      code: 'EXCEPTION_EXCEEDS_PHYSICAL_CAPACITY',
      message: 'The Manager exception would exceed the hall physical capacity.',
    });
  }
}

// ─── Pure policy functions ────────────────────────────────────────────────────

/**
 * Validates that the headcount falls within the inclusive layout range.
 * Throws HeadcountOutsideLayoutRangeError if it does not.
 */
export function validateHeadcountInRange(
  headcount: number,
  minGuests: number,
  maxGuests: number,
): void {
  if (headcount < minGuests || headcount > maxGuests) {
    throw new HeadcountOutsideLayoutRangeError();
  }
}

/**
 * Builds a stable sha256 hex digest of the canonical revision snapshot.
 * Labels are sorted by layoutTableId for determinism.
 */
export function buildRevisionDigest(
  layoutTemplateVersionId: string,
  expectedAttendees: number,
  labels: readonly LabelInput[],
): string {
  const canonical = JSON.stringify({
    layoutTemplateVersionId,
    expectedAttendees,
    labels: [...labels]
      .sort((a, b) => a.layoutTableId.localeCompare(b.layoutTableId))
      .map(({ layoutTableId, guestGroupId }) => ({ layoutTableId, guestGroupId })),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Validates and trims the manager exception reason.
 * Throws a ValidationError if it is out of bounds.
 */
export function validateExceptionReason(reason: string): string {
  const trimmed = reason.trim();
  const len = [...trimmed].length;
  if (
    len < SEATING_PLAN_LIMITS.exceptionReason.min ||
    len > SEATING_PLAN_LIMITS.exceptionReason.max
  ) {
    throw new AppError({
      status: 422,
      code: 'VALIDATION_ERROR',
      message: `Exception reason must be between ${String(SEATING_PLAN_LIMITS.exceptionReason.min)} and ${String(SEATING_PLAN_LIMITS.exceptionReason.max)} characters.`,
    });
  }
  return trimmed;
}
