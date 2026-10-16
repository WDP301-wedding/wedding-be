import { z } from 'zod';
import type { PrismaBookingBoundary } from '../../../core/database/booking-boundary.js';
import { NotFoundError, ValidationError } from '../../../core/errors/app-error.js';
import type { BookingPlanningSnapshotReader } from '../application/planning-snapshot.reader.js';
import { readLockedBooking } from './locked-booking.reader.js';
export function createPrismaPlanningSnapshotReader(
  boundary: PrismaBookingBoundary,
): BookingPlanningSnapshotReader {
  return {
    async getCurrent(value, context) {
      const bookingId = z.uuid().parse(value).toLowerCase();
      boundary.requireScope(bookingId, context);
      const row = await readLockedBooking(boundary.prisma, boundary, bookingId);
      if (row.phase !== 'CONFIRMED') throw new NotFoundError();
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
