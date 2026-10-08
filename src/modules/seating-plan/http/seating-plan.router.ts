import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';

import {
  AuthenticationRequiredError,
  type AuthenticatedActor,
  type AuthenticatedActorResolver,
} from '../../identity-access/authorization/authenticated-actor.middleware.js';
import {
  ForbiddenIdentityAccessError,
  requireAnyRole,
} from '../../identity-access/authorization/authorization.service.js';
import { validateRequest, validatedRequest } from '../../../core/http/validate.js';
import type { SeatingPlanService } from '../application/seating-plan.service.js';
import {
  bookingParamsSchema,
  confirmBodySchema,
  exceptionBodySchema,
  layoutOptionsQuerySchema,
  managementPlanParamsSchema,
  planParamsSchema,
  saveRevisionBodySchema,
  selectLayoutBodySchema,
} from './seating-plan.schemas.js';

// ─── Public interface ─────────────────────────────────────────────────────────

export type BookingAccessAuthorizer = (
  actor: AuthenticatedActor,
  bookingId: string,
) => Promise<void>;

export interface SeatingPlanHttpServices {
  readonly seatingPlan: SeatingPlanService;
  readonly actorResolver: AuthenticatedActorResolver;
  readonly authorizeBookingAccess?: BookingAccessAuthorizer | undefined;
}

export interface CreateSeatingPlanRouterOptions {
  readonly services: SeatingPlanHttpServices;
  readonly createIdempotencyHandler: (normalizedRoute: string) => RequestHandler;
}

const authenticatedActors = new WeakMap<Request, AuthenticatedActor>();

// ─── Router factory ───────────────────────────────────────────────────────────

export function createSeatingPlanRouter(options: CreateSeatingPlanRouterOptions): Router {
  const router = Router();
  const { services, createIdempotencyHandler } = options;
  const auth = createAuthMiddleware(services.actorResolver);

  async function checkBookingAccess(actor: AuthenticatedActor, bookingId: string): Promise<void> {
    if (services.authorizeBookingAccess !== undefined) {
      await services.authorizeBookingAccess(actor, bookingId);
      return;
    }
    if (actor.roles.includes('MANAGER')) {
      return;
    }
    if (!actor.roles.includes('COUPLE')) {
      throw new ForbiddenIdentityAccessError();
    }
  }

  // ── GET /bookings/:bookingId/seating-layout-options ──────────────────────
  router.get(
    '/bookings/:bookingId/seating-layout-options',
    auth,
    validateRequest({ params: bookingParamsSchema, query: layoutOptionsQuerySchema }),
    asyncHandler(async (request, response) => {
      const actor = requireActor(request);
      requireAnyRole(actor, ['MANAGER', 'COUPLE']);

      const { params } = validatedRequest(response, {
        params: bookingParamsSchema,
        query: layoutOptionsQuerySchema,
      });

      await checkBookingAccess(actor, params.bookingId);

      const options_ = await services.seatingPlan.listLayoutOptions({
        bookingId: params.bookingId,
        accessToken: bearerToken(request) ?? '',
        requestId: request.requestId,
      });
      response.json({ data: { items: options_ } });
    }),
  );

  // ── POST /bookings/:bookingId/seating-plans ───────────────────────────────
  router.post(
    '/bookings/:bookingId/seating-plans',
    auth,
    createIdempotencyHandler('/bookings/{bookingId}/seating-plans'),
    validateRequest({ params: bookingParamsSchema, body: selectLayoutBodySchema }),
    asyncHandler(async (request, response) => {
      const actor = requireActor(request);
      requireAnyRole(actor, ['MANAGER', 'COUPLE']);

      const { params, body } = validatedRequest(response, {
        params: bookingParamsSchema,
        body: selectLayoutBodySchema,
      });

      await checkBookingAccess(actor, params.bookingId);

      const result = await services.seatingPlan.selectLayout({
        bookingId: params.bookingId,
        layoutTemplateVersionId: body.layoutTemplateVersionId,
        expectedBookingRevision: body.expectedBookingRevision,
        accessToken: bearerToken(request) ?? '',
        requestId: request.requestId,
        actorAccountId: actor.accountId,
      });
      response.status(201).json({ data: serializePlanResult(result) });
    }),
  );

  // ── POST /bookings/:bookingId/seating-plans/:planId/revisions ────────────
  router.post(
    '/bookings/:bookingId/seating-plans/:planId/revisions',
    auth,
    createIdempotencyHandler('/bookings/{bookingId}/seating-plans/{planId}/revisions'),
    validateRequest({ params: planParamsSchema, body: saveRevisionBodySchema }),
    asyncHandler(async (request, response) => {
      const actor = requireActor(request);
      requireAnyRole(actor, ['MANAGER', 'COUPLE']);

      const { params, body } = validatedRequest(response, {
        params: planParamsSchema,
        body: saveRevisionBodySchema,
      });

      await checkBookingAccess(actor, params.bookingId);

      const result = await services.seatingPlan.saveRevision({
        bookingId: params.bookingId,
        planId: params.planId,
        expectedRevision: body.expectedRevision,
        labels: body.labels,
        ...(body.layoutTemplateVersionId !== undefined
          ? { layoutTemplateVersionId: body.layoutTemplateVersionId }
          : {}),
        accessToken: bearerToken(request) ?? '',
        requestId: request.requestId,
        actorAccountId: actor.accountId,
      });
      response.status(201).json({ data: serializePlanResult(result) });
    }),
  );

  // ── POST /bookings/:bookingId/seating-plans/:planId/confirmation ─────────
  router.post(
    '/bookings/:bookingId/seating-plans/:planId/confirmation',
    auth,
    createIdempotencyHandler('/bookings/{bookingId}/seating-plans/{planId}/confirmation'),
    validateRequest({ params: planParamsSchema, body: confirmBodySchema }),
    asyncHandler(async (request, response) => {
      const actor = requireActor(request);
      requireAnyRole(actor, ['MANAGER', 'COUPLE']);

      const { params, body } = validatedRequest(response, {
        params: planParamsSchema,
        body: confirmBodySchema,
      });

      await checkBookingAccess(actor, params.bookingId);

      const result = await services.seatingPlan.confirmPlan({
        bookingId: params.bookingId,
        planId: params.planId,
        expectedRevision: body.expectedRevision,
        expectedBookingRevision: body.expectedBookingRevision,
        accessToken: bearerToken(request) ?? '',
        requestId: request.requestId,
        actorAccountId: actor.accountId,
      });
      response.status(201).json({ data: serializePlanResult(result) });
    }),
  );

  // ── POST /management/seating-plans/:planId/exceptions ───────────────────
  router.post(
    '/management/seating-plans/:planId/exceptions',
    auth,
    createIdempotencyHandler('/management/seating-plans/{planId}/exceptions'),
    validateRequest({ params: managementPlanParamsSchema, body: exceptionBodySchema }),
    asyncHandler(async (request, response) => {
      const actor = requireActor(request);
      requireAnyRole(actor, ['MANAGER']);

      const { params, body } = validatedRequest(response, {
        params: managementPlanParamsSchema,
        body: exceptionBodySchema,
      });
      const result = await services.seatingPlan.recordManagerException({
        planId: params.planId,
        expectedRevision: body.expectedRevision,
        expectedBookingRevision: body.expectedBookingRevision,
        reason: body.reason,
        accessToken: bearerToken(request) ?? '',
        requestId: request.requestId,
        actorAccountId: actor.accountId,
      });
      response.status(201).json({ data: serializePlanResult(result) });
    }),
  );

  // ── GET /bookings/:bookingId/seating-plans/:planId ───────────────────────
  router.get(
    '/bookings/:bookingId/seating-plans/:planId',
    auth,
    validateRequest({ params: planParamsSchema }),
    asyncHandler(async (request, response) => {
      const actor = requireActor(request);
      requireAnyRole(actor, ['MANAGER', 'COUPLE']);

      const { params } = validatedRequest(response, { params: planParamsSchema });

      await checkBookingAccess(actor, params.bookingId);

      const result = await services.seatingPlan.getPlan({
        bookingId: params.bookingId,
        planId: params.planId,
        accessToken: bearerToken(request) ?? '',
        actorAccountId: actor.accountId,
      });
      response.json({ data: serializePlanResult(result) });
    }),
  );

  return router;
}

// ─── Idempotency actor scope ──────────────────────────────────────────────────

export function seatingActorScope(request: Request): string {
  const actor = authenticatedActors.get(request);
  if (actor === undefined) {
    throw new AuthenticationRequiredError();
  }
  return `account:${actor.accountId}`;
}

export function seatingIdempotencyPayload(request: Request): unknown {
  return { params: request.params, body: request.body as unknown };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createAuthMiddleware(actorResolver: AuthenticatedActorResolver): RequestHandler {
  return (request, response, next) => {
    const token = bearerToken(request);
    if (token === null) {
      return next(new AuthenticationRequiredError());
    }
    actorResolver
      .resolve(token)
      .then((actor) => {
        authenticatedActors.set(request, actor);
        next();
      })
      .catch(next);
  };
}

function requireActor(request: Request): AuthenticatedActor {
  const actor = authenticatedActors.get(request);
  if (actor === undefined) {
    throw new AuthenticationRequiredError();
  }
  return actor;
}

type AsyncRoute = (request: Request, response: Response, next: NextFunction) => Promise<unknown>;

function asyncHandler(handler: AsyncRoute): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function bearerToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (header === undefined) return null;
  const match = /^Bearer ([^\s]+)$/u.exec(header);
  return match?.[1] ?? null;
}

function serializePlanResult(result: Awaited<ReturnType<SeatingPlanService['getPlan']>>) {
  return {
    planId: result.planId,
    bookingId: result.bookingId,
    status: result.status,
    planRevision: result.planRevision,
    confirmedRevisionId: result.confirmedRevisionId,
    hasManagerException: result.hasManagerException,
    currentRevision: result.currentRevision
      ? {
          id: result.currentRevision.id,
          revisionNumber: result.currentRevision.revisionNumber,
          layoutTemplateVersionId: result.currentRevision.layoutTemplateVersionId,
          expectedAttendees: result.currentRevision.expectedAttendees,
          revisionDigest: result.currentRevision.revisionDigest,
          labels: result.currentRevision.labels,
          createdAt: result.currentRevision.createdAt.toISOString(),
        }
      : null,
  };
}

export { ForbiddenIdentityAccessError };
