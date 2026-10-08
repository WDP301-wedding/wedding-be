import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../../core/errors/app-error.js';
import { bookingEventMetadata } from '../../../core/integration-events/booking-event.js';
import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import type { BookingAutomationPort } from '../application/automation.js';
import { BookingLifecyclePolicyError, requireCompletionDue } from '../domain/lifecycle.policy.js';
import { BookingLifecycleNotFoundError } from './consultation.repository.js';
import type { BookingTerminalRetentionRecorder } from './lifecycle.repository.js';

const cursorSchema = z.strictObject({
  kind: z.enum(['D3_REMINDER', 'COMPLETION']),
  dueBefore: z.string(),
  bookingId: z.uuid(),
});

export function createPrismaBookingAutomationRepository(
  prisma: PrismaClient,
  now: () => Date = () => new Date(),
  recordRetention: BookingTerminalRetentionRecorder = () => Promise.resolve(),
): BookingAutomationPort {
  return Object.freeze({
    async listDue(input: Parameters<BookingAutomationPort['listDue']>[0]) {
      let afterId: string | null = null;
      if (input.cursor !== undefined) {
        try {
          const cursor = cursorSchema.parse(
            JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')),
          );
          if (cursor.kind !== input.kind || cursor.dueBefore !== input.dueBefore)
            throw new Error('fence');
          afterId = cursor.bookingId;
        } catch {
          throw conflict('VALIDATION_ERROR', 422);
        }
      }
      const offset =
        input.kind === 'COMPLETION'
          ? Prisma.sql`INTERVAL '12 hours'`
          : Prisma.sql`INTERVAL '-3 days'`;
      const shiftTime =
        input.kind === 'COMPLETION' ? Prisma.sql`p."shiftEndTime"` : Prisma.sql`p."shiftStartTime"`;
      const rows = await prisma.$queryRaw<
        readonly Readonly<{
          bookingId: string;
          bookingRevision: number;
          dueAt: Date;
          coupleAccountId: string;
        }>[]
      >(Prisma.sql`
        SELECT b."id" AS "bookingId", b."revision" AS "bookingRevision",
          ((b."eventDate" + ${shiftTime}) AT TIME ZONE 'Asia/Ho_Chi_Minh') + ${offset} AS "dueAt", ca."accountId" AS "coupleAccountId"
        FROM "Booking" b JOIN "BookingProposalSnapshot" p ON p."bookingId" = b."id"
        JOIN "BookingDepositSettlement" s ON s."bookingId" = b."id"
        JOIN "ConsultationAccess" ca ON ca."consultationId" = b."consultationId" AND ca."sourcePaymentId" = s."paymentId" AND ca."level" = 'FULL'
        JOIN "Account" a ON a."id" = ca."accountId" AND a."status" = 'ACTIVE'
        WHERE b."phase" = 'CONFIRMED' AND (${afterId}::uuid IS NULL OR b."id" > ${afterId}::uuid)
          AND ((b."eventDate" + ${shiftTime}) AT TIME ZONE 'Asia/Ho_Chi_Minh') + ${offset} <= ${new Date(input.dueBefore)}
        ORDER BY b."id" LIMIT ${input.limit + 1}
      `);
      const page = rows.slice(0, input.limit);
      return Object.freeze({
        nextCursor:
          rows.length <= input.limit
            ? null
            : Buffer.from(
                JSON.stringify({
                  kind: input.kind,
                  dueBefore: input.dueBefore,
                  bookingId: page.at(-1)!.bookingId,
                }),
              ).toString('base64url'),
        items: Object.freeze(
          page.map((row) => Object.freeze({ ...row, dueAt: row.dueAt.toISOString() })),
        ),
      });
    },
    async completeDue(
      input: Parameters<BookingAutomationPort['completeDue']>[0],
      context: Parameters<BookingAutomationPort['completeDue']>[1],
    ) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await prisma.$transaction(
            async (tx) => {
              await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.bookingId}))`;
              const prior = await tx.bookingAutomationCommand.findUnique({
                where: { commandId: input.commandId },
              });
              if (prior !== null) {
                if (
                  prior.bookingId !== input.bookingId ||
                  prior.expectedRevision !== input.expectedBookingRevision ||
                  prior.requestedAt.toISOString() !== input.now
                )
                  throw conflict('IDEMPOTENCY_KEY_REUSED');
                return { outcome: 'REPLAYED' as const };
              }
              const booking = await tx.booking.findUnique({
                where: { id: input.bookingId },
                include: { proposalSnapshot: true },
              });
              if (booking === null || booking.proposalSnapshot === null)
                throw new BookingLifecycleNotFoundError();
              if (booking.phase === 'CANCELLED' || booking.phase === 'COMPLETED')
                return { outcome: 'SKIPPED_TERMINAL' as const };
              if (booking.phase !== 'CONFIRMED') return { outcome: 'NOT_DUE' as const };
              if (booking.revision !== input.expectedBookingRevision)
                throw conflict('STALE_BOOKING_REVISION');
              const completedAt = now();
              try {
                requireCompletionDue(
                  booking.phase,
                  booking.eventDate.toISOString().slice(0, 10),
                  booking.proposalSnapshot.shiftEndTime.toISOString().slice(11, 16),
                  completedAt,
                );
              } catch (error: unknown) {
                if (
                  error instanceof BookingLifecyclePolicyError &&
                  error.code === 'BOOKING_COMPLETION_NOT_DUE'
                )
                  return { outcome: 'NOT_DUE' as const };
                throw error;
              }
              const updated = await tx.booking.updateMany({
                where: {
                  id: booking.id,
                  revision: input.expectedBookingRevision,
                  phase: 'CONFIRMED',
                },
                data: { phase: 'COMPLETED', completedAt, revision: { increment: 1 } },
              });
              if (updated.count !== 1) throw conflict('STALE_BOOKING_REVISION');
              await tx.bookingAutomationCommand.create({
                data: {
                  commandId: input.commandId,
                  bookingId: input.bookingId,
                  expectedRevision: input.expectedBookingRevision,
                  requestedAt: new Date(input.now),
                  completedAt,
                },
              });
              const payload = {
                bookingId: booking.id,
                bookingRevision: booking.revision + 1,
                completedAt: completedAt.toISOString(),
              };
              await tx.auditLog.create({
                data: {
                  occurredAt: completedAt,
                  requestId: context.requestId,
                  actorType: 'SYSTEM',
                  action: 'booking.completed',
                  entityType: 'booking',
                  entityId: booking.id,
                  metadata: payload,
                },
              });
              await tx.bookingOutboxEvent.create({
                data: {
                  ...bookingEventMetadata(context),
                  id: randomUUID(),
                  eventType: 'booking.completed',
                  aggregateId: booking.id,
                  aggregateRevision: booking.revision + 1,
                  occurredAt: completedAt,
                  payload,
                },
              });
              await recordRetention(
                tx,
                {
                  bookingId: booking.id,
                  consultationId: booking.consultationId,
                  eligibleAfter: completedAt,
                },
                context,
              );
              return { outcome: 'COMPLETED' as const };
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
          );
        } catch (error: unknown) {
          if (
            !(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') ||
            attempt === 2
          )
            throw error;
        }
      }
      throw conflict('STALE_BOOKING_REVISION');
    },
  });
}

function conflict(code: string, status = 409): AppError {
  return new AppError({
    status,
    code,
    message: 'The booking automation command conflicts with its saved intent or state.',
  });
}
