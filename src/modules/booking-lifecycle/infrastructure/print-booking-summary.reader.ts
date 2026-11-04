import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import { prismaSchema } from '../../../core/database/prisma.js';
import type {
  PrintBookingSummary,
  PrintBookingSummaryReader,
} from '../application/print-booking-summary.reader.js';

export function createPrismaPrintBookingSummaryReader(
  prisma: PrismaClient,
): PrintBookingSummaryReader {
  return {
    async readMany(bookingIds) {
      if (!bookingIds.length) return new Map();
      const schema = Prisma.raw('"' + prismaSchema(prisma).replaceAll('"', '""') + '"');
      // One bounded join for the entire page, including historical/archived halls.
      const rows = await prisma.$queryRaw<(PrintBookingSummary & { id: string })[]>(Prisma.sql`
        SELECT b.id, b."bookingCode", b."eventDate"::text AS "eventDate",
          c."brideName", c."groomName", p."hallName"
        FROM ${schema}."Booking" b
        JOIN ${schema}."Consultation" c ON c.id=b."consultationId"
        LEFT JOIN ${schema}."BookingProposalSnapshot" p ON p."bookingId"=b.id
        WHERE b.id IN (${Prisma.join([...new Set(bookingIds)].map((id) => Prisma.sql`${id}::uuid`))})
      `);
      return new Map(
        rows.map((row) => [
          row.id,
          {
            bookingCode: row.bookingCode,
            brideName: row.brideName,
            groomName: row.groomName,
            eventDate: row.eventDate,
            hallName: row.hallName,
          },
        ]),
      );
    },
  };
}
