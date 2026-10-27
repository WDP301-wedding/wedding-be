import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import type { BookingDepositRepository } from '../application/deposit.service.js';
import { BookingLifecycleNotFoundError } from './consultation.repository.js';
import {
  appendEvidence,
  decimalNumber,
  readEligibility,
} from './deposit-eligibility.reader.js';
import { BookingDepositConflictError } from './deposit-repository.errors.js';

export async function recordUnknownDeposit(
  prisma: PrismaClient,
  input: Parameters<BookingDepositRepository['recordUnknown']>[0],
): Promise<void> {
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
}

export async function releaseVerifiedFailureDeposit(
  prisma: PrismaClient,
  input: Parameters<BookingDepositRepository['releaseVerifiedFailure']>[0],
  now: () => Date,
): Promise<void> {
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
}

export function settleDeposit(
  prisma: PrismaClient,
  input: Parameters<BookingDepositRepository['settle']>[0],
  now: () => Date,
  createId: () => string,
) {
  return prisma.$transaction(
    async (transaction) => {
      const existing = await transaction.bookingDepositSettlement.findUnique({
        where: { paymentId: input.paymentId },
      });
      if (existing !== null) {
        if (
          existing.bookingId !== input.bookingId ||
          existing.timelineRevisionId !== input.timelineRevisionId ||
          existing.contractRevisionId !== (input.contractRevisionId ?? null) ||
          existing.documentDigest !== (input.documentDigest ?? null) ||
          decimalNumber(existing.amountVnd) !== input.amountVnd ||
          existing.settledAt.getTime() !== input.settledAt.getTime()
        ) {
          throw new BookingDepositConflictError('PAYMENT_EVIDENCE_CONFLICT');
        }
        const evidence = await transaction.bookingDepositIntent.findFirst({
          where: { bookingId: input.bookingId, timelineRevisionId: input.timelineRevisionId },
          orderBy: { createdAt: 'desc' },
        });
        if (evidence === null) throw new BookingDepositConflictError('PAYMENT_EVIDENCE_CONFLICT');
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
        intent.contractRevisionId !== (input.contractRevisionId ?? null) ||
        intent.documentDigest !== (input.documentDigest ?? null) ||
        decimalNumber(intent.amountVnd) !== input.amountVnd
      ) {
        throw new BookingDepositConflictError('PAYMENT_EVIDENCE_CONFLICT');
      }
      const eligibility = await readEligibility(
        transaction,
        input,
        now(),
        intent.coupleAccountId,
      );
      if (
        !eligibility.eligible ||
        eligibility.depositAmountVnd !== input.amountVnd ||
        (eligibility.contractRevisionId ?? null) !== intent.contractRevisionId ||
        (eligibility.documentDigest ?? null) !== intent.documentDigest
      )
        throw new BookingDepositConflictError('PAYMENT_EVIDENCE_CONFLICT');
      await transaction.bookingDepositSettlement.create({
        data: {
          paymentId: input.paymentId,
          bookingId: input.bookingId,
          timelineRevisionId: input.timelineRevisionId,
          contractRevisionId: input.contractRevisionId ?? null,
          documentDigest: input.documentDigest ?? null,
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
}

export async function markPromotionSucceededDeposit(
  prisma: PrismaClient,
  paymentId: Parameters<BookingDepositRepository['markPromotionSucceeded']>[0],
  promotedAt: Parameters<BookingDepositRepository['markPromotionSucceeded']>[1],
): Promise<void> {
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
}
