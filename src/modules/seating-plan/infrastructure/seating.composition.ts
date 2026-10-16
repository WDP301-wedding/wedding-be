import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { createInvitationStudioServices } from '../../invitation-studio/infrastructure/studio.composition.js';
import { createGuestServices } from '../../guest-management/infrastructure/guest.composition.js';
import { createScopedLayoutReader } from '../../venue-catalog/infrastructure/scoped-layout.reader.js';
import { SeatingService } from '../application/seating.service.js';
import type { SeatingStaffAccess } from '../application/seating.contracts.js';
export function createSeatingServices(
  prisma: PrismaClient,
  studio: ReturnType<typeof createInvitationStudioServices>,
  now: () => Date = () => new Date(),
  staff?: SeatingStaffAccess,
) {
  const guests = createGuestServices(prisma, now, undefined, studio.boundary);
  const seating = new SeatingService(
    guests,
    createScopedLayoutReader(prisma, studio.boundary),
    studio.venue,
    studio.printable,
    now,
    staff,
  );
  return { seating, guests, resolver: guests.identity.resolver, boundary: studio.boundary };
}
