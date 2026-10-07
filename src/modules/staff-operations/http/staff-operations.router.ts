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
import { requireAnyRole } from '../../identity-access/authorization/authorization.service.js';
import { validateRequest, validatedRequest } from '../../../core/http/validate.js';
import type { StaffOperationsService, StaffActorContext } from '../application/staff-operations.service.js';
import {
  assignmentParamsSchema,
  assignStaffBodySchema,
  attendanceHistoryQuerySchema,
  bookingParamsSchema,
  householdParamsSchema,
  householdSearchQuerySchema,
  operationalAccessBodySchema,
  provisionStaffAccountBodySchema,
  recordArrivalBodySchema,
  recordCorrectionBodySchema,
  revokeAssignmentBodySchema,
  staffAccountParamsSchema,
} from './staff-operations.schemas.js';

export interface StaffOperationsHttpServices {
  readonly staffOperations: StaffOperationsService;
  readonly actorResolver: AuthenticatedActorResolver;
}

export interface CreateStaffOperationsRouterOptions {
  readonly services: StaffOperationsHttpServices;
  readonly createIdempotencyHandler: (normalizedRoute: string) => RequestHandler;
}

export function createStaffOperationsRouter(
  options: CreateStaffOperationsRouterOptions,
): Router {
  const router = Router();
  const { services, createIdempotencyHandler } = options;

  // ─── Management: Provisioning & Operational Access ─────────────────────────

  // POST /management/staff-accounts
  router.post(
    '/management/staff-accounts',
    createIdempotencyHandler('/management/staff-accounts'),
    validateRequest({ body: provisionStaffAccountBodySchema }),
    asyncHandler(async (request, response) => {
      const actor = await resolveActor(services.actorResolver, request);
      const manager = requireAnyRole(actor, ['MANAGER']);

      const { body } = validatedRequest(response, {
        body: provisionStaffAccountBodySchema,
      });

      const result = await services.staffOperations.provisionStaffAccount(
        body.email,
        body.commandKey,
        { accountId: manager.accountId, role: 'MANAGER' },
      );

      response.status(201).json({ data: result });
    }),
  );

  // POST /management/staff-accounts/:id/operational-access
  router.post(
    '/management/staff-accounts/:id/operational-access',
    createIdempotencyHandler('/management/staff-accounts/{id}/operational-access'),
    validateRequest({
      params: staffAccountParamsSchema,
      body: operationalAccessBodySchema,
    }),
    asyncHandler(async (request, response) => {
      const actor = await resolveActor(services.actorResolver, request);
      const manager = requireAnyRole(actor, ['MANAGER']);

      const { params, body } = validatedRequest(response, {
        params: staffAccountParamsSchema,
        body: operationalAccessBodySchema,
      });

      await services.staffOperations.setStaffOperationalAccess(
        params.id,
        body.enabled,
        body.reason,
        { accountId: manager.accountId, role: 'MANAGER' },
      );

      response.status(200).json({ data: { success: true } });
    }),
  );

  // ─── Management: Event Assignments ──────────────────────────────────────────

  // GET /management/events/:bookingId/assignments
  router.get(
    '/management/events/:bookingId/assignments',
    validateRequest({ params: bookingParamsSchema }),
    asyncHandler(async (request, response) => {
      const actor = await resolveActor(services.actorResolver, request);
      const authorized = requireAnyRole(actor, ['MANAGER', 'STAFF']);

      const { params } = validatedRequest(response, {
        params: bookingParamsSchema,
      });

      const assignments = await services.staffOperations.listAssignments(
        params.bookingId,
        toStaffActor(authorized),
      );

      response.json({ data: { items: assignments } });
    }),
  );

  // POST /management/events/:bookingId/assignments
  router.post(
    '/management/events/:bookingId/assignments',
    createIdempotencyHandler('/management/events/{bookingId}/assignments'),
    validateRequest({
      params: bookingParamsSchema,
      body: assignStaffBodySchema,
    }),
    asyncHandler(async (request, response) => {
      const actor = await resolveActor(services.actorResolver, request);
      const manager = requireAnyRole(actor, ['MANAGER']);

      const { params, body } = validatedRequest(response, {
        params: bookingParamsSchema,
        body: assignStaffBodySchema,
      });

      const created = await services.staffOperations.assignStaff(
        params.bookingId,
        body.staffAccountId,
        { accountId: manager.accountId, role: 'MANAGER' },
      );

      response.status(201).json({ data: created });
    }),
  );

  // POST /management/events/:bookingId/assignments/:id/revocation
  router.post(
    '/management/events/:bookingId/assignments/:id/revocation',
    createIdempotencyHandler('/management/events/{bookingId}/assignments/{id}/revocation'),
    validateRequest({
      params: assignmentParamsSchema,
      body: revokeAssignmentBodySchema,
    }),
    asyncHandler(async (request, response) => {
      const actor = await resolveActor(services.actorResolver, request);
      const manager = requireAnyRole(actor, ['MANAGER']);

      const { params, body } = validatedRequest(response, {
        params: assignmentParamsSchema,
        body: revokeAssignmentBodySchema,
      });

      const revoked = await services.staffOperations.revokeAssignment(
        params.bookingId,
        params.id,
        body.expectedRevision,
        body.reason,
        { accountId: manager.accountId, role: 'MANAGER' },
      );

      response.status(200).json({ data: revoked });
    }),
  );

  // ─── Staff: Operations Search, Check-In & Corrections ──────────────────────

  // GET /staff/events/:bookingId/households/search
  router.get(
    '/staff/events/:bookingId/households/search',
    validateRequest({
      params: bookingParamsSchema,
      query: householdSearchQuerySchema,
    }),
    asyncHandler(async (request, response) => {
      const actor = await resolveActor(services.actorResolver, request);
      const authorized = requireAnyRole(actor, ['MANAGER', 'STAFF']);

      const { params, query } = validatedRequest(response, {
        params: bookingParamsSchema,
        query: householdSearchQuerySchema,
      });

      const result = await services.staffOperations.searchHouseholds(
        params.bookingId,
        query,
        toStaffActor(authorized),
      );

      response.json({ data: result });
    }),
  );

  // POST /staff/events/:bookingId/households/:id/arrivals
  router.post(
    '/staff/events/:bookingId/households/:id/arrivals',
    createIdempotencyHandler('/staff/events/{bookingId}/households/{id}/arrivals'),
    validateRequest({
      params: householdParamsSchema,
      body: recordArrivalBodySchema,
    }),
    asyncHandler(async (request, response) => {
      const actor = await resolveActor(services.actorResolver, request);
      const authorized = requireAnyRole(actor, ['MANAGER', 'STAFF']);

      const { params, body } = validatedRequest(response, {
        params: householdParamsSchema,
        body: recordArrivalBodySchema,
      });

      const result = await services.staffOperations.recordArrival(
        params.bookingId,
        params.id,
        {
          attendeeCount: body.attendeeCount,
          eventTime: body.eventTime ? new Date(body.eventTime) : undefined,
          managerOverrideReason: body.managerOverrideReason,
        },
        toStaffActor(authorized),
      );

      response.status(201).json({ data: result });
    }),
  );

  // POST /staff/events/:bookingId/households/:id/corrections
  router.post(
    '/staff/events/:bookingId/households/:id/corrections',
    createIdempotencyHandler('/staff/events/{bookingId}/households/{id}/corrections'),
    validateRequest({
      params: householdParamsSchema,
      body: recordCorrectionBodySchema,
    }),
    asyncHandler(async (request, response) => {
      const actor = await resolveActor(services.actorResolver, request);
      const authorized = requireAnyRole(actor, ['MANAGER', 'STAFF']);

      const { params, body } = validatedRequest(response, {
        params: householdParamsSchema,
        body: recordCorrectionBodySchema,
      });

      const result = await services.staffOperations.recordCorrection(
        params.bookingId,
        params.id,
        {
          arrivalId: body.arrivalId,
          delta: body.delta,
          expectedLedgerRevision: body.expectedLedgerRevision,
          reason: body.reason,
        },
        toStaffActor(authorized),
      );

      response.status(200).json({ data: result });
    }),
  );

  // GET /staff/events/:bookingId/households/:id/attendance
  router.get(
    '/staff/events/:bookingId/households/:id/attendance',
    validateRequest({
      params: householdParamsSchema,
      query: attendanceHistoryQuerySchema,
    }),
    asyncHandler(async (request, response) => {
      const actor = await resolveActor(services.actorResolver, request);
      const authorized = requireAnyRole(actor, ['MANAGER', 'STAFF']);

      const { params } = validatedRequest(response, {
        params: householdParamsSchema,
        query: attendanceHistoryQuerySchema,
      });

      const result = await services.staffOperations.getHouseholdAttendance(
        params.bookingId,
        params.id,
        toStaffActor(authorized),
      );

      response.json({ data: result });
    }),
  );

  return router;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

function bearerToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

async function resolveActor(
  resolver: AuthenticatedActorResolver,
  request: Request,
): Promise<AuthenticatedActor> {
  const token = bearerToken(request);
  if (token === null) throw new AuthenticationRequiredError();
  return resolver.resolve(token);
}

function toStaffActor(actor: { accountId: string; role: string }): StaffActorContext {
  return {
    accountId: actor.accountId,
    role: actor.role as 'MANAGER' | 'STAFF',
  };
}

export function staffIdempotencyPayload(request: Request): unknown {
  return {
    params: request.params,
    query: request.query,
    body: request.body as unknown,
  };
}

export const staffActorScope = (request: Request): string => {
  const auth = request.headers.authorization;
  return typeof auth === 'string' ? auth : '';
};
