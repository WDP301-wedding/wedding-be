import { describe, expect, it } from 'vitest';

import {
  BookingTimelinePolicyError,
  approveTimelineRevision,
  createTimelineRevision,
  withdrawTimelineApproval,
  type TimelineRevision,
} from './timeline.policy.js';

const shift = Object.freeze({ startTime: '17:30', endTime: '22:00' });
const items = Object.freeze([
  Object.freeze({
    itemId: '00000000-0000-4000-8000-000000000001',
    order: 0,
    startTime: '18:00',
    title: 'Welcome guests',
    description: null,
  }),
]);

describe('timeline policy', () => {
  it('creates an immutable first revision from an empty or copied template', () => {
    const result = createTimelineRevision({
      revisionId: '00000000-0000-4000-8000-000000000010',
      bookingId: '00000000-0000-4000-8000-000000000011',
      predecessor: null,
      items,
      shift,
      createdAt: new Date('2026-10-07T10:00:00.000Z'),
    });

    expect(result.changed).toBe(true);
    expect(result.revision).toMatchObject({ revisionNumber: 1, state: 'CURRENT', items });
    expect(Object.isFrozen(result.revision.items[0])).toBe(true);
  });

  it('returns the same revision for a canonical no-op save', () => {
    const predecessor = revision();
    const result = createTimelineRevision({
      revisionId: '00000000-0000-4000-8000-000000000099',
      bookingId: predecessor.bookingId,
      predecessor,
      items: [{ ...items[0]! }],
      shift,
      createdAt: new Date('2026-10-07T11:00:00.000Z'),
    });

    expect(result).toEqual({ changed: false, revision: predecessor });
    expect(result.revision).toBe(predecessor);
  });

  it('creates a successor without carrying either approval forward', () => {
    const predecessor = {
      ...revision(),
      managerApprovedAt: new Date('2026-10-07T10:05:00.000Z'),
      coupleApprovedAt: new Date('2026-10-07T10:06:00.000Z'),
    } satisfies TimelineRevision;
    const result = createTimelineRevision({
      revisionId: '00000000-0000-4000-8000-000000000012',
      bookingId: predecessor.bookingId,
      predecessor,
      items: [{ ...items[0]!, title: 'Updated welcome' }],
      shift,
      createdAt: new Date('2026-10-07T11:00:00.000Z'),
    });

    expect(result.revision).toMatchObject({
      revisionNumber: 2,
      predecessorRevisionId: predecessor.revisionId,
      managerApprovedAt: null,
      coupleApprovedAt: null,
    });
  });

  it.each([
    [[{ ...items[0]!, startTime: '22:00' }], 'TIMELINE_ITEM_TIME_INVALID'],
    [[{ ...items[0]!, title: '' }], 'TIMELINE_ITEM_TEXT_INVALID'],
    [[items[0]!, { ...items[0]!, order: 1 }], 'TIMELINE_ITEM_ID_DUPLICATE'],
    [[{ ...items[0]!, order: 1 }], 'TIMELINE_ITEM_ORDER_INVALID'],
  ] as const)('rejects invalid timeline items', (candidate, code) => {
    expect(() =>
      createTimelineRevision({
        revisionId: '00000000-0000-4000-8000-000000000010',
        bookingId: '00000000-0000-4000-8000-000000000011',
        predecessor: null,
        items: candidate,
        shift,
        createdAt: new Date('2026-10-07T10:00:00.000Z'),
      }),
    ).toThrow(expect.objectContaining({ code }));
  });

  it('binds approvals to the exact current non-empty revision', () => {
    const approvedAt = new Date('2026-10-07T10:05:00.000Z');
    const managerApproved = approveTimelineRevision(revision(), 'MANAGER', approvedAt);
    const mutuallyApproved = approveTimelineRevision(managerApproved, 'COUPLE', approvedAt);

    expect(mutuallyApproved.managerApprovedAt).toEqual(approvedAt);
    expect(mutuallyApproved.coupleApprovedAt).toEqual(approvedAt);
    expect(mutuallyApproved.mutuallyApproved).toBe(true);
    expect(() =>
      approveTimelineRevision({ ...revision(), state: 'SUPERSEDED' }, 'COUPLE', approvedAt),
    ).toThrow(BookingTimelinePolicyError);
  });

  it('withdraws only the actor own pre-deposit approval', () => {
    const approved = approveTimelineRevision(
      approveTimelineRevision(revision(), 'MANAGER', new Date('2026-10-07T10:05:00.000Z')),
      'COUPLE',
      new Date('2026-10-07T10:06:00.000Z'),
    );
    const withdrawn = withdrawTimelineApproval(approved, 'COUPLE', 'DRAFT');

    expect(withdrawn.managerApprovedAt).not.toBeNull();
    expect(withdrawn.coupleApprovedAt).toBeNull();
    expect(() => withdrawTimelineApproval(approved, 'MANAGER', 'CONFIRMED')).toThrow(
      BookingTimelinePolicyError,
    );
  });
});

function revision(): TimelineRevision {
  return Object.freeze({
    revisionId: '00000000-0000-4000-8000-000000000010',
    bookingId: '00000000-0000-4000-8000-000000000011',
    revisionNumber: 1,
    predecessorRevisionId: null,
    state: 'CURRENT',
    managerApprovedAt: null,
    coupleApprovedAt: null,
    mutuallyApproved: false,
    items,
    createdAt: new Date('2026-10-07T10:00:00.000Z'),
  });
}
