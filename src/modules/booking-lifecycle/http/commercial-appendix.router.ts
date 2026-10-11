import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { validateRequest, validatedRequest } from '../../../core/http/validate.js';
import {
  createAuthenticatedActorMiddleware,
  type AuthenticatedActor,
  type AuthenticatedActorResolver,
} from '../../identity-access/authorization/authenticated-actor.middleware.js';
import type { createCommercialAppendixService } from '../application/commercial-appendix.service.js';
import {
  appendixDraftSchema,
  appendixDecisionSchema,
  appendixResponseSchema,
  appendicesResponseSchema,
} from '../domain/commercial-appendix.js';

const paramsSchema = z.strictObject({ bookingId: z.uuid() });
const revisionParams = paramsSchema.extend({ revisionId: z.uuid() });
const querySchema = z.strictObject({ cursor: z.uuid().optional() });
export function createCommercialAppendixRouter(
  service: ReturnType<typeof createCommercialAppendixService>,
  resolver: AuthenticatedActorResolver,
  idempotent: (path: string) => RequestHandler,
) {
  const router = Router(),
    authenticate = createAuthenticatedActorMiddleware(resolver);
  const path = '/bookings/:bookingId/contract-appendices';
  const scope: RequestHandler = async (_request, response, next) => {
    const { params } = validatedRequest(response, {
      params: paramsSchema.extend({ revisionId: z.uuid().optional() }),
    });
    await service.authorize(
      params.bookingId,
      response.locals.actor as AuthenticatedActor,
      params.revisionId,
    );
    response.set('Cache-Control', 'no-store');
    next();
  };
  router.get(
    path,
    authenticate,
    validateRequest({ params: paramsSchema, query: querySchema }),
    async (_request, response) => {
      const { params, query } = validatedRequest(response, {
        params: paramsSchema,
        query: querySchema,
      });
      response
        .set('Cache-Control', 'no-store')
        .json(
          appendicesResponseSchema.parse({
            data: await service.list(
              params.bookingId,
              response.locals.actor as AuthenticatedActor,
              query.cursor,
            ),
          }),
        );
    },
  );
  router.post(
    path,
    authenticate,
    validateRequest({ params: paramsSchema, body: appendixDraftSchema }),
    scope,
    idempotent('/bookings/{bookingId}/contract-appendices'),
    async (request, response) => {
      const { params, body } = validatedRequest(response, {
        params: paramsSchema,
        body: appendixDraftSchema,
      });
      response
        .status(201)
        .json(
          appendixResponseSchema.parse({
            data: await service.create(
              params.bookingId,
              body,
              response.locals.actor as AuthenticatedActor,
              request.requestId,
            ),
          }),
        );
    },
  );
  for (const [action, operation] of [
    ['submissions', service.submit],
    ['approvals', service.approve],
  ] as const)
    router.post(
      path + '/:revisionId/' + action,
      authenticate,
      validateRequest({ params: revisionParams, body: appendixDecisionSchema }),
      scope,
      idempotent('/bookings/{bookingId}/contract-appendices/{revisionId}/' + action),
      async (request, response) => {
        const { params, body } = validatedRequest(response, {
          params: revisionParams,
          body: appendixDecisionSchema,
        });
        response.json(
          appendixResponseSchema.parse({
            data: await operation(
              params.bookingId,
              params.revisionId,
              body,
              response.locals.actor as AuthenticatedActor,
              request.requestId,
            ),
          }),
        );
      },
    );
  return router;
}
