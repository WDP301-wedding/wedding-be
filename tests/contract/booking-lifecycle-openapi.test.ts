import { describe, expect, it } from 'vitest';

import { createOpenApiDocument } from '../../src/core/openapi/generate.js';

describe('BK-C3 immutable booking lifecycle contract', () => {
  it('publishes every approved consultation, timeline, and lifecycle route', () => {
    const paths = createOpenApiDocument().paths ?? {};
    const operations = [
      ['/management/consultations', 'post', 'createConsultation'],
      [
        '/management/consultations/{consultationId}/workspace-invitations',
        'post',
        'requestWorkspaceInvitation',
      ],
      ['/management/availability', 'get', 'getBookingAvailability'],
      ['/bookings', 'post', 'createBooking'],
      ['/bookings/{bookingId}/slot-holds', 'post', 'acquireBookingSlotHold'],
      ['/bookings/{bookingId}/proposal', 'get', 'getBookingProposal'],
      ['/bookings/{bookingId}/timeline-revisions', 'post', 'createBookingTimelineRevision'],
      [
        '/bookings/{bookingId}/timeline-revisions/{revisionId}/approvals',
        'post',
        'approveBookingTimelineRevision',
      ],
      [
        '/bookings/{bookingId}/timeline-revisions/{revisionId}/withdrawals',
        'post',
        'withdrawBookingTimelineApproval',
      ],
      ['/bookings/{bookingId}/change-requests', 'post', 'requestBookingTimelineChange'],
      ['/bookings/{bookingId}/cancellation-requests', 'post', 'requestBookingCancellation'],
      ['/management/bookings/{bookingId}/cancellation', 'post', 'cancelBooking'],
      ['/management/bookings/{bookingId}/completion', 'post', 'completeBooking'],
    ] as const;

    for (const [path, method, operationId] of operations) {
      expect(paths).toHaveProperty(`${path}.${method}.operationId`, operationId);
    }
  });

  it('requires bearer authentication and idempotency for every write', () => {
    const paths = createOpenApiDocument().paths ?? {};
    for (const [path, item] of Object.entries(paths)) {
      if (!path.includes('booking') && !path.includes('consultation')) continue;
      const post = item?.post;
      if (post === undefined) continue;
      expect(post.security).toEqual([{ bearerAuth: [] }]);
      expect(post.parameters).toContainEqual({ $ref: '#/components/parameters/IdempotencyKey' });
    }
  });
});
