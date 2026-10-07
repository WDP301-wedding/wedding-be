import type { Router } from 'express';

import type { Config } from '../../config/config.js';
import { createPrismaClient } from '../../core/database/prisma.js';
import type { ShutdownResource } from '../../core/http/lifecycle.js';
import { createIdempotencyMiddleware } from '../../core/idempotency/idempotency.middleware.js';
import { defineIdempotencyPolicy } from '../../core/idempotency/idempotency.policy.js';
import { createPrismaIdempotencyRepository } from '../../core/idempotency/idempotency.repository.js';
import { createIdempotencyService } from '../../core/idempotency/idempotency.service.js';
import { createAuthenticatedActorResolver } from '../identity-access/authorization/authenticated-actor.middleware.js';
import { createPrismaSessionRepository } from '../identity-access/session/session.repository.js';
import { createStaffOperationsService } from './application/staff-operations.service.js';
import {
  FakeBookingEventReader,
  FakeGuestOperationsReader,
  FakeSeatingGuidanceProvider,
  FakeStaffAccountProvisioner,
} from './domain/staff-operations.providers.js';
import { createStaffOperationsRepository } from './infrastructure/staff-operations.repository.js';
import {
  createStaffOperationsRouter,
  staffActorScope,
  staffIdempotencyPayload,
} from './http/staff-operations.router.js';

export type StaffOperationsRuntime = Readonly<{
  router: Router;
  resource: ShutdownResource;
}>;

export async function createStaffOperationsRuntime(config: Config): Promise<StaffOperationsRuntime> {
  const prisma = createPrismaClient(config.database.url);
  try {
    await prisma.$connect();

    const actorResolver = createAuthenticatedActorResolver(createPrismaSessionRepository(prisma));
    const idempotency = createIdempotencyService(createPrismaIdempotencyRepository(prisma));
    const repository = createStaffOperationsRepository(prisma);

    // Provider implementations — conforming fakes for standalone runtime / test suites
    const bookingReader = new FakeBookingEventReader();
    const guestReader = new FakeGuestOperationsReader();
    const seatingGuidance = new FakeSeatingGuidanceProvider();
    const staffProvisioner = new FakeStaffAccountProvisioner();

    const staffOperationsService = createStaffOperationsService({
      repository,
      bookingReader,
      guestReader,
      seatingGuidance,
      staffProvisioner,
    });

    const router = createStaffOperationsRouter({
      services: {
        staffOperations: staffOperationsService,
        actorResolver,
      },
      createIdempotencyHandler: (normalizedRoute) =>
        createIdempotencyMiddleware({
          service: idempotency,
          policy: defineIdempotencyPolicy({
            actorScope: staffActorScope,
            normalizedRoute,
            operationVersion: 'v1',
            payload: staffIdempotencyPayload,
          }),
        }),
    });

    return Object.freeze({
      router,
      resource: Object.freeze({
        name: 'staff-operations-database',
        close: () => prisma.$disconnect(),
      }),
    });
  } catch (error: unknown) {
    await prisma.$disconnect();
    throw error;
  }
}
