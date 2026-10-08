import type { Router } from 'express';

import type { Config } from '../../config/config.js';
import { createPrismaClient } from '../../core/database/prisma.js';
import type { ShutdownResource } from '../../core/http/lifecycle.js';
import { createIdempotencyMiddleware } from '../../core/idempotency/idempotency.middleware.js';
import { defineIdempotencyPolicy } from '../../core/idempotency/idempotency.policy.js';
import { createPrismaIdempotencyRepository } from '../../core/idempotency/idempotency.repository.js';
import { createIdempotencyService } from '../../core/idempotency/idempotency.service.js';
import { NotFoundError } from '../../core/errors/app-error.js';
import { ForbiddenIdentityAccessError } from '../identity-access/authorization/authorization.service.js';
import {
  createAuthenticatedActorResolver,
} from '../identity-access/authorization/authenticated-actor.middleware.js';
import type { AuthenticatedActor } from '../identity-access/authorization/authenticated-actor.middleware.js';
import { createPrismaSessionRepository } from '../identity-access/session/session.repository.js';
import { createSeatingPlanService, type SeatingPlanService } from './application/seating-plan.service.js';
import {
  FakeBookingPlanningReader,
  FakeGuestPlanningReader,
  PrismaPrintableSeatingContentRegistry,
  PrismaVenueSelectionEligibilityReader,
  type BookingPlanningReader,
  type GuestPlanningReader,
  type PrintableSeatingContentRegistry,
  type VenueSelectionEligibilityReader,
} from './domain/seating-plan.providers.js';
import { createSeatingPlanRepository } from './infrastructure/seating-plan.repository.js';
import {
  createSeatingPlanRouter,
  seatingActorScope,
  seatingIdempotencyPayload,
  type BookingAccessAuthorizer,
} from './http/seating-plan.router.js';

export type SeatingPlanRuntime = Readonly<{
  router: Router;
  resource: ShutdownResource;
  service: SeatingPlanService;
}>;

export interface CreateSeatingPlanRuntimeOptions {
  readonly bookingReader?: BookingPlanningReader | undefined;
  readonly guestReader?: GuestPlanningReader | undefined;
  readonly venueReader?: VenueSelectionEligibilityReader | undefined;
  readonly registry?: PrintableSeatingContentRegistry | undefined;
}

export async function createSeatingPlanRuntime(
  config: Config,
  options?: CreateSeatingPlanRuntimeOptions,
): Promise<SeatingPlanRuntime> {
  const prisma = createPrismaClient(config.database.url);
  try {
    await prisma.$connect();

    const actorResolver = createAuthenticatedActorResolver(createPrismaSessionRepository(prisma));
    const idempotency = createIdempotencyService(createPrismaIdempotencyRepository(prisma));
    const repository = createSeatingPlanRepository(prisma);

    const bookingReader = options?.bookingReader ?? new FakeBookingPlanningReader();
    const guestReader = options?.guestReader ?? new FakeGuestPlanningReader();
    const venueReader = options?.venueReader ?? new PrismaVenueSelectionEligibilityReader(prisma);
    const registry = options?.registry ?? new PrismaPrintableSeatingContentRegistry(prisma);

    const seatingPlanService = createSeatingPlanService({
      repository,
      bookingReader,
      guestReader,
      venueReader,
      registry,
      prisma,
    });

    const authorizeBookingAccess: BookingAccessAuthorizer = async (actor: AuthenticatedActor, bookingId: string) => {
      if (actor.roles.includes('MANAGER')) {
        return;
      }
      if (!actor.roles.includes('COUPLE')) {
        throw new ForbiddenIdentityAccessError();
      }
      const access = await prisma.consultationAccess.findFirst({
        where: {
          accountId: actor.accountId,
          bookingId,
        },
      });
      if (access === null) {
        throw new NotFoundError();
      }
      if (access.level !== 'FULL') {
        throw new ForbiddenIdentityAccessError();
      }
    };

    const router = createSeatingPlanRouter({
      services: {
        seatingPlan: seatingPlanService,
        actorResolver,
        authorizeBookingAccess,
      },
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
      service: seatingPlanService,
    });
  } catch (error: unknown) {
    await prisma.$disconnect();
    throw error;
  }
}
