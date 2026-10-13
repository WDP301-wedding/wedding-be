import { Prisma } from '../../../generated/prisma/client.js';
import { type NotificationRepository } from './notification.repository.js';
import type { NotificationEvent } from '../application/notification-events.js';
/** Independent consumer lane: never steals another consumer's published flag. */
export async function readNotificationOutbox(
  repository: NotificationRepository,
): Promise<NotificationEvent[]> {
  const scope =
    repository.bookingIds === undefined
      ? Prisma.empty
      : repository.bookingIds.length === 0
        ? Prisma.sql`AND false`
        : Prisma.sql`AND e."bookingId" IN (${Prisma.join(repository.bookingIds.map((id) => Prisma.sql`${id}::uuid`))})`;
  return repository.prisma.$queryRaw<NotificationEvent[]>(Prisma.sql`
  WITH events AS (
   SELECT id AS "eventId", "aggregateId" AS "bookingId", "eventType", 'booking' AS producer,"eventVersion","aggregateRevision" AS "sourceSequence",payload,"occurredAt" AS at FROM "BookingOutboxEvent"
   UNION ALL SELECT id,"aggregateId","eventType",'billing',"eventVersion","aggregateRevision",payload,"occurredAt" FROM "BillingOutboxEvent"
   UNION ALL SELECT "eventId","bookingId","eventType",'guest',1,"sourceSequence",payload,"createdAt" FROM "GuestOutbox"
   UNION ALL SELECT "eventId","bookingId","eventType",'invitation',COALESCE((envelope->>'eventVersion')::integer,0),0,envelope->'payload',"createdAt" FROM "InvitationStudioOutbox"
   UNION ALL SELECT "eventId","bookingId","eventType",'identity',1,0,payload,"createdAt" FROM "IdentityNotificationOutbox"
  ) SELECT e."eventId",e."bookingId",e."eventType",e.producer,e."eventVersion",e."sourceSequence",e.payload
  FROM events e LEFT JOIN "NotificationReceipt" r ON r."eventId"=e."eventId"
  WHERE r."eventId" IS NULL ${scope} ORDER BY e.at,e."eventId" LIMIT 100`);
}
