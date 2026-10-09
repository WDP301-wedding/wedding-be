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

const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);
const phase = z.enum(['DRAFT', 'AWAITING_DEPOSIT', 'CONFIRMED', 'CANCELLED', 'COMPLETED']);
const shift = z.enum(['LUNCH', 'DINNER']);
const itemsSchema = z
  .array(
    z.strictObject({
      itemId: z.uuid(),
      order: z.number().int().nonnegative(),
      startTime: time,
      title: z.string().min(1).max(120),
      description: z.string().max(2000).nullable(),
    }),
  )
  .max(100)
  .refine(
    (items) =>
      new Set(items.map((i) => i.itemId)).size === items.length &&
      new Set(items.map((i) => i.order)).size === items.length,
  );

export function createPrismaBookingReaders(
  prisma: PrismaClient,
  boundary: PrismaBookingBoundary,
  access: ConsultationAccessReader,
  billing: DepositSettlementReader,
): { booking: BookingMediaPrerequisiteReader; timeline: BookingTimelineSnapshotReader } {
  async function readBooking(bookingId: string) {
    bookingId = z.uuid().parse(bookingId).toLowerCase();
    const tx = boundary.current(bookingId);
    // A writer changing current phase/effective revision must wait until acceptance
    // commits, including a legacy writer not yet enlisted on the advisory boundary.
    if (tx !== undefined)
      await tx.$queryRaw`SELECT id FROM "Booking" WHERE id=${bookingId}::uuid FOR SHARE`;
    const row = await (tx ?? prisma).booking.findUnique({ where: { id: bookingId } });
    if (row === null) throw new NotFoundError();
    return row;
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
        phase: phase.parse(row.phase),
      };
    },
    async requireConfirmedEventContext(bookingId) {
      const row = await readBooking(bookingId);
      if (
        row.phase !== 'CONFIRMED' ||
        row.effectiveTimelineRevisionId === null ||
        row.confirmedPaymentId === null ||
        row.confirmedAt === null
      )
        throw new NotFoundError();
      const settlement = await billing.requireDepositSettlement(row.id);
      if (settlement.paymentId !== row.confirmedPaymentId || settlement.settledAt > row.confirmedAt)
        throw new NotFoundError();
      return {
        consultationId: row.consultationId,
        bookingId: row.id,
        hallId: row.hallId,
        shiftCode: shift.parse(row.shiftCode),
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
      const row = await readBooking(bookingId);
      const snapshot = await (tx ?? prisma).bookingTimelineRevision.findFirst({
        where: { bookingId, id },
      });
      if (
        snapshot === null ||
        snapshot.approvedByManagerAt === null ||
        snapshot.approvedByCoupleAt === null
      )
        throw new NotFoundError();
      const items = itemsSchema.safeParse(snapshot.items);
      if (!items.success) throw new ValidationError();
      const result = approvedTimelineSnapshotSchema.safeParse({
        bookingId,
        timelineRevisionId: id,
        revisionNumber: snapshot.revisionNumber,
        eventDate: snapshot.eventDate.toISOString().slice(0, 10),
        hallName: snapshot.hallName,
        shiftCode: shift.parse(snapshot.shiftCode),
        shiftStartTime: time.parse(snapshot.shiftStartTime),
        shiftEndTime: time.parse(snapshot.shiftEndTime),
        items: items.data.sort((a, b) => a.order - b.order),
        approvedByManagerAt: snapshot.approvedByManagerAt.toISOString(),
        approvedByCoupleAt: snapshot.approvedByCoupleAt.toISOString(),
        isEffective: row.effectiveTimelineRevisionId === id,
      });
      if (!result.success) throw new ValidationError();
      return result.data;
    },
  };
  return { booking, timeline };
}
