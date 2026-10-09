import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import type {
  ContractContext,
  PrismaBookingBoundary,
} from '../../../core/database/booking-boundary.js';
import { createBookingBoundaryUnitOfWork } from '../../../core/database/booking-unit-of-work.js';
import { createPrismaBillingPersistence } from './billing.persistence.js';
import { createChargeRegistrationService } from '../application/charge-registration.service.js';
import type {
  BillingReader,
  BookingChargeRegistrar,
  BookingChargeAdjustmentRegistrar,
} from '../application/billing.contracts.js';

/** Enlist the accepted Billing owner in Invitation's existing transaction. */
export function createPrismaBillingAdapter(
  prisma: PrismaClient,
  boundary: PrismaBookingBoundary,
): BillingReader & BookingChargeRegistrar & BookingChargeAdjustmentRegistrar {
  const ownerScope = createBookingBoundaryUnitOfWork(prisma);
  const scope = {
    ...ownerScope,
    withClient<T>(
      bookingId: string,
      context: ContractContext | undefined,
      work: (client: PrismaClient) => Promise<T>,
    ): Promise<T> {
      const tx = boundary.current(bookingId);
      if (tx === undefined) return ownerScope.withClient(bookingId, context, work);
      if (context?.transactionScopeId !== undefined) boundary.requireScope(bookingId, context);
      const client = new Proxy(prisma, {
        get(_target, property) {
          if (property === '$transaction')
            return <R>(callback: (client: Prisma.TransactionClient) => Promise<R>) => callback(tx);
          const value: unknown = Reflect.get(tx, property);
          const scopedValue: unknown = typeof value === 'function' ? value.bind(tx) : value;
          return scopedValue;
        },
      });
      return work(client);
    },
  };
  const { repository } = createPrismaBillingPersistence(prisma, scope);
  const charges = createChargeRegistrationService({
    ledger: repository,
    context: () =>
      boundary.currentContext() ?? {
        requestId: randomUUID(),
        causationId: randomUUID(),
        actorAccountId: null,
        authority: 'SYSTEM',
      },
  });
  return {
    ...charges,
    async getBookingReceivables(bookingId) {
      bookingId = z.uuid().parse(bookingId).toLowerCase();
      const { totals } = await repository.getLedger(bookingId, boundary.currentContext(bookingId));
      return {
        acceptedChargesVnd: totals.acceptedChargesVnd,
        paidVnd: totals.paidVnd,
        refundedVnd: totals.refundedVnd,
        outstandingVnd: totals.outstandingVnd,
      };
    },
  };
}
