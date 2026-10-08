import { describe, expect, it } from 'vitest';

import {
  BookingLifecyclePolicyError,
  applyHeadcountEvidence,
  requireCancellationAllowed,
  requireCompletionDue,
} from './lifecycle.policy.js';

describe('post-deposit lifecycle policy', () => {
  it('applies, replays, ignores stale, and rejects conflicting headcount evidence', () => {
    expect(
      applyHeadcountEvidence(null, {
        sourceRsvpRevisionId: 'r10',
        sourceSequence: 10,
        expectedAttendees: 120,
      }),
    ).toMatchObject({ outcome: 'APPLIED' });
    const current = { sourceRsvpRevisionId: 'r10', sourceSequence: 10, expectedAttendees: 120 };
    expect(applyHeadcountEvidence(current, current).outcome).toBe('REPLAYED');
    expect(
      applyHeadcountEvidence(current, {
        sourceRsvpRevisionId: 'r9',
        sourceSequence: 9,
        expectedAttendees: 100,
      }).outcome,
    ).toBe('IGNORED_STALE');
    expect(() =>
      applyHeadcountEvidence(current, {
        sourceRsvpRevisionId: 'other',
        sourceSequence: 10,
        expectedAttendees: 121,
      }),
    ).toThrow(expect.objectContaining({ code: 'HEADCOUNT_SOURCE_CONFLICT' }));
  });

  it('allows cancellation only before the snapshotted event starts', () => {
    expect(() =>
      requireCancellationAllowed(
        'CONFIRMED',
        '2026-12-20',
        '17:30',
        new Date('2026-12-20T10:29:59.999Z'),
      ),
    ).not.toThrow();
    expect(() =>
      requireCancellationAllowed(
        'CONFIRMED',
        '2026-12-20',
        '17:30',
        new Date('2026-12-20T10:30:00.000Z'),
      ),
    ).toThrow(BookingLifecyclePolicyError);
  });

  it('allows completion twelve hours after the snapshotted shift end', () => {
    expect(() =>
      requireCompletionDue(
        'CONFIRMED',
        '2026-12-20',
        '22:00',
        new Date('2026-12-21T03:00:00.000Z'),
      ),
    ).not.toThrow();
    expect(() =>
      requireCompletionDue(
        'CONFIRMED',
        '2026-12-20',
        '22:00',
        new Date('2026-12-21T02:59:59.999Z'),
      ),
    ).toThrow(expect.objectContaining({ code: 'BOOKING_COMPLETION_NOT_DUE' }));
  });
});
