import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { validateRequest, validatedRequest } from '../../../core/http/validate.js';
import {
  createAuthenticatedActorMiddleware,
  type AuthenticatedActor,
  type AuthenticatedActorResolver,
} from '../../identity-access/authorization/authenticated-actor.middleware.js';
import type { createCommercialContractService } from '../application/commercial-contract.service.js';
import {
  contractDraftSchema,
  contractDecisionSchema,
  contractWithdrawalSchema,
  contractsResponseSchema,
  contractResponseSchema,
  contractPreviewResponseSchema,
} from '../domain/commercial-contract.js';

const paramsSchema = z.strictObject({ bookingId: z.uuid() });
const revisionParamsSchema = paramsSchema.extend({ revisionId: z.uuid() });
const querySchema = z.strictObject({ cursor: z.uuid().optional() });
export function createCommercialContractRouter(
  service: ReturnType<typeof createCommercialContractService>,
  resolver: AuthenticatedActorResolver,
  idempotent: (path: string) => RequestHandler,
) {
  const router = Router();
  const authenticate = createAuthenticatedActorMiddleware(resolver);
  const path = '/bookings/:bookingId/contracts';
  router.post(
    path + '/preview',
    authenticate,
    validateRequest({ params: paramsSchema, query: z.strictObject({}), body: contractDraftSchema }),
    async (request, response) => {
      const { params, body } = validatedRequest(response, {
        params: paramsSchema,
        body: contractDraftSchema,
      });
      response.set('Cache-Control', 'no-store').json(
        contractPreviewResponseSchema.parse({
          data: await service.preview(
            params.bookingId,
            body,
            response.locals.actor as AuthenticatedActor,
            request.requestId,
          ),
        }),
      );
    },
  );
  router.get(
    path,
    authenticate,
    validateRequest({ params: paramsSchema, query: querySchema }),
    async (_request, response) => {
      const { params, query } = validatedRequest(response, {
        params: paramsSchema,
        query: querySchema,
      });
      response.set('Cache-Control', 'no-store').json(
        contractsResponseSchema.parse({
          data: await service.list(
            params.bookingId,
            response.locals.actor as AuthenticatedActor,
            query.cursor,
          ),
        }),
      );
    },
  );
  const scope: RequestHandler = async (_request, response, next) => {
    const { params } = validatedRequest(response, {
      params: paramsSchema.extend({ revisionId: z.uuid().optional() }),
    });
    response.set('Cache-Control', 'no-store');
    await service.authorize(
      params.bookingId,
      response.locals.actor as AuthenticatedActor,
      params.revisionId,
    );
    next();
  };
  router.post(
    path,
    authenticate,
    validateRequest({ params: paramsSchema, body: contractDraftSchema }),
    scope,
    idempotent('/bookings/{bookingId}/contracts'),
    async (request, response) => {
      const { params, body } = validatedRequest(response, {
        params: paramsSchema,
        body: contractDraftSchema,
      });
      response.status(201).json(
        contractResponseSchema.parse({
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
  for (const [action, schema, operation] of [
    ['submissions', contractDecisionSchema, service.submit],
    ['approvals', contractDecisionSchema, service.approve],
    ['withdrawals', contractWithdrawalSchema, service.withdraw],
  ] as const) {
    router.post(
      path + '/:revisionId/' + action,
      authenticate,
      validateRequest({ params: revisionParamsSchema, body: schema }),
      scope,
      idempotent('/bookings/{bookingId}/contracts/{revisionId}/' + action),
      async (request, response) => {
        const { params, body } = validatedRequest(response, {
          params: revisionParamsSchema,
          body: schema,
        });
        response.json(
          contractResponseSchema.parse({
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
  }
  router.get(
    path + '/:revisionId/pdf',
    authenticate,
    validateRequest({ params: revisionParamsSchema }),
    async (_request, response) => {
      const { params } = validatedRequest(response, { params: revisionParamsSchema });
      const result = await service.pdf(
        params.bookingId,
        params.revisionId,
        response.locals.actor as AuthenticatedActor,
      );
      response
        .set({
          'Cache-Control': 'no-store',
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="contract-' + params.revisionId + '.pdf"',
          'X-Content-SHA256': result.sha256,
        })
        .send(result.bytes);
    },
  );
  return router;
}
