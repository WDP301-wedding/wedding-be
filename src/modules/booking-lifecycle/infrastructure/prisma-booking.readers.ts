import { z } from 'zod';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import type {
  ContractContext,
  PrismaBookingBoundary,
} from '../../../core/database/booking-boundary.js';
import { NotFoundError, ValidationError } from '../../../core/errors/app-error.js';
import type { ConsultationAccessReader } from '../../identity-access/authorization/authorization.service.js';
import type { DepositSettlementReader } from '../../payments-billing/application/deposit-settlement.reader.js';
import type {
  BookingMediaPrerequisiteReader,
  BookingTimelineSnapshotReader,
} from '../application/booking-readers.js';
import { approvedTimelineSnapshotSchema } from '../application/booking-readers.js';

import { createPrismaBookingTimelineSnapshotReader } from './booking-readers.repository.js';
import { BookingLifecycleNotFoundError } from './consultation.repository.js';
import { readLockedBooking } from './locked-booking.reader.js';

export function createPrismaBookingReaders(
  prisma: PrismaClient,
  boundary: PrismaBookingBoundary,
  access: ConsultationAccessReader,
  billing: DepositSettlementReader,
  options: { allowCompleted?: boolean } = {},
): { booking: BookingMediaPrerequisiteReader; timeline: BookingTimelineSnapshotReader } {
  async function readBooking(bookingId: string) {
    bookingId = z.uuid().parse(bookingId).toLowerCase();
    return readLockedBooking(prisma, boundary, bookingId);
  }
  const booking: BookingMediaPrerequisiteReader = {
    async requireBookingAccess(input) {
      const row = await readBooking(input.bookingId);
      await access.requireAccess({
        accountId: input.accountId,
        consultationId: row.consultationId,
        minimum: input.minimum,
      });
      return {
        bookingId: row.id,
        consultationId: row.consultationId,
        phase: row.phase,
      };
    },
    async requireConfirmedEventContext(bookingId) {
      const row = await readBooking(bookingId);
      if (
        (row.phase !== 'CONFIRMED' &&
          !(options.allowCompleted === true && row.phase === 'COMPLETED')) ||
        row.effectiveTimelineRevisionId === null
      )
        throw new NotFoundError();
      await billing.requireDepositSettlement(row.id);
      return {
        consultationId: row.consultationId,
        bookingId: row.id,
        hallId: row.hallId,
        shiftCode: row.shiftCode,
        eventDate: row.eventDate.toISOString().slice(0, 10),
        effectiveTimelineRevisionId: row.effectiveTimelineRevisionId,
        planningHeadcount: row.planningHeadcount,
      };
    },
  };
  const timeline: BookingTimelineSnapshotReader = {
    async resolveApprovedRevision(input, context: ContractContext) {
      const bookingId = z.uuid().parse(input.bookingId).toLowerCase();
      const id = z.uuid().parse(input.timelineRevisionId).toLowerCase();
      if (context.authority !== 'AUTHENTICATED' || context.actorAccountId === null)
        throw new ValidationError();
      const tx =
        context.transactionScopeId === undefined
          ? boundary.current(bookingId)
          : boundary.requireScope(bookingId, context);
      if (tx !== undefined && context.transactionScopeId === undefined) throw new ValidationError();
      await readBooking(bookingId);
      const snapshot = await createPrismaBookingTimelineSnapshotReader(
        (tx ?? prisma) as PrismaClient,
      )
        .resolveApprovedRevision({ bookingId, timelineRevisionId: id }, context)
        .catch((error: unknown) => {
          if (error instanceof BookingLifecycleNotFoundError) throw new NotFoundError();
          throw error;
        });
      const result = approvedTimelineSnapshotSchema.safeParse(snapshot);
      if (!result.success) throw new ValidationError();
      return result.data;
    },
  };
  return { booking, timeline };
}
