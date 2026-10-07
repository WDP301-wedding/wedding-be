import { createHash, randomUUID } from 'node:crypto';

import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import type { TimelineContext, TimelineRepository } from '../application/timeline.service.js';
import { TimelineConflictError } from '../application/timeline.service.js';
import type { TimelineParty, TimelineRevision } from '../domain/timeline.policy.js';
import { BookingLifecycleNotFoundError } from './consultation.repository.js';

export function createPrismaTimelineRepository(
  prisma: PrismaClient,
  createId: () => string = randomUUID,
): TimelineRepository {
  return Object.freeze({
    async getContext(bookingId: string): Promise<TimelineContext> {
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: {
          id: true,
          revision: true,
          phase: true,
          consultation: { select: { id: true, managerAccountId: true } },
          proposalSnapshot: { select: { shiftStartTime: true, shiftEndTime: true } },
          currentTimelineRevision: {
            include: { items: { orderBy: { displayOrder: 'asc' } } },
          },
        },
      });
      if (booking === null || booking.proposalSnapshot === null) {
        throw new BookingLifecycleNotFoundError();
      }
      return immutable({
        consultationId: booking.consultation.id,
        managerAccountId: booking.consultation.managerAccountId,
        bookingRevision: booking.revision,
        phase: booking.phase,
        shift: {
          startTime: timeText(booking.proposalSnapshot.shiftStartTime),
          endTime: timeText(booking.proposalSnapshot.shiftEndTime),
        },
        currentRevision:
          booking.currentTimelineRevision === null
            ? null
            : toTimelineRevision(booking.currentTimelineRevision),
      });
    },

    save(input: Parameters<TimelineRepository['save']>[0]) {
      return prisma.$transaction(
        async (transaction) => {
          const booking = await requireBookingState(
            transaction,
            input.revision.bookingId,
            input.expectedBookingRevision,
          );
          if (booking.currentTimelineRevisionId !== input.revision.predecessorRevisionId) {
            throw new TimelineConflictError('TIMELINE_REVISION_SUPERSEDED');
          }
          if (input.revision.predecessorRevisionId !== null) {
            const superseded = await transaction.bookingTimelineRevision.updateMany({
              where: {
                id: input.revision.predecessorRevisionId,
                bookingId: input.revision.bookingId,
                state: 'CURRENT',
              },
              data: { state: 'SUPERSEDED' },
            });
            if (superseded.count !== 1) {
              throw new TimelineConflictError('TIMELINE_REVISION_SUPERSEDED');
            }
          }
          await transaction.bookingTimelineRevision.create({
            data: {
              id: input.revision.revisionId,
              bookingId: input.revision.bookingId,
              revisionNumber: input.revision.revisionNumber,
              predecessorRevisionId: input.revision.predecessorRevisionId,
              state: 'CURRENT',
              managerApprovedAt: null,
              coupleApprovedAt: null,
              contentHash: contentHash(input.revision),
              createdByAccountId: input.actorAccountId,
              createdAt: input.revision.createdAt,
              items: {
                create: input.revision.items.map((item) => ({
                  id: createId(),
                  itemId: item.itemId,
                  displayOrder: item.order,
                  startTime: localTime(item.startTime),
                  title: item.title,
                  description: item.description,
                })),
              },
            },
          });
          const bookingRevision = await advanceBooking(
            transaction,
            input.revision.bookingId,
            input.expectedBookingRevision,
            { currentTimelineRevisionId: input.revision.revisionId },
          );
          await appendEvidence(transaction, createId, {
            action: 'booking.timeline-revised',
            eventType: 'booking.timeline-review-requested',
            bookingId: input.revision.bookingId,
            bookingRevision,
            timelineRevisionId: input.revision.revisionId,
            actorAccountId: input.actorAccountId,
            requestId: input.requestId,
            occurredAt: input.revision.createdAt,
            party: input.party,
          });
          return immutable({
            changed: true as const,
            revision: input.revision,
            bookingRevision,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    },

    approve(input: Parameters<TimelineRepository['approve']>[0]) {
      return persistDecision(prisma, createId, input, 'APPROVED');
    },

    withdraw(input: Parameters<TimelineRepository['withdraw']>[0]) {
      return persistDecision(prisma, createId, input, 'WITHDRAWN');
    },
  });
}

type DecisionInput =
  Parameters<TimelineRepository['approve']>[0] | Parameters<TimelineRepository['withdraw']>[0];

async function persistDecision(
  prisma: PrismaClient,
  createId: () => string,
  input: DecisionInput,
  decision: 'APPROVED' | 'WITHDRAWN',
): Promise<Readonly<{ revision: TimelineRevision; bookingRevision: number }>> {
  return prisma.$transaction(
    async (transaction) => {
      const booking = await requireBookingState(
        transaction,
        input.bookingId,
        input.expectedBookingRevision,
      );
      if (booking.currentTimelineRevisionId !== input.timelineRevisionId) {
        throw new TimelineConflictError('TIMELINE_REVISION_SUPERSEDED');
      }
      const nextRevision =
        decision === 'APPROVED'
          ? (input as Parameters<TimelineRepository['approve']>[0]).approvedRevision
          : (input as Parameters<TimelineRepository['withdraw']>[0]).withdrawnRevision;
      const updated = await transaction.bookingTimelineRevision.updateMany({
        where: { id: input.timelineRevisionId, bookingId: input.bookingId, state: 'CURRENT' },
        data: {
          managerApprovedAt: nextRevision.managerApprovedAt,
          coupleApprovedAt: nextRevision.coupleApprovedAt,
        },
      });
      if (updated.count !== 1) throw new TimelineConflictError('TIMELINE_REVISION_SUPERSEDED');
      const sequence =
        (await transaction.bookingTimelineDecision.count({
          where: { timelineRevisionId: input.timelineRevisionId, party: input.party },
        })) + 1;
      const occurredAt = input.decisionAt;
      await transaction.bookingTimelineDecision.create({
        data: {
          id: createId(),
          timelineRevisionId: input.timelineRevisionId,
          party: input.party,
          decision,
          sequence,
          reason:
            decision === 'WITHDRAWN'
              ? (input as Parameters<TimelineRepository['withdraw']>[0]).reason
              : null,
          actorAccountId: input.actorAccountId,
          requestId: input.requestId,
          occurredAt,
        },
      });
      const bookingRevision = await advanceBooking(
        transaction,
        input.bookingId,
        input.expectedBookingRevision,
        {},
      );
      await appendEvidence(transaction, createId, {
        action:
          decision === 'APPROVED'
            ? 'booking.timeline-approved'
            : 'booking.timeline-approval-withdrawn',
        eventType:
          decision === 'APPROVED'
            ? 'booking.timeline-approved'
            : 'booking.timeline-approval-withdrawn',
        bookingId: input.bookingId,
        bookingRevision,
        timelineRevisionId: input.timelineRevisionId,
        actorAccountId: input.actorAccountId,
        requestId: input.requestId,
        occurredAt,
        party: input.party,
      });
      return immutable({ revision: nextRevision, bookingRevision });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

async function requireBookingState(
  transaction: Prisma.TransactionClient,
  bookingId: string,
  expectedRevision: number,
) {
  const booking = await transaction.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, revision: true, currentTimelineRevisionId: true },
  });
  if (booking === null) throw new BookingLifecycleNotFoundError();
  if (booking.revision !== expectedRevision) {
    throw new TimelineConflictError('STALE_BOOKING_REVISION');
  }
  return booking;
}

async function advanceBooking(
  transaction: Prisma.TransactionClient,
  bookingId: string,
  expectedRevision: number,
  data: Readonly<{ currentTimelineRevisionId?: string }>,
): Promise<number> {
  const updated = await transaction.booking.updateMany({
    where: { id: bookingId, revision: expectedRevision },
    data: { ...data, revision: { increment: 1 } },
  });
  if (updated.count !== 1) throw new TimelineConflictError('STALE_BOOKING_REVISION');
  return expectedRevision + 1;
}

async function appendEvidence(
  transaction: Prisma.TransactionClient,
  createId: () => string,
  input: Readonly<{
    action: string;
    eventType: string;
    bookingId: string;
    bookingRevision: number;
    timelineRevisionId: string;
    actorAccountId: string;
    requestId: string;
    occurredAt: Date;
    party: TimelineParty;
  }>,
): Promise<void> {
  await transaction.auditLog.create({
    data: {
      occurredAt: input.occurredAt,
      requestId: input.requestId,
      actorType: 'USER',
      actorId: input.actorAccountId,
      action: input.action,
      entityType: 'booking-timeline-revision',
      entityId: input.timelineRevisionId,
      metadata: {
        bookingId: input.bookingId,
        bookingRevision: input.bookingRevision,
        party: input.party,
      },
    },
  });
  await transaction.bookingOutboxEvent.create({
    data: {
      id: createId(),
      eventType: input.eventType,
      aggregateId: input.bookingId,
      aggregateRevision: input.bookingRevision,
      occurredAt: input.occurredAt,
      payload: {
        bookingId: input.bookingId,
        timelineRevisionId: input.timelineRevisionId,
        bookingRevision: input.bookingRevision,
        party: input.party,
      },
    },
  });
}

type StoredRevision = Readonly<{
  id: string;
  bookingId: string;
  revisionNumber: number;
  predecessorRevisionId: string | null;
  state: 'CURRENT' | 'SUPERSEDED' | 'EFFECTIVE';
  managerApprovedAt: Date | null;
  coupleApprovedAt: Date | null;
  createdAt: Date;
  items: readonly Readonly<{
    itemId: string;
    displayOrder: number;
    startTime: Date;
    title: string;
    description: string | null;
  }>[];
}>;

function toTimelineRevision(stored: StoredRevision): TimelineRevision {
  return immutable({
    revisionId: stored.id,
    bookingId: stored.bookingId,
    revisionNumber: stored.revisionNumber,
    predecessorRevisionId: stored.predecessorRevisionId,
    state: stored.state,
    managerApprovedAt: stored.managerApprovedAt,
    coupleApprovedAt: stored.coupleApprovedAt,
    mutuallyApproved: stored.managerApprovedAt !== null && stored.coupleApprovedAt !== null,
    items: stored.items.map((item) => ({
      itemId: item.itemId,
      order: item.displayOrder,
      startTime: timeText(item.startTime),
      title: item.title,
      description: item.description,
    })),
    createdAt: stored.createdAt,
  });
}

function contentHash(revision: TimelineRevision): string {
  return createHash('sha256').update(JSON.stringify(revision.items), 'utf8').digest('hex');
}

function localTime(value: string): Date {
  return new Date(`1970-01-01T${value}:00.000Z`);
}

function timeText(value: Date): string {
  return value.toISOString().slice(11, 16);
}

function immutable<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
