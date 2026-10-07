import type { Request, Router } from 'express';

import type { Config } from '../../config/config.js';
import { createPrismaClient } from '../../core/database/prisma.js';
import type { ShutdownResource } from '../../core/http/lifecycle.js';
import { createIdempotencyMiddleware } from '../../core/idempotency/idempotency.middleware.js';
import { defineIdempotencyPolicy } from '../../core/idempotency/idempotency.policy.js';
import { createPrismaIdempotencyRepository } from '../../core/idempotency/idempotency.repository.js';
import { createIdempotencyService } from '../../core/idempotency/idempotency.service.js';
import { FakeEmailProvider } from '../../integrations/email/fake-email-provider.js';
import { createResendEmailProvider } from '../../integrations/email/resend-email-provider.js';
import {
  createConsultationAccessReader,
  createPrismaConsultationAccessRepository,
} from '../identity-access/authorization/authorization.service.js';
import {
  createCoupleAccessPromoter,
  createPrismaCoupleAccessPromotionRepository,
} from '../identity-access/authorization/couple-access-promotion.js';
import { createAuthenticatedActorResolver } from '../identity-access/authorization/authenticated-actor.middleware.js';
import { createIdentityEmailNotificationPort } from '../identity-access/identity-notification.port.js';
import { createPrismaSessionRepository } from '../identity-access/session/session.repository.js';
import { createPrismaWorkspaceInvitationRepository } from '../identity-access/workspace-invitation/workspace-invitation.repository.js';
import { createWorkspaceInvitationService } from '../identity-access/workspace-invitation/workspace-invitation.service.js';
import { createLayoutService } from '../venue-catalog/application/layout.service.js';
import { createMenuService } from '../venue-catalog/application/menu.service.js';
import { createTimelineService as createCatalogTimelineService } from '../venue-catalog/application/timeline.service.js';
import { createVenueCatalogReader } from '../venue-catalog/application/venue-catalog.provider.js';
import { createVenueService } from '../venue-catalog/application/venue.service.js';
import { createBookingIdentityAdapter } from './application/booking-identity.adapter.js';
import { createConsultationWorkspaceService } from './application/consultation-workspace.service.js';
import { createConsultationService } from './application/consultation.service.js';
import { createBookingLifecycleService } from './application/lifecycle.service.js';
import { createProposalCatalogAdapter } from './application/proposal-catalog.adapter.js';
import { createProposalQueryService } from './application/proposal-query.service.js';
import { createSlotHoldService } from './application/slot-hold.service.js';
import { createTimelineService } from './application/timeline.service.js';
import {
  bookingActorScope,
  createBookingLifecycleRouter,
} from './http/booking-lifecycle.router.js';
import {
  createPrismaConsultationWorkspaceRepository,
  createPrismaConsultationRepository,
} from './infrastructure/consultation.repository.js';
import { createPrismaBookingLifecycleRepository } from './infrastructure/lifecycle.repository.js';
import { createPrismaSlotHoldRepository } from './infrastructure/slot-hold.repository.js';
import { createPrismaTimelineRepository } from './infrastructure/timeline.repository.js';

export type BookingLifecycleRuntime = Readonly<{
  router: Router;
  resource: ShutdownResource;
}>;

export async function createBookingLifecycleRuntime(
  config: Config,
): Promise<BookingLifecycleRuntime> {
  const prisma = createPrismaClient(config.database.url);
  try {
    await prisma.$connect();
    const access = createConsultationAccessReader(createPrismaConsultationAccessRepository(prisma));
    const venue = createVenueService(prisma);
    const menu = createMenuService(prisma);
    const catalogTimeline = createCatalogTimelineService(prisma);
    const layout = createLayoutService(prisma);
    const catalog = createVenueCatalogReader({
      venue,
      menu,
      timeline: catalogTimeline,
      layout,
    });
    const proposalCatalog = createProposalCatalogAdapter(catalog);
    const identityInvitations = createWorkspaceInvitationService({
      repository: createPrismaWorkspaceInvitationRepository(prisma),
      notificationPort: createIdentityEmailNotificationPort(
        config.email.enabled
          ? createResendEmailProvider({
              apiKey: config.email.resendApiKey,
              fromEmail: config.email.fromEmail,
            })
          : new FakeEmailProvider(),
        publicWebBaseUrl(config),
      ),
      tokenEntropyBytes: config.identityAccess.tokenEntropyBytes,
      lifetimeSeconds: config.identityAccess.invitation.lifetimeSeconds,
      reissueLimit: config.identityAccess.invitation.reissueLimit,
      reissueWindowSeconds: config.identityAccess.invitation.reissueWindowSeconds,
    });
    const consultationRepository = createPrismaConsultationRepository(prisma);
    const consultation = createConsultationService({
      repository: consultationRepository,
      catalog: proposalCatalog,
      identity: createBookingIdentityAdapter(identityInvitations),
    });
    const workspace = createConsultationWorkspaceService({
      repository: createPrismaConsultationWorkspaceRepository(prisma),
      catalog: proposalCatalog,
    });
    const slots = createSlotHoldService({
      repository: createPrismaSlotHoldRepository(prisma),
      catalog,
    });
    const timelines = createTimelineService({
      repository: createPrismaTimelineRepository(prisma),
      access,
    });
    const lifecycle = createBookingLifecycleService({
      repository: createPrismaBookingLifecycleRepository(prisma),
      access,
    });
    const proposalQueries = createProposalQueryService(prisma, access);
    const actorResolver = createAuthenticatedActorResolver(createPrismaSessionRepository(prisma));
    const idempotency = createIdempotencyService(createPrismaIdempotencyRepository(prisma));

    const router = createBookingLifecycleRouter({
      services: {
        resolveActor: actorResolver,
        createConsultation: (input) => workspace.createConsultation(input),
        requestWorkspaceInvitation: (input) => consultation.requestWorkspaceInvitation(input),
        checkAvailability: (input) => slots.checkAvailability(input),
        createBooking: (input) => workspace.createBooking(input),
        async acquireSlotHold(input) {
          const slot = await proposalQueries.getManagerSlotContext(
            input.bookingId,
            input.managerAccountId,
          );
          return slots.acquire({
            ...input,
            hallId: slot.hallId,
            eventDate: slot.eventDate,
            shiftCode: slot.shiftCode,
          });
        },
        getProposal: (input) => proposalQueries.get(input),
        saveTimeline: (input) => timelines.save(input),
        approveTimeline: (input) => timelines.approve(input),
        withdrawTimeline: (input) => timelines.withdraw(input),
        async requestChange(input) {
          const currentTimelineRevisionId = await proposalQueries.getCurrentTimelineRevisionId(
            input.bookingId,
          );
          return timelines.save({
            bookingId: input.bookingId,
            expectedBookingRevision: input.expectedBookingRevision,
            predecessorRevisionId: currentTimelineRevisionId,
            items: input.items,
            actor: input.actor,
            requestId: input.requestId,
          });
        },
        requestCancellation: (input) => lifecycle.requestCancellation(input),
        cancel: (input) => lifecycle.cancel(input),
        complete: (input) => lifecycle.complete(input),
      },
      createIdempotencyHandler: (normalizedRoute) =>
        createIdempotencyMiddleware({
          service: idempotency,
          policy: defineIdempotencyPolicy({
            actorScope: bookingActorScope,
            normalizedRoute,
            operationVersion: 'v1',
            payload: bookingIdempotencyPayload,
          }),
        }),
    });
    return Object.freeze({
      router,
      resource: Object.freeze({
        name: 'booking-lifecycle-database',
        close: () => prisma.$disconnect(),
      }),
    });
  } catch (error: unknown) {
    await prisma.$disconnect();
    throw error;
  }
}

export function bookingIdempotencyPayload(request: Request): unknown {
  return { params: request.params, query: request.query, body: request.body as unknown };
}

function publicWebBaseUrl(config: Config): string {
  const configured = config.cors.allowedOrigins[0];
  if (configured !== undefined) return configured;
  if (config.runtime.environment === 'development' || config.runtime.environment === 'test') {
    return 'http://localhost:3000';
  }
  throw new TypeError('Booking invitation links require a configured Public Web origin.');
}
