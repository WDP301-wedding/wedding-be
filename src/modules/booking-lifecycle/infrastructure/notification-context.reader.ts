import { z } from 'zod';
import type { PrismaClient } from '../../../generated/prisma/client.js';

/** Booking-owned audience facts; no notification delivery becomes business authority. */
export function createNotificationBookingReader(prisma: PrismaClient) {
  async function read(bookingId: string) {
    const row = await prisma.booking.findUnique({
      where: { id: z.uuid().parse(bookingId) },
      select: {
        id: true,
        revision: true,
        phase: true,
        consultationId: true,
        eventDate: true,
        effectiveTimelineRevisionId: true,
        currentTimelineRevisionId: true,
        effectiveTimelineRevision: { select: { revisionNumber: true } },
      },
    });
    if (!row) return null;
    const consultation = await prisma.consultation.findUnique({
      where: { id: row.consultationId },
      select: { managerAccountId: true },
    });
    const access = await prisma.consultationAccess.findMany({
      where: { consultationId: row.consultationId },
      select: { accountId: true, level: true },
    });
    return {
      ...row,
      scheduleRevision: row.effectiveTimelineRevision?.revisionNumber ?? null,
      managerAccountId: consultation?.managerAccountId ?? null,
      couples: access.map((a) => ({ accountId: a.accountId, level: a.level })),
    };
  }
  return {
    read,
    async notificationBookingIds(accountId: string, currentManager: boolean) {
      const access = await prisma.consultationAccess.findMany({
        where: { accountId },
        select: { consultationId: true },
      });
      const rows = await prisma.booking.findMany({
        where: {
          OR: [
            { consultationId: { in: access.map((a) => a.consultationId) } },
            ...(currentManager ? [{ consultation: { managerAccountId: accountId } }] : []),
          ],
        },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    },
    async fromConsultation(consultationId: string) {
      const row = await prisma.booking.findUnique({
        where: { consultationId: z.uuid().parse(consultationId) },
        select: { id: true },
      });
      return row ? read(row.id) : null;
    },
  };
}
