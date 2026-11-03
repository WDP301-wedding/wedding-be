import { afterEach, describe, expect, it, vi } from 'vitest';
afterEach(() => vi.unstubAllEnvs());

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
        sourceGuestPlanRevisionId: 'r10',
        sourceSequence: 10,
        expectedAttendees: 120,
      }),
    ).toMatchObject({ outcome: 'APPLIED' });
    const current = {
      sourceGuestPlanRevisionId: 'r10',
      sourceSequence: 10,
      expectedAttendees: 120,
    };
    expect(applyHeadcountEvidence(current, current).outcome).toBe('REPLAYED');
    expect(
      applyHeadcountEvidence(current, {
        sourceGuestPlanRevisionId: 'r9',
        sourceSequence: 9,
        expectedAttendees: 100,
      }).outcome,
    ).toBe('IGNORED_STALE');
    expect(() =>
      applyHeadcountEvidence(current, {
        sourceGuestPlanRevisionId: 'other',
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
    vi.stubEnv('STRICT_SETTLEMENT_DATE_CHECK', 'true');
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
  it('allows early demo completion by default and still requires a confirmed booking', () => {
    vi.stubEnv('STRICT_SETTLEMENT_DATE_CHECK', undefined);
    const early = new Date('2026-12-19T00:00:00Z');
    expect(() => requireCompletionDue('CONFIRMED', '2026-12-20', '22:00', early)).not.toThrow();
    expect(() => requireCompletionDue('DRAFT', '2026-12-20', '22:00', early)).toThrow(
      expect.objectContaining({ code: 'INVALID_BOOKING_TRANSITION' }),
    );
  });
});
