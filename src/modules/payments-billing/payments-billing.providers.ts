import { randomUUID } from 'node:crypto';

import { config } from '../../config/config.js';
import type { BackendConfig } from '../../config/env.js';

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
import { createVnpayService } from './application/vnpay.service.js';
import type { VnpayStatusGateway } from './application/vnpay.port.js';
import { createPrismaBillingPersistence } from './infrastructure/billing.persistence.js';
import { createVnpayEvidenceRepository } from './infrastructure/vnpay.persistence.js';
import { createVnpayProtocol } from './infrastructure/vnpay.protocol.js';
import { createVnpayStatusGateway } from './infrastructure/vnpay.gateway.js';
import { createBillingOperationsRepository } from './infrastructure/billing-operations.repository.js';
import { createBillingOperationsService } from './application/billing-operations.service.js';
import type { ContractContext } from './application/payments-billing.providers.js';

// Real owner/provider composition. HTTP/OpenAPI publication remains the W6 lane.
export function createPaymentsBillingProviders(
  prisma: PrismaClient,
  options: Readonly<{ vnpay?: BackendConfig['vnpay']; gateway?: VnpayStatusGateway }> = {},
) {
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
  const deposits = createDepositOrchestrationService({
    ledger: billing.repository,
    booking: booking.lifecycleReader,
    commercial: booking.commercial,
    coordinator: booking.deposits,
    recorder: booking.deposits,
    boundary,
  });
  const settings = options.vnpay ?? config.vnpay;
  const operations = createBillingOperationsService({
    ledger: billing.repository,
    operations: createBillingOperationsRepository(prisma, scope),
    boundary,
    booking: booking.lifecycleReader,
    commercial: booking.commercial,
    reporting: booking.reporting,
    coordinator: booking.deposits,
    recorder: booking.deposits,
  });
  return Object.freeze({
    operations,
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
    deposits,
    vnpay: settings.enabled
      ? createVnpayService({
          deposits,
          ledger: billing.repository,
          coordinator: booking.deposits,
          evidence: createVnpayEvidenceRepository(prisma, scope),
          protocol: createVnpayProtocol(settings),
          gateway: options.gateway ?? createVnpayStatusGateway(),
          boundary,
        })
      : null,
  });
}
