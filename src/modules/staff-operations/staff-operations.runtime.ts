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
import {
  createAttendanceReader,
  createStaffOperationsService,
  type AttendanceReader,
  type StaffOperationsService,
} from './application/staff-operations.service.js';
import {
  FakeBookingEventReader,
  FakeGuestOperationsReader,
  PrismaSeatingGuidanceProvider,
  PrismaStaffAccountProvisioner,
  type BookingEventReader,
  type GuestOperationsReader,
  type SeatingGuidanceProvider,
  type StaffAccountProvisioner,
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
  service: StaffOperationsService;
  attendanceReader: AttendanceReader;
}>;

export interface CreateStaffOperationsRuntimeOptions {
  readonly bookingReader?: BookingEventReader | undefined;
  readonly guestReader?: GuestOperationsReader | undefined;
  readonly seatingGuidance?: SeatingGuidanceProvider | undefined;
  readonly staffProvisioner?: StaffAccountProvisioner | undefined;
}

export async function createStaffOperationsRuntime(
  config: Config,
  options?: CreateStaffOperationsRuntimeOptions,
): Promise<StaffOperationsRuntime> {
  const prisma = createPrismaClient(config.database.url);
  try {
    await prisma.$connect();

    const actorResolver = createAuthenticatedActorResolver(createPrismaSessionRepository(prisma));
    const idempotency = createIdempotencyService(createPrismaIdempotencyRepository(prisma));
    const repository = createStaffOperationsRepository(prisma);

    const bookingReader = options?.bookingReader ?? new FakeBookingEventReader();
    const guestReader = options?.guestReader ?? new FakeGuestOperationsReader();
    const seatingGuidance = options?.seatingGuidance ?? new PrismaSeatingGuidanceProvider(prisma);
    const staffProvisioner = options?.staffProvisioner ?? new PrismaStaffAccountProvisioner(prisma);

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

    const attendanceReader = createAttendanceReader(repository, guestReader, prisma);

    return Object.freeze({
      router,
      resource: Object.freeze({
        name: 'staff-operations-database',
        close: () => prisma.$disconnect(),
      }),
      service: staffOperationsService,
      attendanceReader,
    });
  } catch (error: unknown) {
    await prisma.$disconnect();
    throw error;
  }
}
