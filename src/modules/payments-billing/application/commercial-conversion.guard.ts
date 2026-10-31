import { AppError } from '../../../core/errors/app-error.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { SelectionFinancialBlockReason } from '../../booking-lifecycle/domain/selection-access.js';

// Payments owns this compatibility decision; Booking never reads ledger tables.
export function createCommercialConversionGuard(prisma: PrismaClient) {
  return Object.freeze({
    async selectionBlockReason(
      bookingId: string,
      model: 'LEGACY_PROPOSAL_V1' | 'FULL_CONTRACT_V1',
    ): Promise<SelectionFinancialBlockReason | null> {
      const [prior, attempts] = await Promise.all([
        prisma.billingLedgerEntry.findFirst({
          where: { bookingId, sourceType: { in: ['BASE_BOOKING', 'PRINT_ORDER', 'CONTRACT'] } },
          select: { id: true },
        }),
        prisma.billingPaymentAttempt.groupBy({
          by: ['state'],
          where: {
            bookingId,
            purpose: 'DEPOSIT',
            state: { in: ['CREATED', 'PENDING', 'UNKNOWN', 'SUCCEEDED'] },
          },
        }),
      ]);
      if (model === 'LEGACY_PROPOSAL_V1' && (prior !== null || attempts.length > 0))
        return 'LEGACY_COMMERCIAL_CONVERSION_BLOCKED';
      if (attempts.some((attempt) => attempt.state === 'SUCCEEDED')) return 'DEPOSIT_SETTLED';
      if (attempts.some((attempt) => attempt.state === 'UNKNOWN')) return 'PAYMENT_OUTCOME_UNKNOWN';
      if (attempts.length > 0) return 'DEPOSIT_IN_PROGRESS';
      return prior === null ? null : 'FINANCIAL_REVIEW_REQUIRED';
    },
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
