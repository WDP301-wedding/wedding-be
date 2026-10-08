import { randomUUID } from 'node:crypto';

import {
  createBookingBoundaryUnitOfWork,
  type BookingBoundaryUnitOfWork,
} from '../../core/database/booking-unit-of-work.js';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { createBookingLifecycleProviders } from '../booking-lifecycle/booking-lifecycle.providers.js';
import {
  createConsultationAccessReader,
  createPrismaConsultationAccessRepository,
} from '../identity-access/authorization/authorization.service.js';
import { createChargeRegistrationService } from './application/charge-registration.service.js';
import { createDepositOrchestrationService } from './application/deposit-orchestration.service.js';
import { createPrismaBillingPersistence } from './infrastructure/billing.persistence.js';
import type { ContractContext } from './application/payments-billing.providers.js';

// Controlled provider composition only. HTTP/VNPay wiring waits for W4/W6.
export function createPaymentsBillingProviders(prisma: PrismaClient) {
  const scope = createBookingBoundaryUnitOfWork(prisma);
  const booking = createBookingLifecycleProviders(
    prisma,
    createConsultationAccessReader(createPrismaConsultationAccessRepository(prisma)),
    scope,
  );
  const billing = createPrismaBillingPersistence(prisma, scope);
  const boundary: BookingBoundaryUnitOfWork = Object.freeze({
    async run<T>(
      input: Readonly<{ bookingId: string; context: ContractContext }>,
      work: (scopedContext: ContractContext) => Promise<T>,
    ): Promise<T> {
      for (let attempt = 1; ; attempt++) {
        try {
          return await scope.boundary.run(input, work);
        } catch (error) {
          // Retry the whole boundary, including all owner writes, never an aborted
          // transaction participant. Business/evidence failures are not retryable.
          if (
            !(error instanceof Prisma.PrismaClientKnownRequestError) ||
            !['P2034', 'P2002'].includes(error.code) ||
            attempt >= 3
          )
            throw error;
        }
      }
    },
  });
  return Object.freeze({
    boundary,
    ledger: billing.repository,
    charges: createChargeRegistrationService({
      ledger: billing.repository,
      context: () => ({
        requestId: randomUUID(),
        causationId: randomUUID(),
        actorAccountId: null,
        authority: 'SYSTEM',
      }),
    }),
    deposits: createDepositOrchestrationService({
      ledger: billing.repository,
      booking: booking.lifecycleReader,
      commercial: booking.commercial,
      coordinator: booking.deposits,
      recorder: booking.deposits,
      boundary,
    }),
  });
}
