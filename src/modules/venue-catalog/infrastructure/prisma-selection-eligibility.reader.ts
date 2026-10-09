import { z } from 'zod';
import type { PrismaBookingBoundary } from '../../../core/database/booking-boundary.js';
import { NotFoundError } from '../../../core/errors/app-error.js';
import type { VenueSelectionEligibilityReader } from '../application/selection-eligibility.reader.js';

/** Hall -> template lifecycle shared locks match the existing retirement writers.
 * Only this Venue-owned adapter reads catalog rows; it keeps locks until UoW commit. */
export function createPrismaSelectionEligibilityReader(
  boundary: PrismaBookingBoundary,
): VenueSelectionEligibilityReader {
  return {
    async getLayoutEligibility(value, context) {
      const id = z.uuid().parse(value).toLowerCase();
      const tx = boundary.enlist(context);
      const reference = await tx.layoutTemplateVersion.findUnique({
        where: { id },
        include: { layoutTemplate: true },
      });
      if (reference === null) throw new NotFoundError();
      const hallId = reference.layoutTemplate.hallId,
        templateId = reference.layoutTemplateId;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${`HALL:${hallId}`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${`LAYOUT_TEMPLATE:${templateId}`}))`;
      await tx.$queryRaw`SELECT id FROM "Hall" WHERE id=${hallId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "LayoutTemplate" WHERE id=${templateId}::uuid FOR SHARE`;
      const version = await tx.layoutTemplateVersion.findUniqueOrThrow({
        where: { id },
        include: { geometry: true, layoutTemplate: { include: { hall: true } } },
      });
      if (version.state === 'DRAFT') throw new NotFoundError();
      return {
        layoutTemplateVersionId: id,
        hallId,
        templateActive: version.layoutTemplate.lifecycle === 'ACTIVE',
        hallActive: version.layoutTemplate.hall.lifecycle === 'ACTIVE',
        currentForNewSelection: version.layoutTemplate.currentPublishedVersionId === id,
        hallMaxGuests: version.layoutTemplate.hall.maxGuests,
        totalSeatCapacity: version.geometry.reduce((total, table) => total + table.seatCapacity, 0),
      };
    },
  };
}
