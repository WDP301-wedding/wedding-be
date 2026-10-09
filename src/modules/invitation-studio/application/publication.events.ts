import { z } from 'zod';

export const invitationPublicationPayload = z.strictObject({
  bookingId: z.uuid(),
  publicInvitationId: z.uuid(),
  publishedRevisionId: z.uuid(),
  changedAt: z.iso.datetime(),
});
/** Removal retains the last removed immutable revision; null is never emitted. */
export const invitationPublicationEvent = z
  .strictObject({
    eventId: z.uuid(),
    eventType: z.enum(['invitation.publication-changed', 'invitation.unpublished']),
    eventVersion: z.literal(1),
    occurredAt: z.iso.datetime(),
    producerModule: z.literal('invitation-studio'),
    aggregateType: z.literal('BOOKING'),
    aggregateId: z.uuid(),
    correlationId: z.uuid(),
    causationId: z.uuid(),
    payload: invitationPublicationPayload,
  })
  .refine(
    (value) =>
      value.aggregateId === value.payload.bookingId && value.occurredAt === value.payload.changedAt,
  );
