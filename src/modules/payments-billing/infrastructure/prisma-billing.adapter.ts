import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { PrismaBookingBoundary } from '../../../core/database/booking-boundary.js';
import { AppError, NotFoundError, ValidationError } from '../../../core/errors/app-error.js';
import type {
  BillingReader,
  BookingChargeRegistrar,
  BookingChargeAdjustmentRegistrar,
} from '../application/billing.contracts.js';

export function createPrismaBillingAdapter(
  prisma: PrismaClient,
  boundary: PrismaBookingBoundary,
): BillingReader & BookingChargeRegistrar & BookingChargeAdjustmentRegistrar {
  return {
    async registerAcceptedCharge(input) {
      const bookingId = z.uuid().parse(input.bookingId).toLowerCase();
      const sourceRevisionId = z.uuid().parse(input.sourceRevisionId).toLowerCase();
      if (!Number.isSafeInteger(input.amountVnd) || input.amountVnd <= 0 || input.amountVnd > 1_000_000_000_000) {
        throw new ValidationError();
      }
      const db = boundary.current(bookingId) ?? prisma;
      const existing = await db.bookingReceivableCharge.findUnique({
        where: {
          bookingId_sourceRevisionId: { bookingId, sourceRevisionId },
        },
      });
      if (existing !== null) {
        if (existing.amountVnd.toNumber() === input.amountVnd) {
          return { receivableChargeId: existing.id, replayed: true };
        }
        throw new AppError({
          status: 409,
          code: 'CHARGE_SOURCE_CONFLICT',
          message: 'Conflicting charge amount for the same source revision.',
        });
      }
      const id = randomUUID();
      await db.bookingReceivableCharge.create({
        data: {
          id,
          bookingId,
          sourceType: input.sourceType,
          sourceRevisionId,
          amountVnd: input.amountVnd,
          acceptedAt: input.acceptedAt,
        },
      });
      return { receivableChargeId: id, replayed: false };
    },

    async registerCredit(input) {
      const bookingId = z.uuid().parse(input.bookingId).toLowerCase();
      const receivableChargeId = z.uuid().parse(input.receivableChargeId).toLowerCase();
      const sourceAdjustmentId = z.uuid().parse(input.sourceAdjustmentId).toLowerCase();
      if (!Number.isSafeInteger(input.amountVnd) || input.amountVnd <= 0) {
        throw new ValidationError();
      }
      const db = boundary.current(bookingId) ?? prisma;
      const existing = await db.bookingChargeCredit.findUnique({
        where: { sourceAdjustmentId },
      });
      if (existing !== null) {
        if (
          existing.bookingId === bookingId &&
          existing.receivableChargeId === receivableChargeId &&
          existing.amountVnd.toNumber() === input.amountVnd &&
          existing.reason === input.reason
        ) {
          return { adjustmentId: existing.id, replayed: true };
        }
        throw new AppError({
          status: 409,
          code: 'CREDIT_SOURCE_CONFLICT',
          message: 'Conflicting credit fields for the same source adjustment.',
        });
      }
      const charge = await db.bookingReceivableCharge.findUnique({
        where: { id: receivableChargeId },
      });
      if (charge === null || charge.bookingId !== bookingId) {
        throw new NotFoundError();
      }
      const existingCredits = await db.bookingChargeCredit.findMany({
        where: { bookingId, receivableChargeId },
      });
      const currentCredited = existingCredits.reduce(
        (sum, item) => sum + item.amountVnd.toNumber(),
        0,
      );
      if (currentCredited + input.amountVnd > charge.amountVnd.toNumber()) {
        throw new AppError({
          status: 409,
          code: 'CHARGE_OVERCREDIT',
          message: 'Total credit cannot exceed accepted charge amount.',
        });
      }
      const id = randomUUID();
      await db.bookingChargeCredit.create({
        data: {
          id,
          bookingId,
          receivableChargeId,
          sourceAdjustmentId,
          amountVnd: input.amountVnd,
          reason: input.reason,
          acceptedAt: new Date(input.acceptedAt),
        },
      });
      return { adjustmentId: id, replayed: false };
    },

    async getBookingReceivables(bookingId) {
      bookingId = z.uuid().parse(bookingId).toLowerCase();
      const db = boundary.current(bookingId) ?? prisma;
      const charges = await db.bookingReceivableCharge.findMany({
        where: { bookingId },
      });
      const grossChargesVnd = charges.reduce(
        (sum, item) => sum + item.amountVnd.toNumber(),
        0,
      );
      const credits = await db.bookingChargeCredit.findMany({
        where: { bookingId },
      });
      const creditsVnd = credits.reduce(
        (sum, item) => sum + item.amountVnd.toNumber(),
        0,
      );
      const acceptedChargesVnd = Math.max(0, grossChargesVnd - creditsVnd);
      const deposit = await db.depositSettlement.findUnique({
        where: { bookingId },
      });
      const paidVnd = deposit ? deposit.amountVnd.toNumber() : 0;
      const refundedVnd = 0;
      const outstandingVnd = Math.max(0, acceptedChargesVnd - paidVnd);
      return {
        acceptedChargesVnd,
        paidVnd,
        refundedVnd,
        outstandingVnd,
      };
    },
  };
}
