import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import type { BookingDepositRepository } from '../application/deposit.service.js';
import { BookingLifecycleNotFoundError } from './consultation.repository.js';
import {
  appendEvidence,
  decimalNumber,
  readEligibility,
} from './deposit-eligibility.reader.js';
import {
  BookingDepositConflictError,
  type DepositConflictCode,
} from './deposit-repository.errors.js';
import {
  markPromotionSucceededDeposit,
  recordUnknownDeposit,
  releaseVerifiedFailureDeposit,
  settleDeposit,
} from './deposit-settlement.handler.js';

export { BookingDepositConflictError, type DepositConflictCode };

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
            input.reserveForIntendedCouple !== true || input.actorAccountId === null
              ? null
              : await transaction.account.findFirst({
                  where: {
                    id: input.actorAccountId,
                    status: 'ACTIVE',
                    roles: { some: { role: 'MANAGER' } },
                  },
                  select: { id: true },
                });
          if (input.reserveForIntendedCouple === true && manager === null) {
            throw new BookingLifecycleNotFoundError();
          }
          const reservationAccountId =
            input.reserveForIntendedCouple === true ? null : input.actorAccountId;
          const existing = await transaction.bookingDepositIntent.findUnique({
            where: { id: input.paymentAttemptId },
          });
          if (existing !== null) {
            if (
              existing.bookingId !== input.bookingId ||
              existing.timelineRevisionId !== input.timelineRevisionId ||
              existing.contractRevisionId !== (input.contractRevisionId ?? null) ||
              existing.documentDigest !== (input.documentDigest ?? null) ||
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
            select: { id: true, status: true, expiresAt: true },
          });
          if (unresolved !== null) {
            if (unresolved.status === 'ACTIVE' && unresolved.expiresAt.getTime() <= now().getTime()) {
              await transaction.bookingDepositIntent.update({
                where: { id: unresolved.id },
                data: { status: 'RELEASED', releasedAt: now() },
              });
              await transaction.bookingSlotHold.updateMany({
                where: { bookingId: input.bookingId, status: 'ACTIVE' },
                data: { depositIntentPin: 'FAILED' },
              });
            } else {
              throw new BookingDepositConflictError('DEPOSIT_INTENT_ACTIVE');
            }
          }

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
          if (
            (eligibility.contractRevisionId ?? null) !== (input.contractRevisionId ?? null) ||
            (eligibility.documentDigest ?? null) !== (input.documentDigest ?? null)
          )
            throw new BookingDepositConflictError('PAYMENT_EVIDENCE_CONFLICT');
          if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now().getTime()) {
            throw new BookingDepositConflictError('BOOKING_NOT_PAYABLE');
          }
          const bookingRevision = input.expectedBookingRevision + 1;
          await transaction.bookingDepositIntent.create({
            data: {
              id: input.paymentAttemptId,
              bookingId: input.bookingId,
              timelineRevisionId: input.timelineRevisionId,
              contractRevisionId: input.contractRevisionId ?? null,
              documentDigest: input.documentDigest ?? null,
              amountVnd: input.amountVnd,
              status: 'ACTIVE',
              bookingRevisionReserved: bookingRevision,
              coupleAccountId: eligibility.coupleAccountId,
              requestId: input.requestId,
              expiresAt,
              createdAt: now(),
            },
          });
          const existingHold =
            typeof transaction.bookingSlotHold.findFirst === 'function'
              ? await transaction.bookingSlotHold.findFirst({
                  where: { bookingId: input.bookingId, status: 'ACTIVE' },
                })
              : null;
          if (existingHold !== null) {
            if (typeof transaction.bookingSlotHold.update === 'function') {
              await transaction.bookingSlotHold.update({
                where: { id: existingHold.id },
                data: { expiresAt, depositIntentPin: 'ACTIVE' },
              });
            } else {
              await transaction.bookingSlotHold.updateMany({
                where: { bookingId: input.bookingId, status: 'ACTIVE' },
                data: { depositIntentPin: 'ACTIVE' },
              });
            }
          } else if (eligibility.slot && typeof transaction.bookingSlotHold.create === 'function') {
            await transaction.bookingSlotHold.updateMany({
              where: {
                hallId: eligibility.slot.hallId,
                eventDate: eligibility.slot.eventDate,
                shiftCode: eligibility.slot.shiftCode as never,
                status: 'ACTIVE',
                expiresAt: { lte: now() },
                depositIntentPin: { notIn: ['ACTIVE', 'UNKNOWN'] },
              },
              data: { status: 'EXPIRED', terminalAt: now() },
            });
            await transaction.bookingSlotHold.create({
              data: {
                id: createId(),
                bookingId: input.bookingId,
                hallId: eligibility.slot.hallId,
                eventDate: eligibility.slot.eventDate,
                shiftCode: eligibility.slot.shiftCode as never,
                status: 'ACTIVE',
                depositIntentPin: 'ACTIVE',
                expiresAt,
                acquiredByAccountId: reservationAccountId ?? eligibility.coupleAccountId,
                createdAt: now(),
              },
            });
          } else {
            await transaction.bookingSlotHold.updateMany({
              where: { bookingId: input.bookingId, status: 'ACTIVE' },
              data: { depositIntentPin: 'ACTIVE' },
            });
          }
          const updated = await transaction.booking.updateMany({
            where: {
              id: input.bookingId,
              revision: input.expectedBookingRevision,
              phase: { in: ['DRAFT', 'AWAITING_DEPOSIT'] },
            },
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

    recordUnknown(input: Parameters<BookingDepositRepository['recordUnknown']>[0]) {
      return recordUnknownDeposit(prisma, input);
    },

    releaseVerifiedFailure(
      input: Parameters<BookingDepositRepository['releaseVerifiedFailure']>[0],
    ) {
      return releaseVerifiedFailureDeposit(prisma, input, now);
    },

    settle(input: Parameters<BookingDepositRepository['settle']>[0]) {
      return settleDeposit(prisma, input, now, createId);
    },

    markPromotionSucceeded(
      paymentId: Parameters<BookingDepositRepository['markPromotionSucceeded']>[0],
      promotedAt: Parameters<BookingDepositRepository['markPromotionSucceeded']>[1],
    ) {
      return markPromotionSucceededDeposit(prisma, paymentId, promotedAt);
    },
  });
}
