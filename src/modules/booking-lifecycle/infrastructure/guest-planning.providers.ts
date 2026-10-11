import type { PrismaClient } from '../../../generated/prisma/client.js';
import type {
  ContractContext,
  PrismaBookingBoundary,
} from '../../../core/database/booking-boundary.js';
import { enlistedPrismaClient } from '../../../core/database/enlisted-prisma-client.js';
import { AppError, NotFoundError } from '../../../core/errors/app-error.js';
import type { DepositSettlementReader } from '../../payments-billing/application/deposit-settlement.reader.js';
import { createPrismaPlanningSnapshotReader } from './prisma-planning-snapshot.reader.js';
import {
  createPrismaBookingLifecycleRepository,
  type BookingPlanningHeadcountSynchronizer,
} from './lifecycle.repository.js';

/** Booking owns both the initialization source and ordered evidence writer. */
export function createGuestBookingPlanningProviders(
  prisma: PrismaClient,
  boundary: PrismaBookingBoundary,
  billing: DepositSettlementReader,
) {
  const planning = createPrismaPlanningSnapshotReader(boundary);
  return {
    async requireInvitationViewContext(bookingId: string) {
      const row = await (boundary.current(bookingId) ?? prisma).booking.findUnique({
        where: { id: bookingId },
      });
      if (row === null || (row.phase !== 'CONFIRMED' && row.phase !== 'COMPLETED'))
        throw new NotFoundError();
      await billing.requireDepositSettlement(bookingId);
    },
    async getSource(bookingId: string, context: ContractContext) {
      const snapshot = await planning.getCurrent(bookingId, context);
      const evidence = await boundary
        .requireScope(bookingId, context)
        .bookingHeadcountEvidence.findUnique({ where: { bookingId } });
      if (evidence !== null && evidence.expectedAttendees !== snapshot.planningHeadcount)
        throw new AppError({
          status: 409,
          code: 'HEADCOUNT_SOURCE_CONFLICT',
          message: 'Booking planning evidence is inconsistent.',
        });
      return {
        ...snapshot,
        sourceSequence: evidence?.sourceSequence ?? 0,
        sourceGuestPlanRevisionId: evidence?.sourceGuestPlanRevisionId ?? null,
      };
    },
    synchronize(
      input: Parameters<BookingPlanningHeadcountSynchronizer['synchronizeHeadcount']>[0],
      context: ContractContext,
    ) {
      const tx = boundary.requireScope(input.bookingId, context);
      return createPrismaBookingLifecycleRepository(enlistedPrismaClient(tx)).synchronizeHeadcount(
        input,
        context,
      );
    },
  };
}
