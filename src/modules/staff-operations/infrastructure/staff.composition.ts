import type { PrismaClient } from '../../../generated/prisma/client.js';
import {
  PrismaBookingBoundary,
  type ContractContext,
} from '../../../core/database/booking-boundary.js';
import { createGuestServices } from '../../guest-management/infrastructure/guest.composition.js';
import { StaffService } from '../application/staff.service.js';
import { createStaffAccountProvisioner } from '../../identity-access/account/staff-provisioner.js';
import { assignmentDto } from '../application/staff.service.js';
import { CheckInService } from '../application/check-in.service.js';
import { AttendanceReaders } from '../application/attendance-readers.js';
import type { StaffSeatingGuidance } from '../application/staff.contracts.js';
import { createPrismaBookingReaders } from '../../booking-lifecycle/infrastructure/prisma-booking.readers.js';
import { createPrismaDepositSettlementReader } from '../../payments-billing/infrastructure/prisma-deposit-settlement.reader.js';

export function createStaffServices(
  prisma: PrismaClient,
  now: () => Date = () => new Date(),
  sharedBoundary?: PrismaBookingBoundary,
  seating?: StaffSeatingGuidance,
) {
  const boundary = sharedBoundary ?? new PrismaBookingBoundary(prisma);
  const guests = createGuestServices(
    prisma,
    now,
    {
      requireAssignedOperationsAccess: (bookingId, context) =>
        journal.requireAssignedOperationsAccess(bookingId, context),
    },
    boundary,
  );
  const events = createPrismaBookingReaders(
    prisma,
    boundary,
    guests.identity.access,
    createPrismaDepositSettlementReader(prisma, boundary),
    { allowCompleted: true },
  ).booking;
  const staff = new StaffService(guests, events);
  const journal = new CheckInService(staff, seating);
  staff.onConfigurationChanged = (tx, bookingId) => journal.snapshot(tx, bookingId);
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
  const readers = new AttendanceReaders(prisma, boundary, guests.readers, events);
  const seatingAccess = {
    requireAssignedOperationsAccess: (bookingId: string, scope: ContractContext) =>
      journal.requireSeatingScopeAccess(bookingId, scope),
  };
  return {
    staff,
    guests,
    journal,
    readers,
    accounts,
    seatingAccess,
    boundary,
    resolver: guests.identity.resolver,
  };
}
