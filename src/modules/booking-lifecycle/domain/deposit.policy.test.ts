import { describe, expect, it } from 'vitest';

import { evaluateDepositEligibility } from './deposit.policy.js';

const eligible = Object.freeze({
  bookingPhase: 'DRAFT' as const,
  requestedTimelineRevisionId: 'revision-current',
  currentTimelineRevisionId: 'revision-current',
  managerApproved: true,
  coupleApproved: true,
  hasActiveSlotHold: true,
});

describe('deposit eligibility policy', () => {
  it('accepts only the current mutually approved timeline with an allocated slot', () => {
    expect(evaluateDepositEligibility(eligible)).toBe('ELIGIBLE');
  });

  it.each([
    [{ currentTimelineRevisionId: 'revision-next' }, 'REVISION_SUPERSEDED'],
    [{ managerApproved: false }, 'TIMELINE_NOT_MUTUALLY_APPROVED'],
    [{ coupleApproved: false }, 'TIMELINE_NOT_MUTUALLY_APPROVED'],
    [{ hasActiveSlotHold: false }, 'SLOT_NOT_AVAILABLE'],
    [{ bookingPhase: 'CONFIRMED' as const }, 'BOOKING_NOT_PAYABLE'],
  ])('returns a stable reason for ineligible state', (change, reason) => {
    expect(evaluateDepositEligibility({ ...eligible, ...change })).toBe(reason);
  });
});
