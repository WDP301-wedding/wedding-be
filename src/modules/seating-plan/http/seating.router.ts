import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  createAuthenticatedActorMiddleware,
  type AuthenticatedActorResolver,
  type AuthenticatedActor,
} from '../../identity-access/authorization/authenticated-actor.middleware.js';
import { validateRequest, validatedRequest } from '../../../core/http/validate.js';
import {
  IdempotencyKeyRequiredError,
  InvalidIdempotencyKeyError,
} from '../../../core/errors/app-error.js';
import { idempotencyKeySchema } from '../../../core/idempotency/idempotency.schemas.js';
import {
  confirmationInput,
  exceptionInput,
  id,
  revisionInput,
  selectInput,
} from '../domain/seating-policy.js';
import { planViewSchema, type SeatingService } from '../application/seating.service.js';
export const bookingParams = z.strictObject({ bookingId: id });
export const planParams = bookingParams.extend({ planId: id });
export const exceptionParams = z.strictObject({ planId: id });
export const emptyQuery = z.strictObject({});
export const optionsSchema = z.strictObject({
  planningHeadcount: z.int().nonnegative(),
  bookingRevision: z.int().positive(),
  items: z.array(
    z.strictObject({
      layoutTemplateVersionId: id,
      name: z.string(),
      minGuests: z.int().positive(),
      maxGuests: z.int().positive(),
      totalSeatCapacity: z.int().positive(),
      compatible: z.boolean(),
      warning: z
        .enum(['HEADCOUNT_OUTSIDE_LAYOUT_RANGE', 'EXCEPTION_EXCEEDS_PHYSICAL_CAPACITY'])
        .nullable(),
    }),
  ),
});
export function createSeatingRouter(service: SeatingService, resolver: AuthenticatedActorResolver) {
  const router = Router(),
    authenticate = createAuthenticatedActorMiddleware(resolver);
  const context = (req: Request, res: Response) => ({
    actorId: (res.locals.actor as AuthenticatedActor).accountId,
    requestId: req.requestId,
    accessToken: req.get('authorization')!.slice(7),
  });
  const key = (req: Request) => {
    const value = req.get('idempotency-key');
    if (value === undefined) throw new IdempotencyKeyRequiredError();
    const parsed = idempotencyKeySchema.safeParse(value);
    if (!parsed.success) throw new InvalidIdempotencyKeyError();
    return parsed.data;
  };
  const output = (value: unknown) => ({ data: planViewSchema.parse(value) });
  router.use((req, res, next) => {
    if (
      /^\/bookings\/[^/]+\/seating-/u.test(req.path) ||
      req.path.startsWith('/management/seating-plans/')
    )
      res.set({ 'Cache-Control': 'no-store' });
    next();
  });
  const root = '/bookings/:bookingId/seating-plans',
    selected = `${root}/:planId`;
  router.get(
    '/bookings/:bookingId/seating-layout-options',
    authenticate,
    validateRequest({ params: bookingParams, query: emptyQuery }),
    async (req, res) => {
      const { params } = validatedRequest(res, { params: bookingParams });
      res.json({
        data: optionsSchema.parse(await service.options(params.bookingId, context(req, res))),
      });
    },
  );
  router.post(
    root,
    authenticate,
    validateRequest({ params: bookingParams, query: emptyQuery, body: selectInput }),
    async (req, res) => {
      const { params, body } = validatedRequest(res, { params: bookingParams, body: selectInput });
      res
        .status(201)
        .json(output(await service.select(params.bookingId, body, key(req), context(req, res))));
    },
  );
  router.get(
    selected,
    authenticate,
    validateRequest({ params: planParams, query: emptyQuery }),
    async (req, res) => {
      const { params } = validatedRequest(res, { params: planParams });
      res.json(output(await service.read(params.bookingId, params.planId, context(req, res))));
    },
  );
  router.post(
    `${selected}/revisions`,
    authenticate,
    validateRequest({ params: planParams, query: emptyQuery, body: revisionInput }),
    async (req, res) => {
      const { params, body } = validatedRequest(res, { params: planParams, body: revisionInput });
      res
        .status(201)
        .json(
          output(
            await service.revise(
              params.bookingId,
              params.planId,
              body,
              key(req),
              context(req, res),
            ),
          ),
        );
    },
  );
  router.post(
    `${selected}/confirmation`,
    authenticate,
    validateRequest({ params: planParams, query: emptyQuery, body: confirmationInput }),
    async (req, res) => {
      const { params, body } = validatedRequest(res, {
        params: planParams,
        body: confirmationInput,
      });
      res
        .status(201)
        .json(
          output(
            await service.confirm(
              params.bookingId,
              params.planId,
              body,
              key(req),
              context(req, res),
            ),
          ),
        );
    },
  );
  router.post(
    '/management/seating-plans/:planId/exceptions',
    authenticate,
    validateRequest({ params: exceptionParams, query: emptyQuery, body: exceptionInput }),
    async (req, res) => {
      const { params, body } = validatedRequest(res, {
        params: exceptionParams,
        body: exceptionInput,
      });
      const ctx = context(req, res),
        bookingId = await service.bookingForPlan(params.planId, ctx);
      res
        .status(201)
        .json(output(await service.confirm(bookingId, params.planId, body, key(req), ctx, true)));
    },
  );
  return router;
}
