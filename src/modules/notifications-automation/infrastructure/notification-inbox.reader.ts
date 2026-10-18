import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import { prismaSchema } from '../../../core/database/prisma.js';

type BookingAudienceQuery = (accountId: string, currentManager: boolean) => Prisma.Sql;
type InboxRow = {
  id: string;
  intentId: string;
  bookingId: string | null;
  createdAt: string;
  readAt: string | null;
  revision: number;
  purpose: string;
  intentOwner: string;
  intentData: Prisma.JsonValue;
};

/** Notification-owned reads capture the Booking-owned audience in the same
 * statement snapshot. The service still revalidates Identity and Booking after it. */
export function createNotificationInboxReader(
  prisma: PrismaClient,
  bookingAudience: BookingAudienceQuery,
) {
  const schema = Prisma.raw('"' + prismaSchema(prisma).replaceAll('"', '""') + '"');
  function scope(accountId: string, manager: boolean) {
    return Prisma.sql`
      WITH audience AS (${bookingAudience(accountId, manager)}),
      scope AS MATERIALIZED (
        SELECT ARRAY(SELECT id FROM audience ORDER BY id) AS "bookingIds"
      ),
      visible AS NOT MATERIALIZED (
        SELECT n.id, n."intentId", n."bookingId", n."createdAt", n."readAt", n.revision
        FROM ${schema}."NotificationInbox" n CROSS JOIN scope s
        WHERE n."accountId"=${accountId}::uuid
          AND (n."bookingId" IS NULL OR n."bookingId"=ANY(s."bookingIds"))
      )
    `;
  }
  return {
    async page(
      accountId: string,
      manager: boolean,
      input: { limit: number; cursor?: string | undefined },
    ) {
      const afterCursor = input.cursor
        ? Prisma.sql`WHERE (n."createdAt", n.id) <
            (SELECT c."createdAt", c.id FROM visible c WHERE c.id=${input.cursor}::uuid)`
        : Prisma.empty;
      const cursorVisible = input.cursor
        ? Prisma.sql`EXISTS(SELECT 1 FROM visible c WHERE c.id=${input.cursor}::uuid)`
        : Prisma.sql`true`;
      const [snapshot] = await prisma.$queryRaw<
        { bookingIds: string[]; cursorVisible: boolean; rows: InboxRow[] }[]
      >(Prisma.sql`
        ${scope(accountId, manager)}, page AS (
          SELECT n.*, i.purpose, i.owner AS "intentOwner", i.data AS "intentData"
          FROM visible n JOIN ${schema}."NotificationIntent" i ON i.id=n."intentId"
          ${afterCursor}
          ORDER BY n."createdAt" DESC, n.id DESC LIMIT ${input.limit + 1}
        )
        SELECT s."bookingIds", ${cursorVisible} AS "cursorVisible",
          COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p."createdAt" DESC, p.id DESC)
            FROM page p), '[]'::jsonb) AS rows
        FROM scope s
      `);
      return snapshot!;
    },
    async unread(accountId: string, manager: boolean) {
      const [snapshot] = await prisma.$queryRaw<{ bookingIds: string[]; count: bigint }[]>(
        Prisma.sql`
          ${scope(accountId, manager)}
          SELECT s."bookingIds", (SELECT count(*) FROM visible WHERE "readAt" IS NULL)
            AS count FROM scope s
        `,
      );
      return { bookingIds: snapshot!.bookingIds, count: Number(snapshot!.count) };
    },
  };
}
