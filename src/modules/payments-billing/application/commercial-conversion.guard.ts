import { AppError } from '../../../core/errors/app-error.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';

// Payments owns this compatibility decision; Booking never reads ledger tables.
export function createCommercialConversionGuard(prisma: PrismaClient) {
  return Object.freeze({
    async requireConvertible(bookingId: string) {
      const prior = await prisma.billingLedgerEntry.findFirst({
        where: { bookingId, sourceType: { in: ['BASE_BOOKING', 'PRINT_ORDER', 'CONTRACT'] } },
        select: { id: true },
      });
      const attempt = await prisma.billingPaymentAttempt.findFirst({
        where: {
          bookingId,
          purpose: 'DEPOSIT',
          state: { in: ['CREATED', 'PENDING', 'UNKNOWN', 'SUCCEEDED'] },
        },
        select: { id: true },
      });
      if (prior !== null || attempt !== null)
        throw new AppError({
          status: 409,
          code: 'LEGACY_COMMERCIAL_CONVERSION_BLOCKED',
          message: 'Existing monetary evidence must retain its original commercial model.',
        });
    },
  });
}
