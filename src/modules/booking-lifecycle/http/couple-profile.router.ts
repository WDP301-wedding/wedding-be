import { Router, type RequestHandler } from 'express';
import { validateRequest, validatedRequest } from '../../../core/http/validate.js';
import {
  createAuthenticatedActorMiddleware,
  type AuthenticatedActor,
  type AuthenticatedActorResolver,
} from '../../identity-access/authorization/authenticated-actor.middleware.js';
import {
  coupleProfileResponseSchema,
  profileWriteSchema,
  type createCoupleProfileService,
} from '../application/couple-profile.service.js';
import { consultationParamsSchema } from './booking-lifecycle.schemas.js';

export function createCoupleProfileRouter(
  service: ReturnType<typeof createCoupleProfileService>,
  resolver: AuthenticatedActorResolver,
  idempotent: RequestHandler,
) {
  const router = Router();
  const path = '/consultations/:consultationId/couple-profile';
  const authenticate = createAuthenticatedActorMiddleware(resolver);
  router.get(
    path,
    authenticate,
    validateRequest({ params: consultationParamsSchema }),
    async (_request, response) => {
      const { params } = validatedRequest(response, { params: consultationParamsSchema });
      response.set('Cache-Control', 'no-store').json(
        coupleProfileResponseSchema.parse({
          data: await service.read(
            params.consultationId,
            response.locals.actor as AuthenticatedActor,
          ),
        }),
      );
    },
  );
  router.patch(
    path,
    authenticate,
    validateRequest({ params: consultationParamsSchema, body: profileWriteSchema }),
    async (_request, response, next) => {
      response.set('Cache-Control', 'no-store');
      // Recheck scope before replaying a previously successful private response.
      const { params } = validatedRequest(response, { params: consultationParamsSchema });
      await service.read(params.consultationId, response.locals.actor as AuthenticatedActor);
      next();
    },
    idempotent,
    async (request, response) => {
      const { params, body } = validatedRequest(response, {
        params: consultationParamsSchema,
        body: profileWriteSchema,
      });
      response.set('Cache-Control', 'no-store').json(
        coupleProfileResponseSchema.parse({
          data: await service.update(
            params.consultationId,
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
