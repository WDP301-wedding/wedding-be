import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { createBookingBoundaryUnitOfWork } from '../../../core/database/booking-unit-of-work.js';
import type { ContractContext } from './payments-billing.providers.js';
import {
  BillingPersistenceConflict,
  createPrismaBillingPersistence,
} from '../infrastructure/billing.persistence.js';
import { createEffectiveCommercialReader } from '../../booking-lifecycle/infrastructure/effective-commercial.reader.js';

export function createCommercialFinancialService(
  prisma: PrismaClient,
  scope: ReturnType<typeof createBookingBoundaryUnitOfWork>,
) {
  const ledger = createPrismaBillingPersistence(prisma, scope).repository;
  return Object.freeze({
    async requireMutable(bookingId: string, context: ContractContext) {
      await scope.withClient(bookingId, context, async (client) => {
        const attempts = await client.billingPaymentAttempt.findMany({
          where: { bookingId },
          include: { paymentEntries: { select: { id: true } } },
        });
        if (
          attempts.some(
            (a) =>
              ['CREATED', 'PENDING', 'UNKNOWN'].includes(a.state) ||
              (a.state === 'SUCCEEDED' && a.paymentEntries.length === 0),
          )
        )
          throw new BillingPersistenceConflict('PAYMENT_ATTEMPT_ACTIVE');
      });
    },
    async registerAppendix(bookingId: string, revisionId: string, context: ContractContext) {
      const source = await scope.withClient(bookingId, context, (client) =>
        createEffectiveCommercialReader(client).resolveAppendix(bookingId, revisionId),
      );
      const delta = source.document.deltaVnd;
      if (delta === 0) return;
      await ledger.append(
        {
          id: randomUUID(),
          bookingId,
          kind: delta > 0 ? 'CHARGE' : 'CREDIT_ADJUSTMENT',
          sourceType: 'CONTRACT_APPENDIX',
          sourceRevisionId: revisionId,
          amountVnd: Math.abs(delta),
          occurredAt: source.approvedAt,
          sourceEntryId: null,
          paymentAttemptId: null,
          decisionId: null,
          approvedRefundableVnd: null,
          reason: source.document.reason,
          evidenceReference: null,
        },
        context,
      );
    },
  });
}
