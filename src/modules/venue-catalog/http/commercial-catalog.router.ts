import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import { validateRequest, validatedRequest } from '../../../core/http/validate.js';
import { AppError } from '../../../core/errors/app-error.js';
import {
  createAuthenticatedActorMiddleware,
  type AuthenticatedActor,
  type AuthenticatedActorResolver,
} from '../../identity-access/authorization/authenticated-actor.middleware.js';
import { authorizeCatalogManager } from '../application/venue-catalog.provider.js';
import type { createRestaurantServiceService } from '../application/restaurant-service.service.js';
import type { createPrintOfferingService } from '../application/print-offering.service.js';
import type { CatalogMutationContext } from '../infrastructure/catalog-version.repository.js';
import {
  createServiceSchema,
  reviseServiceSchema,
  createPrintOfferingSchema,
  revisePrintOfferingSchema,
} from '../domain/commercial-offering.js';

export const offeringParamsSchema = z.strictObject({ id: z.uuid() });
export const offeringPageSchema = z.strictObject({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export function commercialActorScope(request: Request) {
  return (request.res!.locals.actor as AuthenticatedActor).accountId;
}
export function createCommercialCatalogRouter(
  service: ReturnType<typeof createRestaurantServiceService>,
  resolver: AuthenticatedActorResolver,
  idempotent: (path: string) => RequestHandler,
) {
  return createOfferingRouter(
    'services',
    service,
    createServiceSchema,
    reviseServiceSchema,
    resolver,
    idempotent,
  );
}

export function createPrintCommercialCatalogRouter(
  service: ReturnType<typeof createPrintOfferingService>,
  resolver: AuthenticatedActorResolver,
  idempotent: (path: string) => RequestHandler,
) {
  return createOfferingRouter(
    'print-offerings',
    service,
    createPrintOfferingSchema,
    revisePrintOfferingSchema,
    resolver,
    idempotent,
  );
}

interface OfferingHttpService {
  list(includeArchived: boolean, cursor: string | undefined, limit: number): Promise<unknown>;
  create(value: unknown, context: CatalogMutationContext): Promise<unknown>;
  revise(id: string, value: unknown, context: CatalogMutationContext): Promise<unknown>;
}
function createOfferingRouter(
  kind: string,
  service: OfferingHttpService,
  createSchema: z.ZodType,
  reviseSchema: z.ZodType,
  resolver: AuthenticatedActorResolver,
  idempotent: (path: string) => RequestHandler,
) {
  const router = Router();
  const auth = createAuthenticatedActorMiddleware(resolver);
  const manager: RequestHandler = (request, response, next) => {
    try {
      authorizeCatalogManager(response.locals.actor as AuthenticatedActor, request.requestId);
      next();
    } catch (error) {
      next(error);
    }
  };
  const selection: RequestHandler = (_request, response, next) => {
    const actor = response.locals.actor as AuthenticatedActor;
    if (
      actor.roles.includes('STAFF') &&
      !actor.roles.some((role) => role === 'MANAGER' || role === 'COUPLE')
    )
      return next(
        new AppError({ status: 403, code: 'FORBIDDEN', message: 'The request is forbidden.' }),
      );
    next();
  };
  router.get(
    '/catalog/' + kind,
    auth,
    selection,
    validateRequest({ query: offeringPageSchema }),
    async (_request, response) => {
      const { query } = validatedRequest(response, { query: offeringPageSchema });
      response
        .set('Cache-Control', 'no-store')
        .json({ data: await service.list(false, query.cursor, query.limit) });
    },
  );
  router.get(
    '/management/' + kind,
    auth,
    manager,
    validateRequest({ query: offeringPageSchema }),
    async (_request, response) => {
      const { query } = validatedRequest(response, { query: offeringPageSchema });
      response
        .set('Cache-Control', 'no-store')
        .json({ data: await service.list(true, query.cursor, query.limit) });
    },
  );
  router.post(
    '/management/' + kind,
    auth,
    manager,
    validateRequest({ body: createSchema }),
    idempotent('/management/' + kind),
    async (request, response) => {
      const { body } = validatedRequest(response, { body: createSchema });
      response
        .set('Cache-Control', 'no-store')
        .status(201)
        .json({
          data: await service.create(
            body,
            authorizeCatalogManager(response.locals.actor as AuthenticatedActor, request.requestId),
          ),
        });
    },
  );
  router.patch(
    '/management/' + kind + '/:id',
    auth,
    manager,
    validateRequest({ params: offeringParamsSchema, body: reviseSchema }),
    idempotent('/management/' + kind + '/{id}'),
    async (request, response) => {
      const { params, body } = validatedRequest(response, {
        params: offeringParamsSchema,
        body: reviseSchema,
      });
      response.set('Cache-Control', 'no-store').json({
        data: await service.revise(
          params.id,
          body,
          authorizeCatalogManager(response.locals.actor as AuthenticatedActor, request.requestId),
        ),
      });
    },
  );
  return router;
}
