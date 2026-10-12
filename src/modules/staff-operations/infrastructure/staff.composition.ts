import type { PrismaClient } from '../../../generated/prisma/client.js';
import { PrismaBookingBoundary } from '../../../core/database/booking-boundary.js';
import { createGuestServices } from '../../guest-management/infrastructure/guest.composition.js';
import { StaffService } from '../application/staff.service.js';
import { createStaffAccountProvisioner } from '../../identity-access/account/staff-provisioner.js';
import { assignmentDto } from '../application/staff.service.js';

export function createStaffServices(
  prisma: PrismaClient,
  now: () => Date = () => new Date(),
  sharedBoundary?: PrismaBookingBoundary,
) {
  const boundary = sharedBoundary ?? new PrismaBookingBoundary(prisma);
  const guests = createGuestServices(prisma, now, undefined, boundary);
  const staff = new StaffService(guests);
  const accounts = createStaffAccountProvisioner(
    prisma,
    guests.identity.resolver,
    async (tx, accountId, context, reason) => {
      const assignments = await tx.staffAssignment.findMany({
        where: { staffAccountId: accountId, status: 'ACTIVE' },
        orderBy: { id: 'asc' },
      });
      for (const reference of assignments) {
        await tx.$queryRaw`SELECT id FROM "StaffAssignment" WHERE id=${reference.id}::uuid FOR UPDATE`;
        const current = await tx.staffAssignment.findUniqueOrThrow({ where: { id: reference.id } });
        if (current.status !== 'ACTIVE') continue;
        const row = await tx.staffAssignment.update({
          where: { id: current.id },
          data: { status: 'REVOKED', revision: { increment: 1 } },
        });
        await staff.history(
          tx,
          {
            actorAccountId: context.actorId,
            requestId: context.requestId,
            causationId: context.requestId,
            authority: 'AUTHENTICATED',
          },
          row.bookingId,
          row.id,
          'ASSIGNMENT',
          row.revision,
          { ...assignmentDto(row), reason },
        );
      }
    },
    now,
  );
  const readers = {
    async getBookingAttendance(bookingId: string) {
      const head = await prisma.staffConfiguration.findUnique({ where: { bookingId } });
      return {
        checkInMode: head?.checkInMode ?? 'NONE',
        measurementStatus:
          head?.checkInMode === 'BY_GUEST_NAME' ? 'LISTED_GUESTS_ONLY' : 'NOT_RECORDED',
        checkedInGuestCount: head?.checkInMode === 'BY_GUEST_NAME' ? 0 : null,
        byGuestGroup: [],
      };
    },
  };
  return { staff, guests, readers, accounts, boundary, resolver: guests.identity.resolver };
}
