import { randomUUID } from 'node:crypto';

import { AppError } from '../../../core/errors/app-error.js';
import { bookingEventMetadata } from '../../../core/integration-events/booking-event.js';
import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import type { ContractContext } from '../application/deposit.service.js';
import type { BookingPhase } from '../domain/booking-policy.js';
import {
  applyHeadcountEvidence,
  requireCancellationAllowed,
  requireCompletionDue,
  type HeadcountOutcome,
} from '../domain/lifecycle.policy.js';
import { BookingLifecycleNotFoundError } from './consultation.repository.js';

export type BookingLifecycleMutationContext = Readonly<{
  requestId: string;
  actorAccountId: string | null;
  causationId?: string;
}>;

export type BookingTerminalRetentionRecorder = (
  transaction: Prisma.TransactionClient,
  input: Readonly<{ bookingId: string; consultationId: string; eligibleAfter: Date }>,
  context: BookingLifecycleMutationContext,
) => Promise<void>;

export interface BookingPlanningHeadcountSynchronizer {
  synchronizeHeadcount(
    input: Readonly<{
      bookingId: string;
      sourceRsvpRevisionId: string;
      sourceSequence: number;
      expectedAttendees: number;
    }>,
    context: ContractContext | BookingLifecycleMutationContext,
  ): Promise<
    Readonly<{
      bookingRevision: number;
      appliedSourceSequence: number;
      outcome: HeadcountOutcome;
    }>
  >;
}

export interface BookingLifecycleRepository extends BookingPlanningHeadcountSynchronizer {
  getAuthorizationContext(bookingId: string): Promise<
    Readonly<{
      consultationId: string;
      managerAccountId: string;
    }>
  >;
  cancel(
    input: Readonly<{
      bookingId: string;
      expectedBookingRevision: number;
      reason: string;
      context: BookingLifecycleMutationContext;
    }>,
  ): Promise<Readonly<{ phase: 'CANCELLED'; bookingRevision: number }>>;
  requestCancellation(
    input: Readonly<{
      bookingId: string;
      cancellationRequestId: string;
      expectedBookingRevision: number;
      reason: string;
      context: BookingLifecycleMutationContext;
    }>,
  ): Promise<Readonly<{ cancellationRequestId: string; bookingRevision: number }>>;
  decideCancellation(
    input: Readonly<{
      bookingId: string;
      cancellationRequestId: string;
      expectedBookingRevision: number;
      decision: 'APPROVE' | 'REJECT';
      reason: string;
      context: BookingLifecycleMutationContext;
    }>,
  ): Promise<Readonly<{ phase: BookingPhase; bookingRevision: number }>>;
  complete(
    input: Readonly<{
      bookingId: string;
      expectedBookingRevision: number;
      context: BookingLifecycleMutationContext;
    }>,
  ): Promise<Readonly<{ phase: 'COMPLETED'; bookingRevision: number }>>;
}

export class BookingLifecycleStateError extends AppError {
  constructor(
    code: 'STALE_BOOKING_REVISION' | 'DEPOSIT_INTENT_ACTIVE' | 'CANCELLATION_REQUEST_CONFLICT',
  ) {
    super({ status: 409, code, message: lifecycleMessages[code] });
  }
}

const lifecycleMessages = {
  STALE_BOOKING_REVISION: 'The booking changed after it was loaded.',
  DEPOSIT_INTENT_ACTIVE: 'An unresolved deposit attempt blocks this operation.',
  CANCELLATION_REQUEST_CONFLICT: 'The cancellation request conflicts with current state.',
} as const;

export function createPrismaBookingLifecycleRepository(
  prisma: PrismaClient,
  now: () => Date = () => new Date(),
  createId: () => string = randomUUID,
  recordRetention: BookingTerminalRetentionRecorder = () => Promise.resolve(),
): BookingLifecycleRepository {
  return Object.freeze({
    async getAuthorizationContext(bookingId: string) {
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: {
          consultation: { select: { id: true, managerAccountId: true } },
        },
      });
      if (booking === null) throw new BookingLifecycleNotFoundError();
      return Object.freeze({
        consultationId: booking.consultation.id,
        managerAccountId: booking.consultation.managerAccountId,
      });
    },

    cancel(input: Parameters<BookingLifecycleRepository['cancel']>[0]) {
      return prisma.$transaction(
        async (transaction) => {
          const booking = await requireLifecycleBooking(transaction, input.bookingId);
          if (booking.revision !== input.expectedBookingRevision) {
            throw new BookingLifecycleStateError('STALE_BOOKING_REVISION');
          }
          const cancelledAt = now();
          requireCancellationAllowed(
            booking.phase,
            isoDate(booking.eventDate),
            timeText(booking.proposalSnapshot!.shiftStartTime),
            cancelledAt,
          );
          await requireNoDepositIntent(transaction, input.bookingId);
          const bookingRevision = await incrementBooking(
            transaction,
            input.bookingId,
            input.expectedBookingRevision,
            { phase: 'CANCELLED', cancelledAt },
            booking.phase,
          );
          await releaseCancellationHolds(
            transaction,
            createId,
            input,
            bookingRevision,
            cancelledAt,
          );
          await transaction.bookingCancellationRequest.updateMany({
            where: { bookingId: input.bookingId, status: 'PENDING' },
            data: {
              status: 'APPROVED',
              decidedByAccountId: requireActor(input.context),
              decisionReason: normalizedReason(input.reason),
              decidedAt: cancelledAt,
            },
          });
          await appendLifecycleEvidence(transaction, createId, {
            action: 'booking.cancelled',
            eventType: 'booking.cancelled',
            bookingId: input.bookingId,
            bookingRevision,
            requestId: input.context.requestId,
            actorAccountId: input.context.actorAccountId,
            occurredAt: cancelledAt,
            metadata: { reason: normalizedReason(input.reason), reasonCode: 'MANAGER_CANCELLED' },
          });
          await recordRetention(
            transaction,
            {
              bookingId: input.bookingId,
              consultationId: booking.consultationId,
              eligibleAfter: cancelledAt,
            },
            input.context,
          );
          return Object.freeze({ phase: 'CANCELLED' as const, bookingRevision });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    },

    synchronizeHeadcount(
      input: Parameters<BookingLifecycleRepository['synchronizeHeadcount']>[0],
      context: Parameters<BookingLifecycleRepository['synchronizeHeadcount']>[1],
    ) {
      return prisma.$transaction(
        async (transaction) => {
          const booking = await transaction.booking.findUnique({
            where: { id: input.bookingId },
            select: { id: true, revision: true },
          });
          if (booking === null) throw new BookingLifecycleNotFoundError();
          const stored = await transaction.bookingHeadcountEvidence.findUnique({
            where: { bookingId: input.bookingId },
            select: {
              sourceRsvpRevisionId: true,
              sourceSequence: true,
              expectedAttendees: true,
            },
          });
          const result = applyHeadcountEvidence(stored, input);
          if (result.outcome !== 'APPLIED') {
            return Object.freeze({
              bookingRevision: booking.revision,
              appliedSourceSequence: result.evidence.sourceSequence,
              outcome: result.outcome,
            });
          }
          const appliedAt = now();
          await transaction.bookingHeadcountEvidence.upsert({
            where: { bookingId: input.bookingId },
            create: { ...input, appliedAt },
            update: {
              sourceRsvpRevisionId: input.sourceRsvpRevisionId,
              sourceSequence: input.sourceSequence,
              expectedAttendees: input.expectedAttendees,
              appliedAt,
            },
          });
          const updated = await transaction.booking.updateMany({
            where: { id: input.bookingId, revision: booking.revision },
            data: { planningHeadcount: input.expectedAttendees, revision: { increment: 1 } },
          });
          if (updated.count !== 1) throw new BookingLifecycleStateError('STALE_BOOKING_REVISION');
          const bookingRevision = booking.revision + 1;
          await appendLifecycleEvidence(transaction, createId, {
            action: 'booking.expected-headcount-changed',
            eventType: 'booking.expected-headcount-changed',
            bookingId: input.bookingId,
            bookingRevision,
            requestId: context.requestId,
            causationId: context.causationId ?? null,
            actorAccountId: context.actorAccountId,
            occurredAt: appliedAt,
            metadata: {
              sourceRsvpRevisionId: input.sourceRsvpRevisionId,
              sourceSequence: input.sourceSequence,
              expectedAttendees: input.expectedAttendees,
            },
          });
          return Object.freeze({
            bookingRevision,
            appliedSourceSequence: input.sourceSequence,
            outcome: 'APPLIED' as const,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    },

    requestCancellation(input: Parameters<BookingLifecycleRepository['requestCancellation']>[0]) {
      return prisma.$transaction(async (transaction) => {
        const booking = await requireLifecycleBooking(transaction, input.bookingId);
        if (booking.revision !== input.expectedBookingRevision) {
          throw new BookingLifecycleStateError('STALE_BOOKING_REVISION');
        }
        requireCancellationAllowed(
          booking.phase,
          isoDate(booking.eventDate),
          timeText(booking.proposalSnapshot!.shiftStartTime),
          now(),
        );
        await transaction.bookingCancellationRequest.create({
          data: {
            id: input.cancellationRequestId,
            bookingId: input.bookingId,
            status: 'PENDING',
            reason: normalizedReason(input.reason),
            requestedByAccountId: requireActor(input.context),
            requestedAt: now(),
          },
        });
        const bookingRevision = await incrementBooking(
          transaction,
          input.bookingId,
          input.expectedBookingRevision,
          {},
        );
        await appendLifecycleEvidence(transaction, createId, {
          action: 'booking.cancellation-requested',
          eventType: 'booking.cancellation-requested',
          bookingId: input.bookingId,
          bookingRevision,
          requestId: input.context.requestId,
          actorAccountId: input.context.actorAccountId,
          occurredAt: now(),
          metadata: {
            cancellationRequestId: input.cancellationRequestId,
            reason: normalizedReason(input.reason),
          },
        });
        return Object.freeze({
          cancellationRequestId: input.cancellationRequestId,
          bookingRevision,
        });
      });
    },

    decideCancellation(input: Parameters<BookingLifecycleRepository['decideCancellation']>[0]) {
      return prisma.$transaction(
        async (transaction) => {
          const booking = await requireLifecycleBooking(transaction, input.bookingId);
          if (booking.revision !== input.expectedBookingRevision) {
            throw new BookingLifecycleStateError('STALE_BOOKING_REVISION');
          }
          const request = await transaction.bookingCancellationRequest.findUnique({
            where: { id: input.cancellationRequestId },
          });
          if (
            request === null ||
            request.bookingId !== input.bookingId ||
            request.status !== 'PENDING'
          ) {
            throw new BookingLifecycleStateError('CANCELLATION_REQUEST_CONFLICT');
          }
          const decidedAt = now();
          if (input.decision === 'APPROVE') {
            requireCancellationAllowed(
              booking.phase,
              isoDate(booking.eventDate),
              timeText(booking.proposalSnapshot!.shiftStartTime),
              decidedAt,
            );
            await requireNoDepositIntent(transaction, input.bookingId);
          }
          const decided = await transaction.bookingCancellationRequest.updateMany({
            where: { id: request.id, status: 'PENDING' },
            data: {
              status: input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
              decidedByAccountId: requireActor(input.context),
              decisionReason: normalizedReason(input.reason),
              decidedAt,
            },
          });
          if (decided.count !== 1)
            throw new BookingLifecycleStateError('CANCELLATION_REQUEST_CONFLICT');
          const phase = input.decision === 'APPROVE' ? ('CANCELLED' as const) : booking.phase;
          const bookingRevision = await incrementBooking(
            transaction,
            input.bookingId,
            input.expectedBookingRevision,
            input.decision === 'APPROVE' ? { phase: 'CANCELLED', cancelledAt: decidedAt } : {},
            input.decision === 'APPROVE' ? booking.phase : undefined,
          );
          if (input.decision === 'APPROVE') {
            await releaseCancellationHolds(
              transaction,
              createId,
              input,
              bookingRevision,
              decidedAt,
            );
          }
          await appendLifecycleEvidence(transaction, createId, {
            action:
              input.decision === 'APPROVE' ? 'booking.cancelled' : 'booking.cancellation-rejected',
            eventType:
              input.decision === 'APPROVE' ? 'booking.cancelled' : 'booking.cancellation-rejected',
            bookingId: input.bookingId,
            bookingRevision,
            requestId: input.context.requestId,
            actorAccountId: input.context.actorAccountId,
            occurredAt: decidedAt,
            metadata: {
              cancellationRequestId: request.id,
              reason: normalizedReason(input.reason),
              reasonCode:
                input.decision === 'APPROVE'
                  ? 'COUPLE_REQUEST_APPROVED'
                  : 'COUPLE_REQUEST_REJECTED',
            },
          });
          if (input.decision === 'APPROVE') {
            await recordRetention(
              transaction,
              {
                bookingId: input.bookingId,
                consultationId: booking.consultationId,
                eligibleAfter: decidedAt,
              },
              input.context,
            );
          }
          return Object.freeze({ phase, bookingRevision });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    },

    complete(input: Parameters<BookingLifecycleRepository['complete']>[0]) {
      return prisma.$transaction(
        async (transaction) => {
          const booking = await requireLifecycleBooking(transaction, input.bookingId);
          if (booking.revision !== input.expectedBookingRevision) {
            throw new BookingLifecycleStateError('STALE_BOOKING_REVISION');
          }
          const completedAt = now();
          requireCompletionDue(
            booking.phase,
            isoDate(booking.eventDate),
            timeText(booking.proposalSnapshot!.shiftEndTime),
            completedAt,
          );
          const bookingRevision = await incrementBooking(
            transaction,
            input.bookingId,
            input.expectedBookingRevision,
            { phase: 'COMPLETED', completedAt },
            'CONFIRMED',
          );
          await appendLifecycleEvidence(transaction, createId, {
            action: 'booking.completed',
            eventType: 'booking.completed',
            bookingId: input.bookingId,
            bookingRevision,
            requestId: input.context.requestId,
            actorAccountId: input.context.actorAccountId,
            occurredAt: completedAt,
            metadata: {},
          });
          await recordRetention(
            transaction,
            {
              bookingId: input.bookingId,
              consultationId: booking.consultationId,
              eligibleAfter: completedAt,
            },
            input.context,
          );
          return Object.freeze({ phase: 'COMPLETED' as const, bookingRevision });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    },
  });
}

async function requireLifecycleBooking(transaction: Prisma.TransactionClient, bookingId: string) {
  const booking = await transaction.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      consultationId: true,
      revision: true,
      phase: true,
      eventDate: true,
      proposalSnapshot: { select: { shiftStartTime: true, shiftEndTime: true } },
    },
  });
  if (booking === null || booking.proposalSnapshot === null) {
    throw new BookingLifecycleNotFoundError();
  }
  return booking;
}

async function requireNoDepositIntent(
  transaction: Prisma.TransactionClient,
  bookingId: string,
): Promise<void> {
  const unresolved = await transaction.bookingDepositIntent.findFirst({
    where: { bookingId, status: { in: ['ACTIVE', 'UNKNOWN'] } },
    select: { id: true },
  });
  if (unresolved !== null) throw new BookingLifecycleStateError('DEPOSIT_INTENT_ACTIVE');
}

async function releaseCancellationHolds(
  transaction: Prisma.TransactionClient,
  createId: () => string,
  input: Readonly<{ bookingId: string; context: BookingLifecycleMutationContext }>,
  bookingRevision: number,
  releasedAt: Date,
): Promise<void> {
  const holds = await transaction.bookingSlotHold.findMany({
    where: {
      bookingId: input.bookingId,
      status: 'ACTIVE',
      depositIntentPin: { notIn: ['ACTIVE', 'UNKNOWN'] },
    },
    select: { id: true },
  });
  for (const hold of holds) {
    const released = await transaction.bookingSlotHold.updateMany({
      where: {
        id: hold.id,
        status: 'ACTIVE',
        depositIntentPin: { notIn: ['ACTIVE', 'UNKNOWN'] },
      },
      data: { status: 'RELEASED', terminalAt: releasedAt },
    });
    if (released.count !== 1) throw new BookingLifecycleStateError('STALE_BOOKING_REVISION');
    await appendLifecycleEvidence(transaction, createId, {
      action: 'booking.slot-released',
      eventType: 'booking.slot-released',
      bookingId: input.bookingId,
      bookingRevision,
      requestId: input.context.requestId,
      causationId: input.context.causationId ?? null,
      actorAccountId: input.context.actorAccountId,
      occurredAt: releasedAt,
      metadata: {
        holdId: hold.id,
        releasedAt: releasedAt.toISOString(),
        reasonCode: 'BOOKING_CANCELLED',
      },
    });
  }
}

async function incrementBooking(
  transaction: Prisma.TransactionClient,
  bookingId: string,
  expectedRevision: number,
  data: Readonly<{
    phase?: 'CANCELLED' | 'COMPLETED';
    cancelledAt?: Date;
    completedAt?: Date;
  }>,
  phase?: BookingPhase,
): Promise<number> {
  const updated = await transaction.booking.updateMany({
    where: { id: bookingId, revision: expectedRevision, ...(phase === undefined ? {} : { phase }) },
    data: { ...data, revision: { increment: 1 } },
  });
  if (updated.count !== 1) throw new BookingLifecycleStateError('STALE_BOOKING_REVISION');
  return expectedRevision + 1;
}

async function appendLifecycleEvidence(
  transaction: Prisma.TransactionClient,
  createId: () => string,
  input: Readonly<{
    action: string;
    eventType: string;
    bookingId: string;
    bookingRevision: number;
    requestId: string;
    causationId?: string | null;
    actorAccountId: string | null;
    occurredAt: Date;
    metadata: Readonly<Record<string, string | number>>;
  }>,
): Promise<void> {
  const payload = {
    bookingId: input.bookingId,
    bookingRevision: input.bookingRevision,
    ...input.metadata,
  };
  await transaction.auditLog.create({
    data: {
      occurredAt: input.occurredAt,
      requestId: input.requestId,
      actorType: input.actorAccountId === null ? 'SYSTEM' : 'USER',
      actorId: input.actorAccountId,
      action: input.action,
      entityType: 'booking',
      entityId: input.bookingId,
      metadata: payload,
    },
  });
  await transaction.bookingOutboxEvent.create({
    data: {
      ...bookingEventMetadata(input),
      id: createId(),
      eventType: input.eventType,
      aggregateId: input.bookingId,
      aggregateRevision: input.bookingRevision,
      occurredAt: input.occurredAt,
      payload: {
        bookingId: input.bookingId,
        bookingRevision: input.bookingRevision,
        ...Object.fromEntries(Object.entries(input.metadata).filter(([key]) => key !== 'reason')),
        ...(input.eventType === 'booking.cancelled'
          ? { cancelledAt: input.occurredAt.toISOString() }
          : {}),
        ...(input.eventType === 'booking.completed'
          ? { completedAt: input.occurredAt.toISOString() }
          : {}),
        ...(input.eventType === 'booking.expected-headcount-changed'
          ? {
              planningHeadcount: input.metadata.expectedAttendees,
              changedAt: input.occurredAt.toISOString(),
            }
          : {}),
      },
    },
  });
}

function requireActor(context: BookingLifecycleMutationContext): string {
  if (context.actorAccountId === null)
    throw new RangeError('This command requires an account actor.');
  return context.actorAccountId;
}

function normalizedReason(value: string): string {
  const reason = value.trim().normalize('NFC');
  if (reason.length < 1 || reason.length > 500) {
    throw new RangeError('The reason must contain 1 through 500 characters.');
  }
  return reason;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function timeText(value: Date): string {
  return value.toISOString().slice(11, 16);
}
