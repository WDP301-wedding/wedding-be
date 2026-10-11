import type { BookingPhase } from './booking-policy.js';

export type DepositEligibilityReason =
  | 'ELIGIBLE'
  | 'TIMELINE_NOT_MUTUALLY_APPROVED'
  | 'REVISION_SUPERSEDED'
  | 'SLOT_NOT_AVAILABLE'
  | 'BOOKING_NOT_PAYABLE'
  | 'CONTRACT_APPROVAL_REQUIRED';

export function evaluateDepositEligibility(
  input: Readonly<{
    bookingPhase: BookingPhase;
    requestedTimelineRevisionId: string;
    currentTimelineRevisionId: string | null;
    managerApproved: boolean;
    coupleApproved: boolean;
    hasActiveSlotHold: boolean;
  }>,
): DepositEligibilityReason {
  if (input.bookingPhase !== 'DRAFT' && input.bookingPhase !== 'AWAITING_DEPOSIT') {
    return 'BOOKING_NOT_PAYABLE';
  }
  if (input.currentTimelineRevisionId !== input.requestedTimelineRevisionId) {
    return 'REVISION_SUPERSEDED';
  }
  if (!input.managerApproved || !input.coupleApproved) {
    return 'TIMELINE_NOT_MUTUALLY_APPROVED';
  }
  if (!input.hasActiveSlotHold) return 'SLOT_NOT_AVAILABLE';
  return 'ELIGIBLE';
}
