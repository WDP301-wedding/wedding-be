import { randomUUID } from 'node:crypto';

import { AppError } from '../../../core/errors/app-error.js';
import { bookingEventMetadata } from '../../../core/integration-events/booking-event.js';
import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import type {
  BookingDepositRepository,
  DepositEligibility,
} from '../application/deposit.service.js';
import { evaluateDepositEligibility } from '../domain/deposit.policy.js';
import { BookingLifecycleNotFoundError } from './consultation.repository.js';

type DepositConflictCode =
  | 'TIMELINE_NOT_MUTUALLY_APPROVED'
  | 'REVISION_SUPERSEDED'
  | 'SLOT_NOT_AVAILABLE'
  | 'BOOKING_NOT_PAYABLE'
  | 'STALE_BOOKING_REVISION'
  | 'DEPOSIT_INTENT_ACTIVE'
  | 'PAYMENT_EVIDENCE_CONFLICT';

export class BookingDepositConflictError extends AppError {
  constructor(code: DepositConflictCode) {
    super({
      status: 409,
      code,
      message: depositMessages[code],
    });
  }
}

const depositMessages: Readonly<Record<DepositConflictCode, string>> = {
  TIMELINE_NOT_MUTUALLY_APPROVED: 'The current timeline is not mutually approved.',
  REVISION_SUPERSEDED: 'The requested timeline revision is no longer current.',
  SLOT_NOT_AVAILABLE: 'The booking slot is not available.',
  BOOKING_NOT_PAYABLE: 'The booking cannot accept a deposit.',
  STALE_BOOKING_REVISION: 'The booking changed after it was loaded.',
  DEPOSIT_INTENT_ACTIVE: 'An unresolved deposit attempt already pins this booking.',
  PAYMENT_EVIDENCE_CONFLICT: 'The payment evidence conflicts with an existing settlement.',
};

export function createPrismaBookingDepositRepository(
  prisma: PrismaClient,
  now: () => Date = () => new Date(),
  createId: () => string = randomUUID,
): BookingDepositRepository {
  return Object.freeze({
    requireDepositEligibility(
      input: Parameters<BookingDepositRepository['requireDepositEligibility']>[0],
    ) {
      return readEligibility(prisma, input, now());
    },

    reserve(input: Parameters<BookingDepositRepository['reserve']>[0]) {
      return prisma.$transaction(
        async (transaction) => {
          // A Manager records manual evidence for the intended Couple. Keep the
          // authenticated actor for audit while resolving the reservation owner
          // from Booking; other actors must own their consultation access.
          const manager =
            input.actorAccountId === null
              ? null
              : await transaction.account.findFirst({
                  where: {
                    id: input.actorAccountId,
                    status: 'ACTIVE',
                    roles: { some: { role: 'MANAGER' } },
                  },
                  select: { id: true },
                });
          const reservationAccountId = manager === null ? input.actorAccountId : null;
          const existing = await transaction.bookingDepositIntent.findUnique({
            where: { id: input.paymentAttemptId },
          });
          if (existing !== null) {
            if (
              existing.bookingId !== input.bookingId ||
              existing.timelineRevisionId !== input.timelineRevisionId ||
              (reservationAccountId !== null &&
                existing.coupleAccountId !== reservationAccountId) ||
              decimalNumber(existing.amountVnd) !== input.amountVnd ||
              existing.expiresAt.toISOString() !== input.expiresAt
            ) {
              throw new BookingDepositConflictError('PAYMENT_EVIDENCE_CONFLICT');
            }
            return Object.freeze({
              paymentAttemptId: existing.id,
              bookingRevision: existing.bookingRevisionReserved,
              replayed: true,
            });
          }
          const unresolved = await transaction.bookingDepositIntent.findFirst({
            where: { bookingId: input.bookingId, status: { in: ['ACTIVE', 'UNKNOWN'] } },
            select: { id: true },
          });
          if (unresolved !== null) throw new BookingDepositConflictError('DEPOSIT_INTENT_ACTIVE');

          const eligibility = await readEligibility(
            transaction,
            input,
            now(),
            reservationAccountId,
          );
          if (!eligibility.eligible) {
            throw new BookingDepositConflictError(
              eligibility.reasonCode as Exclude<
                DepositConflictCode,
                'STALE_BOOKING_REVISION' | 'DEPOSIT_INTENT_ACTIVE' | 'PAYMENT_EVIDENCE_CONFLICT'
              >,
            );
          }
          if (eligibility.bookingRevision !== input.expectedBookingRevision) {
            throw new BookingDepositConflictError('STALE_BOOKING_REVISION');
          }
          if (eligibility.depositAmountVnd !== input.amountVnd) {
            throw new BookingDepositConflictError('PAYMENT_EVIDENCE_CONFLICT');
          }
          const expiresAt = new Date(input.expiresAt);
          if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now().getTime()) {
            throw new BookingDepositConflictError('BOOKING_NOT_PAYABLE');
          }
          const bookingRevision = input.expectedBookingRevision + 1;
          await transaction.bookingDepositIntent.create({
            data: {
              id: input.paymentAttemptId,
              bookingId: input.bookingId,
              timelineRevisionId: input.timelineRevisionId,
              amountVnd: input.amountVnd,
              status: 'ACTIVE',
              bookingRevisionReserved: bookingRevision,
              coupleAccountId: eligibility.coupleAccountId,
              requestId: input.requestId,
              expiresAt,
              createdAt: now(),
            },
          });
          await transaction.bookingSlotHold.updateMany({
            where: { bookingId: input.bookingId, status: 'ACTIVE' },
            data: { depositIntentPin: 'ACTIVE' },
          });
          const updated = await transaction.booking.updateMany({
            where: { id: input.bookingId, revision: input.expectedBookingRevision, phase: 'DRAFT' },
            data: { phase: 'AWAITING_DEPOSIT', revision: { increment: 1 } },
          });
          if (updated.count !== 1) throw new BookingDepositConflictError('STALE_BOOKING_REVISION');
          await appendEvidence(transaction, createId, {
            action: 'booking.deposit-intent-reserved',
            eventType: 'booking.deposit-eligible',
            bookingId: input.bookingId,
            bookingRevision,
            timelineRevisionId: input.timelineRevisionId,
            requestId: input.requestId,
            causationId: input.causationId ?? null,
            actorAccountId: input.actorAccountId,
            occurredAt: now(),
          });
          return Object.freeze({
            paymentAttemptId: input.paymentAttemptId,
            bookingRevision,
            replayed: false,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    },

    async recordUnknown(input: Parameters<BookingDepositRepository['recordUnknown']>[0]) {
      await prisma.$transaction(async (transaction) => {
        const updated = await transaction.bookingDepositIntent.updateMany({
          where: { id: input.paymentAttemptId, bookingId: input.bookingId, status: 'ACTIVE' },
          data: { status: 'UNKNOWN' },
        });
        if (updated.count !== 1) {
          const current = await transaction.bookingDepositIntent.findUnique({
            where: { id: input.paymentAttemptId },
          });
          if (current?.bookingId !== input.bookingId || current.status !== 'UNKNOWN') {
            throw new BookingDepositConflictError('PAYMENT_EVIDENCE_CONFLICT');
          }
        }
        await transaction.bookingSlotHold.updateMany({
          where: { bookingId: input.bookingId, status: 'ACTIVE' },
          data: { depositIntentPin: 'UNKNOWN' },
        });
      });
    },

    async releaseVerifiedFailure(
      input: Parameters<BookingDepositRepository['releaseVerifiedFailure']>[0],
    ) {
      await prisma.$transaction(async (transaction) => {
        const intent = await transaction.bookingDepositIntent.findUnique({
          where: { id: input.paymentAttemptId },
        });
        if (intent === null || intent.bookingId !== input.bookingId) {
          throw new BookingDepositConflictError('PAYMENT_EVIDENCE_CONFLICT');
        }
        if (intent.status === 'RELEASED') {
          if (intent.providerEvidenceId !== input.providerEvidenceId) {
            throw new BookingDepositConflictError('PAYMENT_EVIDENCE_CONFLICT');
          }
          return;
        }
        if (intent.status !== 'ACTIVE' && intent.status !== 'UNKNOWN') {
          throw new BookingDepositConflictError('PAYMENT_EVIDENCE_CONFLICT');
        }
        const releasedAt = now();
        await transaction.bookingDepositIntent.update({
          where: { id: input.paymentAttemptId },
          data: {
            status: 'RELEASED',
            providerEvidenceId: input.providerEvidenceId,
            releasedAt,
          },
        });
        await transaction.bookingSlotHold.updateMany({
          where: { bookingId: input.bookingId, status: 'ACTIVE' },
          data: { depositIntentPin: 'FAILED' },
        });
        await transaction.booking.updateMany({
          where: { id: input.bookingId, phase: 'AWAITING_DEPOSIT' },
          data: { phase: 'DRAFT', revision: { increment: 1 } },
        });
      });
    },

    settle(input: Parameters<BookingDepositRepository['settle']>[0]) {
      return prisma.$transaction(
        async (transaction) => {
          const existing = await transaction.bookingDepositSettlement.findUnique({
            where: { paymentId: input.paymentId },
          });
          if (existing !== null) {
            if (
              existing.bookingId !== input.bookingId ||
              existing.timelineRevisionId !== input.timelineRevisionId ||
              decimalNumber(existing.amountVnd) !== input.amountVnd ||
              existing.settledAt.getTime() !== input.settledAt.getTime()
            ) {
              throw new BookingDepositConflictError('PAYMENT_EVIDENCE_CONFLICT');
            }
            const evidence = await transaction.bookingDepositIntent.findFirst({
              where: { bookingId: input.bookingId, timelineRevisionId: input.timelineRevisionId },
              orderBy: { createdAt: 'desc' },
            });
            if (evidence === null)
              throw new BookingDepositConflictError('PAYMENT_EVIDENCE_CONFLICT');
            const booking = await transaction.booking.findUnique({
              where: { id: input.bookingId },
              select: { consultationId: true },
            });
            if (booking === null) throw new BookingLifecycleNotFoundError();
            return Object.freeze({
              phase: 'CONFIRMED' as const,
              replayed: true,
              promotionPending: existing.promotionStatus === 'PENDING',
              accountId: evidence.coupleAccountId,
              consultationId: booking.consultationId,
              requestId: evidence.requestId,
            });
          }

          const booking = await transaction.booking.findUnique({
            where: { id: input.bookingId },
            select: {
              consultationId: true,
              phase: true,
              revision: true,
              currentTimelineRevisionId: true,
            },
          });
          if (booking === null) throw new BookingLifecycleNotFoundError();
          const intent = await transaction.bookingDepositIntent.findFirst({
            where: { bookingId: input.bookingId, status: { in: ['ACTIVE', 'UNKNOWN'] } },
            orderBy: { createdAt: 'desc' },
          });
          if (
            intent === null ||
            booking.phase !== 'AWAITING_DEPOSIT' ||
            booking.currentTimelineRevisionId !== input.timelineRevisionId ||
            intent.timelineRevisionId !== input.timelineRevisionId ||
            decimalNumber(intent.amountVnd) !== input.amountVnd
          ) {
            throw new BookingDepositConflictError('PAYMENT_EVIDENCE_CONFLICT');
          }
          await transaction.bookingDepositSettlement.create({
            data: {
              paymentId: input.paymentId,
              bookingId: input.bookingId,
              timelineRevisionId: input.timelineRevisionId,
              amountVnd: input.amountVnd,
              settledAt: input.settledAt,
              promotionStatus: 'PENDING',
            },
          });
          await transaction.bookingDepositIntent.updateMany({
            where: { id: intent.id, status: { in: ['ACTIVE', 'UNKNOWN'] } },
            data: { status: 'SETTLED', settledAt: input.settledAt },
          });
          await transaction.bookingSlotHold.updateMany({
            where: { bookingId: input.bookingId, status: 'ACTIVE' },
            data: { status: 'CONSUMED', depositIntentPin: 'SETTLED', terminalAt: input.settledAt },
          });
          await transaction.bookingTimelineRevision.updateMany({
            where: { id: input.timelineRevisionId, bookingId: input.bookingId, state: 'CURRENT' },
            data: { state: 'EFFECTIVE' },
          });
          const updated = await transaction.booking.updateMany({
            where: { id: input.bookingId, revision: booking.revision, phase: 'AWAITING_DEPOSIT' },
            data: {
              phase: 'CONFIRMED',
              effectiveTimelineRevisionId: input.timelineRevisionId,
              revision: { increment: 1 },
            },
          });
          if (updated.count !== 1) throw new BookingDepositConflictError('STALE_BOOKING_REVISION');
          await appendEvidence(transaction, createId, {
            action: 'booking.deposit-recorded',
            eventType: 'booking.deposit-recorded',
            bookingId: input.bookingId,
            bookingRevision: booking.revision + 1,
            timelineRevisionId: input.timelineRevisionId,
            requestId: intent.requestId,
            actorAccountId: intent.coupleAccountId,
            occurredAt: input.settledAt,
          });
          return Object.freeze({
            phase: 'CONFIRMED' as const,
            replayed: false,
            promotionPending: true,
            accountId: intent.coupleAccountId,
            consultationId: booking.consultationId,
            requestId: intent.requestId,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    },

    async markPromotionSucceeded(
      paymentId: Parameters<BookingDepositRepository['markPromotionSucceeded']>[0],
      promotedAt: Parameters<BookingDepositRepository['markPromotionSucceeded']>[1],
    ) {
      const updated = await prisma.bookingDepositSettlement.updateMany({
        where: { paymentId, promotionStatus: 'PENDING' },
        data: { promotionStatus: 'SUCCEEDED', promotedAt },
      });
      if (updated.count === 0) {
        const current = await prisma.bookingDepositSettlement.findUnique({
          where: { paymentId },
          select: { promotionStatus: true },
        });
        if (current?.promotionStatus !== 'SUCCEEDED') {
          throw new BookingDepositConflictError('PAYMENT_EVIDENCE_CONFLICT');
        }
      }
    },
  });
}

type EligibilityClient = Pick<
  PrismaClient | Prisma.TransactionClient,
  'booking' | 'consultationAccess'
>;

async function readEligibility(
  client: EligibilityClient,
  input: Readonly<{ bookingId: string; timelineRevisionId: string }>,
  databaseNow: Date,
  actorAccountId: string | null = null,
): Promise<DepositEligibility> {
  const booking = await client.booking.findUnique({
    where: { id: input.bookingId },
    select: {
      consultationId: true,
      consultation: { select: { intendedEmailNormalized: true } },
      phase: true,
      revision: true,
      currentTimelineRevisionId: true,
      currentTimelineRevision: {
        select: { id: true, managerApprovedAt: true, coupleApprovedAt: true },
      },
      proposalSnapshot: { select: { depositAmountVnd: true } },
      slotHolds: {
        where: { status: 'ACTIVE' },
        select: { expiresAt: true, depositIntentPin: true },
        take: 1,
      },
    },
  });
  if (booking === null || booking.proposalSnapshot === null) {
    throw new BookingLifecycleNotFoundError();
  }
  const access = await client.consultationAccess.findFirst({
    where: {
      consultationId: booking.consultationId,
      ...(actorAccountId === null
        ? {
            account: {
              emailNormalized: booking.consultation.intendedEmailNormalized,
              status: 'ACTIVE',
            },
          }
        : { accountId: actorAccountId, account: { status: 'ACTIVE' } }),
    },
    select: { accountId: true },
  });
  if (access === null) throw new BookingLifecycleNotFoundError();
  const hold = booking.slotHolds[0];
  const hasActiveSlotHold =
    hold !== undefined &&
    (hold.expiresAt.getTime() > databaseNow.getTime() ||
      hold.depositIntentPin === 'ACTIVE' ||
      hold.depositIntentPin === 'UNKNOWN');
  const reasonCode = evaluateDepositEligibility({
    bookingPhase: booking.phase,
    requestedTimelineRevisionId: input.timelineRevisionId,
    currentTimelineRevisionId: booking.currentTimelineRevisionId,
    managerApproved: booking.currentTimelineRevision?.managerApprovedAt != null,
    coupleApproved: booking.currentTimelineRevision?.coupleApprovedAt != null,
    hasActiveSlotHold,
  });
  return Object.freeze({
    eligible: reasonCode === 'ELIGIBLE',
    reasonCode,
    consultationId: booking.consultationId,
    coupleAccountId: access.accountId,
    bookingRevision: booking.revision,
    depositAmountVnd: decimalNumber(booking.proposalSnapshot.depositAmountVnd),
  });
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
    requestId: string;
    causationId?: string | null;
    actorAccountId: string | null;
    occurredAt: Date;
  }>,
): Promise<void> {
  await transaction.auditLog.create({
    data: {
      occurredAt: input.occurredAt,
      requestId: input.requestId,
      actorType: input.actorAccountId === null ? 'SYSTEM' : 'USER',
      actorId: input.actorAccountId,
      action: input.action,
      entityType: 'booking',
      entityId: input.bookingId,
      metadata: {
        bookingRevision: input.bookingRevision,
        timelineRevisionId: input.timelineRevisionId,
      },
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
        timelineRevisionId: input.timelineRevisionId,
        bookingRevision: input.bookingRevision,
        ...(input.eventType === 'booking.deposit-eligible'
          ? { eligibleAt: input.occurredAt.toISOString() }
          : {}),
      },
    },
  });
}

function decimalNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value !== null && 'toNumber' in value) {
    return (value as Readonly<{ toNumber(): number }>).toNumber();
  }
  return Number(value);
}
