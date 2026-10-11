import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { PrismaBookingBoundary } from '../../../core/database/booking-boundary.js';
import type { GuestInvitationReader } from '../../guest-management/application/guest.contracts.js';
import { NotFoundError } from '../../../core/errors/app-error.js';
import { publicInvitationSchema } from '../domain/public-invitation.js';

/** Minimal public snapshot only. No Storage signing, private design or Billing data. */
export function createGuestPublicationReader(
  prisma: PrismaClient,
  boundary: PrismaBookingBoundary,
): GuestInvitationReader {
  return {
    async getCurrent(bookingId, publicInvitationId) {
      const db = boundary.current(bookingId) ?? prisma;
      const identity = await db.invitationPublicIdentity.findUnique({ where: { bookingId } });
      if (
        identity === null ||
        identity.currentPublicationId === null ||
        (publicInvitationId !== undefined && identity.id !== publicInvitationId)
      )
        throw new NotFoundError();
      const row = await db.invitationPublishedRevision.findFirst({
        where: { id: identity.currentPublicationId, bookingId },
      });
      if (row === null) throw new NotFoundError();
      return publicInvitationSchema.parse(row.content);
    },
  };
}
