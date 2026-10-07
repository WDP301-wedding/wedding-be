import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';

import { AuthenticationRequiredError } from '../../identity-access/authorization/authenticated-actor.middleware.js';
import type { AuthenticatedActorResolver } from '../../identity-access/authorization/authenticated-actor.middleware.js';
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

export interface SeatingPlanHttpServices {
  readonly seatingPlan: SeatingPlanService;
  readonly actorResolver: AuthenticatedActorResolver;
}

export interface CreateSeatingPlanRouterOptions {
  readonly services: SeatingPlanHttpServices;
  readonly createIdempotencyHandler: (normalizedRoute: string) => RequestHandler;
}

// ─── Router factory ───────────────────────────────────────────────────────────

export function createSeatingPlanRouter(options: CreateSeatingPlanRouterOptions): Router {
  const router = Router();
  const { services, createIdempotencyHandler } = options;

  // ── GET /bookings/:bookingId/seating-layout-options ──────────────────────
  router.get(
    '/bookings/:bookingId/seating-layout-options',
    validateRequest({ params: bookingParamsSchema, query: layoutOptionsQuerySchema }),
    asyncHandler(async (request, response) => {
      const actor = await resolveActor(services.actorResolver, request);
      requireAnyRole(actor, ['MANAGER', 'COUPLE']);

      const { params } = validatedRequest(response, {
        params: bookingParamsSchema,
        query: layoutOptionsQuerySchema,
      });
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
    createIdempotencyHandler('/bookings/{bookingId}/seating-plans'),
    validateRequest({ params: bookingParamsSchema, body: selectLayoutBodySchema }),
    asyncHandler(async (request, response) => {
      const actor = await resolveActor(services.actorResolver, request);
      requireAnyRole(actor, ['MANAGER', 'COUPLE']);

      const { params, body } = validatedRequest(response, {
        params: bookingParamsSchema,
        body: selectLayoutBodySchema,
      });
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
    createIdempotencyHandler('/bookings/{bookingId}/seating-plans/{planId}/revisions'),
    validateRequest({ params: planParamsSchema, body: saveRevisionBodySchema }),
    asyncHandler(async (request, response) => {
      const actor = await resolveActor(services.actorResolver, request);
      requireAnyRole(actor, ['MANAGER', 'COUPLE']);

      const { params, body } = validatedRequest(response, {
        params: planParamsSchema,
        body: saveRevisionBodySchema,
      });
      const result = await services.seatingPlan.saveRevision({
        bookingId: params.bookingId,
        planId: params.planId,
        expectedRevision: body.expectedRevision,
        labels: body.labels,
        layoutTemplateVersionId: body.layoutTemplateVersionId,
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
    createIdempotencyHandler('/bookings/{bookingId}/seating-plans/{planId}/confirmation'),
    validateRequest({ params: planParamsSchema, body: confirmBodySchema }),
    asyncHandler(async (request, response) => {
      const actor = await resolveActor(services.actorResolver, request);
      requireAnyRole(actor, ['MANAGER', 'COUPLE']);

      const { params, body } = validatedRequest(response, {
        params: planParamsSchema,
        body: confirmBodySchema,
      });
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
    createIdempotencyHandler('/management/seating-plans/{planId}/exceptions'),
    validateRequest({ params: managementPlanParamsSchema, body: exceptionBodySchema }),
    asyncHandler(async (request, response) => {
      const actor = await resolveActor(services.actorResolver, request);
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
    validateRequest({ params: planParamsSchema }),
    asyncHandler(async (request, response) => {
      const actor = await resolveActor(services.actorResolver, request);
      requireAnyRole(actor, ['MANAGER', 'COUPLE']);

      const { params } = validatedRequest(response, { params: planParamsSchema });
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
  const auth = request.headers.authorization;
  return typeof auth === 'string' ? auth : '';
}

export function seatingIdempotencyPayload(request: Request): unknown {
  return { params: request.params, body: request.body as unknown };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

async function resolveActor(
  actorResolver: AuthenticatedActorResolver,
  request: Request,
) {
  const token = bearerToken(request);
  if (token === null) throw new AuthenticationRequiredError();
  return actorResolver.resolve(token);
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

// Re-export for use by other modules that need the ForbiddenIdentityAccessError
export { ForbiddenIdentityAccessError };
