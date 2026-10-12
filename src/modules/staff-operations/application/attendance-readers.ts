import { z } from 'zod';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import type {
  ContractContext,
  PrismaBookingBoundary,
} from '../../../core/database/booking-boundary.js';
import { NotFoundError, ValidationError } from '../../../core/errors/app-error.js';
import { id, parse } from '../../guest-management/domain/guest-policy.js';
import { mode } from '../domain/staff-policy.js';
import type { GuestReaders } from '../../guest-management/application/guest-readers.js';
import type { BookingMediaPrerequisiteReader } from '../../booking-lifecycle/application/booking-readers.js';
export const attendanceSchema = z.strictObject({
  bookingId: z.uuid(),
  checkInMode: mode,
  measurementStatus: z.enum(['NOT_RECORDED', 'LISTED_GUESTS_ONLY']),
  checkedInGuestCount: z.int().nonnegative().nullable(),
  ledgerRevision: z.int().nonnegative(),
  byGuestGroup: z.array(
    z.strictObject({
      guestGroupId: z.uuid(),
      groupNameSnapshot: z.string().min(1).max(80),
      groupColorSnapshot: z.string().regex(/^#[A-F0-9]{6}$/u),
      checkedInGuestCount: z.int().nonnegative(),
    }),
  ),
});
export type AttendanceSnapshot = Readonly<
  Omit<z.output<typeof attendanceSchema>, 'byGuestGroup'> & {
    byGuestGroup: readonly Readonly<z.output<typeof attendanceSchema>['byGuestGroup'][number]>[];
  }
>;
export type GuestCheckInSnapshot = Readonly<{
  guestId: string;
  checkedIn: boolean;
  ledgerRevision: number;
  checkInRecordId: string | null;
}>;
export type AttendanceSourcePage = Readonly<{
  throughSequence: number;
  nextAfterSequence: number | null;
  rows: readonly Readonly<{
    recordId: string;
    sequence: number;
    changedAt: string;
    value: AttendanceSnapshot;
  }>[];
}>;
export async function attendance(
  tx: Prisma.TransactionClient | PrismaClient,
  bookingId: string,
): Promise<AttendanceSnapshot> {
  const head = await tx.staffConfiguration.findUnique({ where: { bookingId } });
  if (head?.checkInMode !== 'BY_GUEST_NAME')
    return attendanceSchema.parse({
      bookingId,
      checkInMode: 'NONE',
      measurementStatus: 'NOT_RECORDED',
      checkedInGuestCount: null,
      ledgerRevision: 0,
      byGuestGroup: [],
    });
  const rows = await tx.$queryRaw<
    Array<{
      guestGroupId: string;
      groupNameSnapshot: string;
      groupColorSnapshot: string;
      checkedInGuestCount: number;
    }>
  >`
    WITH latest AS (SELECT DISTINCT ON ("guestId") * FROM "StaffCheckInRecord" WHERE "bookingId"=${bookingId}::uuid ORDER BY "guestId","ledgerRevision" DESC)
    SELECT "guestGroupId","groupNameSnapshot","groupColorSnapshot",count(*)::integer AS "checkedInGuestCount" FROM latest WHERE action='CHECK_IN' GROUP BY "guestGroupId","groupNameSnapshot","groupColorSnapshot" ORDER BY "guestGroupId","groupNameSnapshot","groupColorSnapshot"`;
  return attendanceSchema.parse({
    bookingId,
    checkInMode: 'BY_GUEST_NAME',
    measurementStatus: 'LISTED_GUESTS_ONLY',
    checkedInGuestCount: rows.reduce((sum, r) => sum + r.checkedInGuestCount, 0),
    ledgerRevision: head.ledgerRevision,
    byGuestGroup: rows,
  });
}
export class AttendanceReaders {
  constructor(
    readonly prisma: PrismaClient,
    readonly boundary: PrismaBookingBoundary,
    readonly guests: Pick<GuestReaders, 'getGuestReference'>,
    readonly events: BookingMediaPrerequisiteReader,
  ) {}
  async getBookingAttendance(bookingValue: string): Promise<AttendanceSnapshot> {
    const bookingId = parse(id, bookingValue),
      current = this.boundary.current(bookingId);
    if (!(await (current ?? this.prisma).staffConfiguration.findUnique({ where: { bookingId } })))
      await this.events.requireConfirmedEventContext(bookingId);
    return current
      ? attendance(current, bookingId)
      : this.prisma.$transaction((tx) => attendance(tx, bookingId), {
          isolationLevel: 'RepeatableRead',
        });
  }
  async getGuestCheckIn(guestValue: string): Promise<GuestCheckInSnapshot> {
    const guestId = parse(id, guestValue),
      tx = this.boundary.current() ?? this.prisma;
    const guest = await this.guests.getGuestReference(guestId);
    // If called within an owner scope, reject a cross-booking identity.
    this.boundary.current(guest.bookingId);
    const latest = await tx.staffCheckInRecord.findFirst({
      where: { guestId },
      orderBy: { ledgerRevision: 'desc' },
    });
    return {
      guestId,
      checkedIn: latest?.action === 'CHECK_IN',
      ledgerRevision: latest?.ledgerRevision ?? 0,
      checkInRecordId: latest?.action === 'CHECK_IN' ? latest.id : null,
    };
  }
  async readPage(
    bookingValue: string,
    value: unknown,
    context: ContractContext,
  ): Promise<AttendanceSourcePage> {
    const bookingId = parse(id, bookingValue),
      input = parse(
        z.strictObject({
          afterSequence: z.int().nonnegative(),
          throughSequence: z.int().nonnegative().optional(),
          limit: z.int().min(1).max(50),
        }),
        value,
      );
    if (
      context.authority !== 'SYSTEM' ||
      context.actorAccountId !== null ||
      !['reporting:staff-operations', 'reporting:rebuild'].includes(context.purpose ?? '')
    )
      throw new NotFoundError();
    return this.prisma.$transaction(
      async (tx) => {
        const latest = await tx.staffAttendanceSnapshot.findFirst({
          where: { bookingId },
          orderBy: { sourceSequence: 'desc' },
        });
        const fence = input.throughSequence ?? latest?.sourceSequence ?? 0;
        if (fence > (latest?.sourceSequence ?? 0) || fence < input.afterSequence)
          throw new ValidationError();
        const rows = await tx.staffAttendanceSnapshot.findMany({
          where: { bookingId, sourceSequence: { gt: input.afterSequence, lte: fence } },
          orderBy: { sourceSequence: 'asc' },
          take: input.limit + 1,
        });
        return {
          throughSequence: fence,
          nextAfterSequence:
            rows.length > input.limit ? rows[input.limit - 1]!.sourceSequence : null,
          rows: rows.slice(0, input.limit).map((r) => ({
            recordId: bookingId,
            sequence: r.sourceSequence,
            changedAt: r.createdAt.toISOString(),
            value: attendanceSchema.parse(r.payload),
          })),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
