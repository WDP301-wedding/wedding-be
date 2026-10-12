import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  createAuthenticatedActorMiddleware,
  type AuthenticatedActorResolver,
  type AuthenticatedActor,
} from '../../identity-access/authorization/authenticated-actor.middleware.js';
import { requireAnyRole } from '../../identity-access/authorization/authorization.service.js';
import { validateRequest, validatedRequest } from '../../../core/http/validate.js';
import type { AnalyticsService } from '../application/analytics.service.js';
import type { ContractContext } from '../../../core/database/booking-boundary.js';
import {
  analyticsQuerySchema,
  analyticsResultSchemas,
  rebuildBodySchema,
  projectionResultSchema,
} from './analytics.schemas.js';
export function createAnalyticsRouter(
  service: AnalyticsService,
  resolver: AuthenticatedActorResolver,
  audit: (
    context: ContractContext,
    action: string,
    metadata: {
      generationId: string;
      reason?: string;
      filters?: {
        dateFrom: string;
        dateTo: string;
        hallId?: string;
        phase?: string;
        menuPackageId?: string;
      };
      resultSize?: number;
    },
  ) => Promise<void>,
) {
  const router = Router();
  router.use(
    '/management/analytics',
    (req, res, next) => {
      res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      next();
    },
    createAuthenticatedActorMiddleware(resolver),
    (req, res, next) => {
      try {
        requireAnyRole(res.locals.actor as AuthenticatedActor, ['MANAGER']);
        next();
      } catch (error) {
        next(error);
      }
    },
  );
  const context = (req: Request, res: Response): ContractContext => ({
    authority: 'AUTHENTICATED',
    actorAccountId: (res.locals.actor as AuthenticatedActor).accountId,
    requestId: req.requestId,
    causationId: req.requestId,
  });
  for (const report of Object.keys(
    analyticsResultSchemas,
  ) as (keyof typeof analyticsResultSchemas)[]) {
    router.get(
      '/management/analytics/' + report,
      validateRequest({ query: analyticsQuerySchema }),
      async (req, res) => {
        const q = validatedRequest(res, { query: analyticsQuerySchema }).query;
        res.json({
          data: analyticsResultSchemas[report].parse(
            await service.query(report, q, context(req, res)),
          ),
        });
      },
    );
  }
  router.get(
    '/management/analytics/exports/overview',
    validateRequest({ query: analyticsQuerySchema }),
    async (req, res) => {
      const q = validatedRequest(res, { query: analyticsQuerySchema }).query,
        c = context(req, res);
      const result = analyticsResultSchemas.overview.parse(await service.query('overview', q, c));
      await audit(c, 'analytics.exported', {
        generationId: result.meta.generationId!,
        filters: {
          dateFrom: q.dateFrom,
          dateTo: q.dateTo,
          ...(q.hallId ? { hallId: q.hallId } : {}),
          ...(q.phase ? { phase: q.phase } : {}),
          ...(q.menuPackageId ? { menuPackageId: q.menuPackageId } : {}),
        },
        resultSize: 1,
      });
      res
        .set('Content-Disposition', 'attachment; filename="analytics-overview.json"')
        .json({ data: result });
    },
  );
  router.post(
    '/management/analytics/rebuild',
    validateRequest({ body: rebuildBodySchema, query: z.strictObject({}) }),
    async (req, res) => {
      const c = context(req, res),
        input = validatedRequest(res, { body: rebuildBodySchema }).body;
      const generationId = await service.projector.refresh(c.actorAccountId!, c, true);
      await audit(c, 'analytics.rebuilt', { reason: input.reason, generationId });
      res.json({ data: projectionResultSchema.parse({ generationId }) });
    },
  );
  return router;
}
