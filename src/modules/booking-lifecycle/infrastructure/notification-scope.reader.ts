import type { PrismaClient, Prisma } from '../../../generated/prisma/client.js';
export function createNotificationScopeReader(prisma: PrismaClient | Prisma.TransactionClient) {
  return {
    async canRead(bookingId: string, accountId: string) {
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { consultationId: true },
      });
      return (
        booking !== null &&
        (await prisma.consultationAccess.count({
          where: { consultationId: booking.consultationId, accountId },
        })) > 0
      );
    },
    async schedule(bookingId: string) {
      const row = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: { proposalSnapshot: true, effectiveTimelineRevision: true },
      });
      if (row === null || row.proposalSnapshot === null) return null;
      const date = row.eventDate.toISOString().slice(0, 10),
        start = row.proposalSnapshot.shiftStartTime.toISOString().slice(11, 16);
      return {
        phase: row.phase,
        bookingRevision: row.revision,
        scheduleRevision: row.effectiveTimelineRevision?.revisionNumber ?? 1,
        d3At: new Date(new Date(`${date}T${start}:00+07:00`).getTime() - 72 * 3600000),
      };
    },
  };
}
