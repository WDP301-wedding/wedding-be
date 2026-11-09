import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { createInvitationStudioServices } from '../../invitation-studio/infrastructure/studio.composition.js';
import { createStaffServices } from './staff.composition.js';
import { createSeatingServices } from '../../seating-plan/infrastructure/seating.composition.js';
import type { StaffInvitationIssuer } from '../../identity-access/staff-invitation/staff-invitation.service.js';
/** Shared scope: Staff authenticates the operations call before Seating reads it. */
export function createStaffSeatingServices(
  prisma: PrismaClient,
  studio: ReturnType<typeof createInvitationStudioServices>,
  now: () => Date = () => new Date(),
  invitations?: StaffInvitationIssuer,
) {
  const staff = createStaffServices(
    prisma,
    now,
    studio.boundary,
    {
      getOperationalPlan: (bookingId, context) =>
        seating.seating.getOperationalPlan(bookingId, context),
      getGuidance: (bookingId, context) => seating.seating.getGuidance(bookingId, context),
    },
    invitations,
  );
  const seating = createSeatingServices(prisma, studio, now, staff.seatingAccess);
  return { staff, seating };
}
