import { z } from 'zod';
import type { PrismaBookingBoundary } from '../../../core/database/booking-boundary.js';
import { NotFoundError, ValidationError } from '../../../core/errors/app-error.js';
import type { BookingPlanningSnapshotReader } from '../application/planning-snapshot.reader.js';
export function createPrismaPlanningSnapshotReader(
  boundary: PrismaBookingBoundary,
): BookingPlanningSnapshotReader {
  return {
    async getCurrent(value, context) {
      const bookingId = z.uuid().parse(value).toLowerCase();
      const tx = boundary.requireScope(bookingId, context);
      await tx.$queryRaw`SELECT id FROM "Booking" WHERE id=${bookingId}::uuid FOR SHARE`;
      const row = await tx.booking.findUnique({ where: { id: bookingId } });
      if (row === null || row.phase !== 'CONFIRMED') throw new NotFoundError();
      if (
        !Number.isSafeInteger(row.revision) ||
        row.revision < 1 ||
        row.planningHeadcount < 0 ||
        row.planningHeadcount > 10000
      )
        throw new ValidationError();
      return { bookingId, bookingRevision: row.revision, planningHeadcount: row.planningHeadcount };
    },
  };
}
