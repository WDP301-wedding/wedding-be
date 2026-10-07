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
import { createSeatingPlanService } from './application/seating-plan.service.js';
import {
  FakeBookingPlanningReader,
  FakeGuestPlanningReader,
  FakePrintableSeatingContentRegistry,
  FakeVenueSelectionEligibilityReader,
} from './domain/seating-plan.providers.js';
import { createSeatingPlanRepository } from './infrastructure/seating-plan.repository.js';
import {
  createSeatingPlanRouter,
  seatingActorScope,
  seatingIdempotencyPayload,
} from './http/seating-plan.router.js';

export type SeatingPlanRuntime = Readonly<{
  router: Router;
  resource: ShutdownResource;
}>;

export async function createSeatingPlanRuntime(config: Config): Promise<SeatingPlanRuntime> {
  const prisma = createPrismaClient(config.database.url);
  try {
    await prisma.$connect();

    const actorResolver = createAuthenticatedActorResolver(createPrismaSessionRepository(prisma));
    const idempotency = createIdempotencyService(createPrismaIdempotencyRepository(prisma));
    const repository = createSeatingPlanRepository(prisma);

    // Provider implementations — replace with real cross-module wiring when available
    const bookingReader = new FakeBookingPlanningReader();
    const guestReader = new FakeGuestPlanningReader();
    const venueReader = new FakeVenueSelectionEligibilityReader();
    const registry = new FakePrintableSeatingContentRegistry();

    const seatingPlanService = createSeatingPlanService({
      repository,
      bookingReader,
      guestReader,
      venueReader,
      registry,
      prisma,
    });

    const router = createSeatingPlanRouter({
      services: { seatingPlan: seatingPlanService, actorResolver },
      createIdempotencyHandler: (normalizedRoute) =>
        createIdempotencyMiddleware({
          service: idempotency,
          policy: defineIdempotencyPolicy({
            actorScope: seatingActorScope,
            normalizedRoute,
            operationVersion: 'v1',
            payload: seatingIdempotencyPayload,
          }),
        }),
    });

    return Object.freeze({
      router,
      resource: Object.freeze({
        name: 'seating-plan-database',
        close: () => prisma.$disconnect(),
      }),
    });
  } catch (error: unknown) {
    await prisma.$disconnect();
    throw error;
  }
}
