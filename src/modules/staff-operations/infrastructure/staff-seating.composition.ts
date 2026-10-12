import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { createInvitationStudioServices } from '../../invitation-studio/infrastructure/studio.composition.js';
import { createStaffServices } from './staff.composition.js';
import { createSeatingServices } from '../../seating-plan/infrastructure/seating.composition.js';
/** Shared scope: Staff authenticates the operations call before Seating reads it. */
export function createStaffSeatingServices(
  prisma: PrismaClient,
  studio: ReturnType<typeof createInvitationStudioServices>,
  now: () => Date = () => new Date(),
) {
  const staff = createStaffServices(prisma, now, studio.boundary, {
    getGuidance: (bookingId, context) => seating.seating.getGuidance(bookingId, context),
  });
  const seating = createSeatingServices(prisma, studio, now, staff.seatingAccess);
  return { staff, seating };
}
