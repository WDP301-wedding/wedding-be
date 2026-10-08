import { z } from 'zod';
import { AppError } from '../../../core/errors/app-error.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { BookingReportingReader } from '../application/booking-snapshots.js';
import { bookingReportRowSchema, sourceQuerySchema } from '../application/reporting.schemas.js';

const cursorSchema = z.strictObject({
  afterSequence: z.int().nonnegative(),
  throughSequence: z.int().nonnegative(),
  sequence: z.int().nonnegative(),
});

export function createPrismaBookingReportingReader(prisma: PrismaClient): BookingReportingReader {
  return Object.freeze({
    async readPage(
      query: Parameters<BookingReportingReader['readPage']>[0],
      context: Parameters<BookingReportingReader['readPage']>[1],
    ) {
      const actor =
        context.actorAccountId === null
          ? null
          : await prisma.account.findUnique({
              where: { id: context.actorAccountId },
              select: { status: true, roles: { select: { role: true } } },
            });
      if (
        context.authority !== 'AUTHENTICATED' ||
        actor?.status !== 'ACTIVE' ||
        !actor.roles.some(({ role }) => role === 'MANAGER')
      ) {
        throw new AppError({
          status: 403,
          code: 'FORBIDDEN',
          message: 'Reporting requires an active Manager.',
        });
      }
      const input = sourceQuerySchema.parse(query);
      const counter = await prisma.bookingReportingSequence.findUniqueOrThrow({
        where: { owner: 'booking' },
      });
      const throughSequence = input.throughSequence ?? counter.value;
      let sequence = input.afterSequence;
      if (throughSequence > counter.value || throughSequence < sequence) throw invalidCursor();
      if (input.cursor !== undefined) {
        let cursor: z.infer<typeof cursorSchema>;
        try {
          cursor = cursorSchema.parse(
            JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')),
          );
        } catch {
          throw invalidCursor();
        }
        if (
          cursor.afterSequence !== input.afterSequence ||
          cursor.throughSequence !== throughSequence ||
          cursor.sequence < sequence ||
          cursor.sequence > throughSequence
        )
          throw invalidCursor();
        sequence = cursor.sequence;
      }
      const rows = await prisma.bookingReportingSnapshot.findMany({
        where: { sequence: { gt: sequence, lte: throughSequence } },
        orderBy: { sequence: 'asc' },
        take: input.limit + 1,
      });
      const page = rows.slice(0, input.limit);
      return Object.freeze({
        throughSequence,
        nextCursor:
          rows.length <= input.limit
            ? null
            : Buffer.from(
                JSON.stringify({
                  afterSequence: input.afterSequence,
                  throughSequence,
                  sequence: page.at(-1)!.sequence,
                }),
              ).toString('base64url'),
        rows: Object.freeze(
          page.map((row) =>
            Object.freeze({
              recordId: row.bookingId,
              sequence: row.sequence,
              changedAt: row.changedAt.toISOString(),
              value: Object.freeze(bookingReportRowSchema.parse(row.value)),
            }),
          ),
        ),
      });
    },
  });
}

function invalidCursor(): AppError {
  return new AppError({
    status: 422,
    code: 'VALIDATION_ERROR',
    message: 'The reporting cursor does not match its query fence.',
  });
}
