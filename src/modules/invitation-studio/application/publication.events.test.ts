import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { invitationPublicationEvent } from './publication.events.js';
describe('publication producer event contracts', () => {
  it.each(['invitation.publication-changed', 'invitation.unpublished'] as const)(
    'keeps required immutable fields and rejects secret/additional/null fields for %s',
    (eventType) => {
      const bookingId = randomUUID(),
        changedAt = new Date().toISOString();
      const event = {
        eventId: randomUUID(),
        eventType,
        eventVersion: 1,
        occurredAt: changedAt,
        producerModule: 'invitation-studio',
        aggregateType: 'BOOKING',
        aggregateId: bookingId,
        correlationId: randomUUID(),
        causationId: randomUUID(),
        payload: {
          bookingId,
          publicInvitationId: randomUUID(),
          publishedRevisionId: randomUUID(),
          changedAt,
        },
      };
      expect(invitationPublicationEvent.safeParse(event).success).toBe(true);
      for (const patch of [
        { publishedRevisionId: null },
        { accessToken: 'secret' },
        { bookingId: randomUUID() },
      ])
        expect(
          invitationPublicationEvent.safeParse({
            ...event,
            payload: { ...event.payload, ...patch },
          }).success,
        ).toBe(false);
      expect(
        invitationPublicationEvent.safeParse({
          ...event,
          occurredAt: new Date(Date.now() + 1000).toISOString(),
        }).success,
      ).toBe(false);
    },
  );
});
