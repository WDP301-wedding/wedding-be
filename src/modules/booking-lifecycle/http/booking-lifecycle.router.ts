import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
  type ErrorRequestHandler,
} from 'express';

import { validateRequest, validatedRequest } from '../../../core/http/validate.js';
import { AppError } from '../../../core/errors/app-error.js';
import { BookingPolicyError } from '../domain/booking-policy.js';
import { BookingTimelinePolicyError } from '../domain/timeline.policy.js';
import { BookingSlotPolicyError } from '../domain/slot-hold.policy.js';
import { BookingLifecyclePolicyError } from '../domain/lifecycle.policy.js';
import type {
  AuthenticatedActor,
  AuthenticatedActorResolver,
} from '../../identity-access/authorization/authenticated-actor.middleware.js';
import {
  AuthenticationRequiredError,
  createAuthenticatedActorMiddleware,
} from '../../identity-access/authorization/authenticated-actor.middleware.js';
import { requireAnyRole } from '../../identity-access/authorization/authorization.service.js';
import type { RestaurantShiftCode } from '../../venue-catalog/application/venue.service.js';
import type { TimelineRevision } from '../domain/timeline.policy.js';
import { holdResponseSchema, proposalResponseSchema } from './booking-lifecycle.responses.js';
import {
  approvalBodySchema,
  availabilityQuerySchema,
  bookingParamsSchema,
  bookingResponseSchema,
  cancellationBodySchema,
  cancellationDecisionParamsSchema,
  cancellationDecisionBodySchema,
  changeRequestBodySchema,
  consultationParamsSchema,
  consultationResponseSchema,
  createBookingBodySchema,
  createConsultationBodySchema,
  expectedRevisionBodySchema,
  timelineParamsSchema,
  timelineRevisionBodySchema,
  withdrawalBodySchema,
  workspaceInvitationBodySchema,
} from './booking-lifecycle.schemas.js';

type Actor = Readonly<{
  accountId: string;
  roles: readonly ('MANAGER' | 'STAFF' | 'COUPLE')[];
}>;
type TimelineInputItem = Readonly<{
  itemId?: string;
  order: number;
  startTime: string;
  title: string;
  description: string | null;
}>;

export interface BookingLifecycleHttpServices {
  readonly resolveActor: AuthenticatedActorResolver;
  createConsultation(
    input: Readonly<{
      intendedEmail: string;
      displayName: string;
      note: string | null;
      managerAccountId: string;
      requestId: string;
    }>,
  ): Promise<Readonly<{ consultationId: string; revision: number }>>;
  requestWorkspaceInvitation(
    input: Readonly<{
      consultationId: string;
      expectedRevision: number;
      managerAccountId: string;
      requestId: string;
    }>,
  ): Promise<Readonly<{ invitationId: string; replayed: boolean }>>;
  checkAvailability(
    input: Readonly<{
      hallId: string;
      eventDate: string;
      shiftCode: RestaurantShiftCode;
    }>,
  ): Promise<
    Readonly<{
      available: boolean;
      activeHold: Readonly<{ holdId: string; expiresAt: Date }> | null;
    }>
  >;
  createBooking(
    input: Readonly<{
      consultationId: string;
      hallId: string;
      eventDate: string;
      shiftCode: RestaurantShiftCode;
      menuPackageVersionId: string;
      tableCount: number;
      planningHeadcount: number;
      expectedRevision: number;
      managerAccountId: string;
      requestId: string;
    }>,
  ): Promise<
    Readonly<{ bookingId: string; bookingRevision: number; consultationRevision: number }>
  >;
  acquireSlotHold(
    input: Readonly<{
      bookingId: string;
      expectedRevision: number;
      managerAccountId: string;
      requestId: string;
    }>,
  ): Promise<
    Readonly<{ holdId: string; expiresAt: Date; bookingRevision: number; replayed: boolean }>
  >;
  getProposal(input: Readonly<{ bookingId: string; actor: Actor }>): Promise<unknown>;
  saveTimeline(
    input: Readonly<{
      bookingId: string;
      expectedBookingRevision: number;
      predecessorRevisionId: string | null;
      items: readonly TimelineInputItem[];
      actor: Actor;
      requestId: string;
    }>,
  ): Promise<Readonly<{ changed: boolean; revision: TimelineRevision; bookingRevision: number }>>;
  approveTimeline(
    input: Readonly<{
      bookingId: string;
      timelineRevisionId: string;
      expectedBookingRevision: number;
      actor: Actor;
      requestId: string;
    }>,
  ): Promise<Readonly<{ revision: TimelineRevision; bookingRevision: number }>>;
  withdrawTimeline(
    input: Readonly<{
      bookingId: string;
      timelineRevisionId: string;
      expectedBookingRevision: number;
      reason: string;
      actor: Actor;
      requestId: string;
    }>,
  ): Promise<Readonly<{ revision: TimelineRevision; bookingRevision: number }>>;
  requestChange(
    input: Readonly<{
      bookingId: string;
      expectedBookingRevision: number;
      items: readonly TimelineInputItem[];
      reason: string;
      actor: Actor;
      requestId: string;
    }>,
  ): Promise<Readonly<{ changed: boolean; revision: TimelineRevision; bookingRevision: number }>>;
  requestCancellation(
    input: Readonly<{
      bookingId: string;
      expectedBookingRevision: number;
      reason: string;
      actor: Actor;
      requestId: string;
    }>,
  ): Promise<Readonly<{ cancellationRequestId: string; bookingRevision: number }>>;
  cancel(
    input: Readonly<{
      bookingId: string;
      expectedBookingRevision: number;
      reason: string;
      actor: Actor;
      requestId: string;
    }>,
  ): Promise<Readonly<{ phase: 'CANCELLED'; bookingRevision: number }>>;
  decideCancellation(
    input: Readonly<{
      bookingId: string;
      cancellationRequestId: string;
      expectedBookingRevision: number;
      decision: 'APPROVE' | 'REJECT';
      reason: string;
      actor: Actor;
      requestId: string;
    }>,
  ): Promise<
    Readonly<{
      phase: 'DRAFT' | 'AWAITING_DEPOSIT' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';
      bookingRevision: number;
    }>
  >;
  complete(
    input: Readonly<{
      bookingId: string;
      expectedBookingRevision: number;
      actor: Actor;
      requestId: string;
    }>,
  ): Promise<Readonly<{ phase: 'COMPLETED'; bookingRevision: number }>>;
}

export interface CreateBookingLifecycleRouterOptions {
  readonly services: BookingLifecycleHttpServices;
  readonly createIdempotencyHandler: (normalizedRoute: string) => RequestHandler;
  readonly auditProtectedDenial?: (
    input: Readonly<{
      requestId: string;
      actorAccountId: string | null;
      code: string;
      status: number;
      operation: string;
    }>,
  ) => Promise<void>;
}

const actorContexts = new WeakMap<Request, AuthenticatedActor>();

export function createBookingLifecycleRouter(options: CreateBookingLifecycleRouterOptions): Router {
  const router = Router();
  const authenticate = createAuthenticatedActorMiddleware(options.services.resolveActor);
  const captureActor: RequestHandler = (request, response, next) => {
    const actor = response.locals.actor as AuthenticatedActor | undefined;
    if (actor === undefined) return next(new AuthenticationRequiredError());
    actorContexts.set(request, actor);
    next();
  };
  const authenticated = [authenticate, captureActor] as const;
  const manager = [...authenticated, requireManager()] as const;
  const idempotent = options.createIdempotencyHandler;

  router.post(
    '/management/consultations',
    ...manager,
    idempotent('/management/consultations'),
    validateRequest({ body: createConsultationBodySchema }),
    asyncHandler(async (request, response) => {
      const { body } = validatedRequest(response, { body: createConsultationBodySchema });
      const result = await options.services.createConsultation({
        ...body,
        note: body.note ?? null,
        managerAccountId: actor(request).accountId,
        requestId: request.requestId,
      });
      response.status(201).json(
        consultationResponseSchema.parse({
          data: { consultationId: result.consultationId, revision: result.revision },
        }),
      );
    }),
  );

  router.post(
    '/management/consultations/:consultationId/workspace-invitations',
    ...manager,
    idempotent('/management/consultations/{consultationId}/workspace-invitations'),
    validateRequest({ params: consultationParamsSchema, body: workspaceInvitationBodySchema }),
    asyncHandler(async (request, response) => {
      const { params, body } = validatedRequest(response, {
        params: consultationParamsSchema,
        body: workspaceInvitationBodySchema,
      });
      const result = await options.services.requestWorkspaceInvitation({
        consultationId: params.consultationId,
        expectedRevision: body.expectedRevision,
        managerAccountId: actor(request).accountId,
        requestId: request.requestId,
      });
      response.status(202).json({
        data: {
          consultationId: params.consultationId,
          invitationId: result.invitationId,
          status: 'ISSUED',
          replayed: result.replayed,
        },
      });
    }),
  );

  router.get(
    '/management/availability',
    ...manager,
    validateRequest({ query: availabilityQuerySchema }),
    asyncHandler(async (_request, response) => {
      const { query } = validatedRequest(response, { query: availabilityQuerySchema });
      const result = await options.services.checkAvailability(query);
      response.json({
        data: {
          available: result.available,
          activeHold:
            result.activeHold === null
              ? null
              : { ...result.activeHold, expiresAt: result.activeHold.expiresAt.toISOString() },
        },
      });
    }),
  );

  router.post(
    '/bookings',
    ...manager,
    idempotent('/bookings'),
    validateRequest({ body: createBookingBodySchema }),
    asyncHandler(async (request, response) => {
      const { body } = validatedRequest(response, { body: createBookingBodySchema });
      const result = await options.services.createBooking({
        ...body,
        managerAccountId: actor(request).accountId,
        requestId: request.requestId,
      });
      response.status(201).json(
        bookingResponseSchema.parse({
          data: {
            bookingId: result.bookingId,
            revision: result.bookingRevision,
            consultationRevision: result.consultationRevision,
          },
        }),
      );
    }),
  );

  router.post(
    '/bookings/:bookingId/slot-holds',
    ...manager,
    idempotent('/bookings/{bookingId}/slot-holds'),
    validateRequest({ params: bookingParamsSchema, body: expectedRevisionBodySchema }),
    asyncHandler(async (request, response) => {
      const { params, body } = validatedRequest(response, {
        params: bookingParamsSchema,
        body: expectedRevisionBodySchema,
      });
      const result = await options.services.acquireSlotHold({
        bookingId: params.bookingId,
        expectedRevision: body.expectedRevision,
        managerAccountId: actor(request).accountId,
        requestId: request.requestId,
      });
      response.status(201).json(
        holdResponseSchema.parse({
          data: {
            holdId: result.holdId,
            expiresAt: result.expiresAt.toISOString(),
            bookingRevision: result.bookingRevision,
            replayed: result.replayed,
          },
        }),
      );
    }),
  );

  router.get(
    '/bookings/:bookingId/proposal',
    ...authenticated,
    validateRequest({ params: bookingParamsSchema }),
    asyncHandler(async (request, response) => {
      const { params } = validatedRequest(response, { params: bookingParamsSchema });
      response.json(
        proposalResponseSchema.parse({
          data: await options.services.getProposal({
            bookingId: params.bookingId,
            actor: actor(request),
          }),
        }),
      );
    }),
  );

  router.post(
    '/bookings/:bookingId/timeline-revisions',
    ...authenticated,
    idempotent('/bookings/{bookingId}/timeline-revisions'),
    validateRequest({ params: bookingParamsSchema, body: timelineRevisionBodySchema }),
    asyncHandler(async (request, response) => {
      const { params, body } = validatedRequest(response, {
        params: bookingParamsSchema,
        body: timelineRevisionBodySchema,
      });
      const result = await options.services.saveTimeline({
        bookingId: params.bookingId,
        expectedBookingRevision: body.expectedRevision,
        predecessorRevisionId: body.predecessorRevisionId,
        items: timelineItems(body.items),
        actor: actor(request),
        requestId: request.requestId,
      });
      response.status(result.changed ? 201 : 200).json({ data: serializeTimelineResult(result) });
    }),
  );

  router.post(
    '/bookings/:bookingId/timeline-revisions/:revisionId/approvals',
    ...authenticated,
    idempotent('/bookings/{bookingId}/timeline-revisions/{revisionId}/approvals'),
    validateRequest({ params: timelineParamsSchema, body: approvalBodySchema }),
    asyncHandler(async (request, response) => {
      const { params, body } = validatedRequest(response, {
        params: timelineParamsSchema,
        body: approvalBodySchema,
      });
      const result = await options.services.approveTimeline({
        bookingId: params.bookingId,
        timelineRevisionId: params.revisionId,
        expectedBookingRevision: body.expectedRevision,
        actor: actor(request),
        requestId: request.requestId,
      });
      response.json({ data: serializeTimelineResult(result) });
    }),
  );

  router.post(
    '/bookings/:bookingId/timeline-revisions/:revisionId/withdrawals',
    ...authenticated,
    idempotent('/bookings/{bookingId}/timeline-revisions/{revisionId}/withdrawals'),
    validateRequest({ params: timelineParamsSchema, body: withdrawalBodySchema }),
    asyncHandler(async (request, response) => {
      const { params, body } = validatedRequest(response, {
        params: timelineParamsSchema,
        body: withdrawalBodySchema,
      });
      const result = await options.services.withdrawTimeline({
        bookingId: params.bookingId,
        timelineRevisionId: params.revisionId,
        expectedBookingRevision: body.expectedRevision,
        reason: body.reason,
        actor: actor(request),
        requestId: request.requestId,
      });
      response.json({ data: serializeTimelineResult(result) });
    }),
  );

  router.post(
    '/bookings/:bookingId/change-requests',
    ...authenticated,
    idempotent('/bookings/{bookingId}/change-requests'),
    validateRequest({ params: bookingParamsSchema, body: changeRequestBodySchema }),
    asyncHandler(async (request, response) => {
      const { params, body } = validatedRequest(response, {
        params: bookingParamsSchema,
        body: changeRequestBodySchema,
      });
      const result = await options.services.requestChange({
        bookingId: params.bookingId,
        expectedBookingRevision: body.expectedRevision,
        items: timelineItems(body.items),
        reason: body.reason,
        actor: actor(request),
        requestId: request.requestId,
      });
      response.status(result.changed ? 201 : 200).json({ data: serializeTimelineResult(result) });
    }),
  );

  router.post(
    '/bookings/:bookingId/cancellation-requests',
    ...authenticated,
    idempotent('/bookings/{bookingId}/cancellation-requests'),
    validateRequest({ params: bookingParamsSchema, body: cancellationBodySchema }),
    asyncHandler(async (request, response) => {
      const { params, body } = validatedRequest(response, {
        params: bookingParamsSchema,
        body: cancellationBodySchema,
      });
      const result = await options.services.requestCancellation({
        bookingId: params.bookingId,
        expectedBookingRevision: body.expectedRevision,
        reason: body.reason,
        actor: actor(request),
        requestId: request.requestId,
      });
      response.status(202).json({ data: result });
    }),
  );

  router.post(
    '/management/bookings/:bookingId/cancellation-requests/:requestId/decision',
    ...manager,
    idempotent('/management/bookings/{bookingId}/cancellation-requests/{requestId}/decision'),
    validateRequest({
      params: cancellationDecisionParamsSchema,
      body: cancellationDecisionBodySchema,
    }),
    asyncHandler(async (request, response) => {
      const { params, body } = validatedRequest(response, {
        params: cancellationDecisionParamsSchema,
        body: cancellationDecisionBodySchema,
      });
      response.json({
        data: await options.services.decideCancellation({
          bookingId: params.bookingId,
          cancellationRequestId: params.requestId,
          expectedBookingRevision: body.expectedRevision,
          decision: body.decision,
          reason: body.reason,
          actor: actor(request),
          requestId: request.requestId,
        }),
      });
    }),
  );

  router.post(
    '/management/bookings/:bookingId/cancellation',
    ...manager,
    idempotent('/management/bookings/{bookingId}/cancellation'),
    validateRequest({ params: bookingParamsSchema, body: cancellationBodySchema }),
    asyncHandler(async (request, response) => {
      const { params, body } = validatedRequest(response, {
        params: bookingParamsSchema,
        body: cancellationBodySchema,
      });
      response.json({
        data: await options.services.cancel({
          bookingId: params.bookingId,
          expectedBookingRevision: body.expectedRevision,
          reason: body.reason,
          actor: actor(request),
          requestId: request.requestId,
        }),
      });
    }),
  );

  router.post(
    '/management/bookings/:bookingId/completion',
    ...manager,
    idempotent('/management/bookings/{bookingId}/completion'),
    validateRequest({ params: bookingParamsSchema, body: expectedRevisionBodySchema }),
    asyncHandler(async (request, response) => {
      const { params, body } = validatedRequest(response, {
        params: bookingParamsSchema,
        body: expectedRevisionBodySchema,
      });
      response.json({
        data: await options.services.complete({
          bookingId: params.bookingId,
          expectedBookingRevision: body.expectedRevision,
          actor: actor(request),
          requestId: request.requestId,
        }),
      });
    }),
  );

  const auditDenial: ErrorRequestHandler = (error: unknown, request, _response, next) => {
    if (
      !(error instanceof AppError) ||
      ![401, 403, 404].includes(error.status) ||
      options.auditProtectedDenial === undefined
    ) {
      next(error);
      return;
    }
    const route: unknown = request.route;
    void options
      .auditProtectedDenial({
        requestId: request.requestId,
        actorAccountId: actorContexts.get(request)?.accountId ?? null,
        code: error.code,
        status: error.status,
        operation:
          request.method +
          ' ' +
          (typeof route === 'object' &&
          route !== null &&
          'path' in route &&
          typeof route.path === 'string'
            ? route.path
            : 'booking'),
      })
      .then(() => next(error))
      .catch((cause: unknown) =>
        next(
          new AppError({
            status: 503,
            code: 'PROVIDER_UNAVAILABLE',
            message: 'The protected access audit could not be recorded.',
            cause,
          }),
        ),
      );
  };
  router.use(auditDenial);
  return router;
}

function requireManager(): RequestHandler {
  return (request, _response, next) => {
    try {
      requireAnyRole(actorContexts.get(request) ?? missingActor(), ['MANAGER']);
      next();
    } catch (error: unknown) {
      next(error);
    }
  };
}

function actor(request: Request): AuthenticatedActor {
  return actorContexts.get(request) ?? missingActor();
}

export function bookingActorScope(request: Request): string {
  return actor(request).accountId;
}

function missingActor(): never {
  throw new AuthenticationRequiredError();
}

function timelineItems(
  items: readonly Readonly<{
    itemId?: string | undefined;
    order: number;
    startTime: string;
    title: string;
    description?: string | undefined;
  }>[],
): readonly TimelineInputItem[] {
  return items.map((item) => ({
    ...(item.itemId === undefined ? {} : { itemId: item.itemId }),
    order: item.order,
    startTime: item.startTime,
    title: item.title,
    description: item.description ?? null,
  }));
}

function serializeTimelineResult(
  result: Readonly<{
    changed?: boolean;
    revision: TimelineRevision;
    bookingRevision: number;
  }>,
) {
  return {
    ...(result.changed === undefined ? {} : { changed: result.changed }),
    bookingRevision: result.bookingRevision,
    revision: {
      ...result.revision,
      createdAt: result.revision.createdAt.toISOString(),
      managerApprovedAt: result.revision.managerApprovedAt?.toISOString() ?? null,
      coupleApprovedAt: result.revision.coupleApprovedAt?.toISOString() ?? null,
    },
  };
}

function asyncHandler(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (request, response, next) =>
    void handler(request, response, next).catch((error: unknown) => {
      if (
        error instanceof BookingPolicyError ||
        error instanceof BookingTimelinePolicyError ||
        error instanceof BookingSlotPolicyError ||
        error instanceof BookingLifecyclePolicyError
      ) {
        next(
          new AppError({
            status: error.code.endsWith('_INVALID') ? 422 : 409,
            code: error.code,
            message: error.message,
          }),
        );
        return;
      }
      next(error);
    });
}
