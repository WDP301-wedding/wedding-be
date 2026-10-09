import { z } from 'zod';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { PrismaBookingBoundary } from '../../../core/database/booking-boundary.js';
import { NotFoundError, ValidationError } from '../../../core/errors/app-error.js';
import type { DepositSettlementReader } from '../application/deposit-settlement.reader.js';

export function createPrismaDepositSettlementReader(
  prisma: PrismaClient,
  boundary: PrismaBookingBoundary,
): DepositSettlementReader {
  return {
    async requireDepositSettlement(bookingId) {
      bookingId = z.uuid().parse(bookingId).toLowerCase();
      const row = await (boundary.current(bookingId) ?? prisma).depositSettlement.findUnique({
        where: { bookingId },
      });
      if (row === null) throw new NotFoundError();
      const amountVnd = row.amountVnd.toNumber();
      if (
        !Number.isSafeInteger(amountVnd) ||
        amountVnd <= 0 ||
        !Number.isFinite(row.settledAt.getTime()) ||
        !row.evidenceReference
      )
        throw new ValidationError();
      return { paymentId: row.paymentId, amountVnd, settledAt: new Date(row.settledAt) };
    },
  };
}
