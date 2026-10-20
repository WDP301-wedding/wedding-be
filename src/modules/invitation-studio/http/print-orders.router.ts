import { Router, type RequestHandler, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  AuthenticationRequiredError,
  type AuthenticatedActorResolver,
} from '../../identity-access/authorization/authenticated-actor.middleware.js';
import { IdempotencyKeyRequiredError } from '../../../core/errors/app-error.js';
import { idempotencyKeySchema } from '../../../core/idempotency/idempotency.schemas.js';
import { id, parseStudio } from '../domain/studio-policy.js';
import type { createInvitationStudioServices } from '../infrastructure/studio.composition.js';
import type { MediaRequestContext } from '../application/media.contracts.js';
import * as schemas from './print-orders.schemas.js';

type Services = ReturnType<typeof createInvitationStudioServices>;

const bookParams = z.strictObject({ bookingId: id });
const orderParams = z.strictObject({ orderId: id });
const bookOrderParams = z.strictObject({ bookingId: id, orderId: id });

const context = (res: Response) => res.locals.studioContext as MediaRequestContext;
const key = (req: Request) => {
  const value = req.get('idempotency-key');
  if (value === undefined) throw new IdempotencyKeyRequiredError();
  return parseStudio(idempotencyKeySchema, value);
};

export function createPrintOrdersRouter(
  services: Services,
  resolver: AuthenticatedActorResolver,
): Router {
  const router = Router();
  const auth: RequestHandler = (req, res, next) => {
    const token = /^Bearer ([^\s]+)$/u.exec(req.get('authorization') ?? '')?.[1];
    if (token === undefined) {
      next(new AuthenticationRequiredError());
      return;
    }
    void resolver
      .resolve(token)
      .then((actor) => {
        res.locals.studioContext = {
          actorId: actor.accountId,
          requestId: req.requestId,
          accessToken: token,
          ...(req.log ? { logger: req.log } : {}),
        } satisfies MediaRequestContext;
        res.set('Cache-Control', 'no-store');
        next();
      })
      .catch(next);
  };

  router.use(['/bookings/:bookingId/print-orders', '/management/print-orders'], auth);

  function route(
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    schema: z.ZodType,
    work: (req: Request, res: Response) => Promise<unknown>,
    status = 200,
  ) {
    router[method](path, (req, res, next) => {
      void work(req, res)
        .then((data) => res.status(status).json(schema.parse({ data })))
        .catch(next);
    });
  }

  // 1. Couple requests print order
  route(
    'post',
    '/bookings/:bookingId/print-orders',
    schemas.printOrderResponseSchema,
    (req, res) => {
      const { bookingId } = parseStudio(bookParams, req.params);
      const body = parseStudio(schemas.requestPrintOrderBodySchema, req.body);
      return services.printOrders.requestPrintOrder(bookingId, body, key(req), context(res));
    },
    201,
  );

  // 2. Couple lists print orders
  route(
    'get',
    '/bookings/:bookingId/print-orders',
    schemas.printOrderListResponseSchema,
    (req, res) => {
      const { bookingId } = parseStudio(bookParams, req.params);
      const query = parseStudio(schemas.printOrderListQuerySchema, req.query);
      return services.printOrders.listPrintOrders(bookingId, query, context(res));
    },
  );

  // 3. Couple views single print order
  route(
    'get',
    '/bookings/:bookingId/print-orders/:orderId',
    schemas.printOrderResponseSchema,
    (req, res) => {
      const { bookingId, orderId } = parseStudio(bookOrderParams, req.params);
      return services.printOrders.getPrintOrder(bookingId, orderId, context(res));
    },
  );

  // 4. Couple approves print order quote
  route(
    'post',
    '/bookings/:bookingId/print-orders/:orderId/approval',
    schemas.printOrderResponseSchema,
    (req, res) => {
      const { bookingId, orderId } = parseStudio(bookOrderParams, req.params);
      const body = parseStudio(schemas.approvePrintOrderBodySchema, req.body);
      return services.printOrders.approvePrintOrder(
        bookingId,
        orderId,
        body,
        key(req),
        context(res),
      );
    },
  );

  // 5. Couple confirms cancellation intent for approved print order
  route(
    'post',
    '/bookings/:bookingId/print-orders/:orderId/cancellation-intents',
    schemas.cancellationIntentResponseSchema,
    (req, res) => {
      const { bookingId, orderId } = parseStudio(bookOrderParams, req.params);
      const body = parseStudio(schemas.cancellationIntentBodySchema, req.body);
      return services.printOrders.recordCancellationIntent(
        bookingId,
        orderId,
        body,
        key(req),
        context(res),
      );
    },
  );

  // 6. Couple cancels print order (before approval)
  route(
    'post',
    '/bookings/:bookingId/print-orders/:orderId/cancellation',
    schemas.printOrderResponseSchema,
    (req, res) => {
      const { bookingId, orderId } = parseStudio(bookOrderParams, req.params);
      const body = parseStudio(schemas.cancelOrderBodySchema, req.body);
      return services.printOrders.cancelPrintOrder(
        bookingId,
        orderId,
        body,
        key(req),
        context(res),
        'COUPLE',
      );
    },
  );

  // 7. Couple approves replacement quote
  route(
    'post',
    '/bookings/:bookingId/print-orders/:orderId/replacement-approvals',
    schemas.printOrderResponseSchema,
    (req, res) => {
      const { bookingId, orderId } = parseStudio(bookOrderParams, req.params);
      const body = parseStudio(schemas.replacementApprovalBodySchema, req.body);
      return services.printOrders.approveReplacement(
        bookingId,
        orderId,
        body,
        key(req),
        context(res),
      );
    },
  );

  // 8. Manager lists print orders
  route('get', '/management/print-orders', schemas.printOrderListResponseSchema, (req, res) => {
    const query = parseStudio(schemas.managementPrintOrderListQuerySchema, req.query);
    return services.printOrders.listManagementPrintOrders(query, context(res));
  });

  // 9. Manager views single print order
  route(
    'get',
    '/management/print-orders/:orderId',
    schemas.printOrderResponseSchema,
    (req, res) => {
      const { orderId } = parseStudio(orderParams, req.params);
      return services.printOrders.getPrintOrder(null, orderId, context(res));
    },
  );

  // 10. Manager quotes print order
  route(
    'post',
    '/management/print-orders/:orderId/quotations',
    schemas.printOrderResponseSchema,
    (req, res) => {
      const { orderId } = parseStudio(orderParams, req.params);
      const body = parseStudio(schemas.quotePrintOrderBodySchema, req.body);
      return services.printOrders.quotePrintOrder(orderId, body, key(req), context(res));
    },
  );

  // 11. Manager transitions to IN_PRODUCTION
  route(
    'post',
    '/management/print-orders/:orderId/production',
    schemas.printOrderResponseSchema,
    (req, res) => {
      const { orderId } = parseStudio(orderParams, req.params);
      const body = parseStudio(schemas.transitionOrderBodySchema, req.body);
      return services.printOrders.startProduction(orderId, body, key(req), context(res));
    },
  );

  // 12. Manager transitions to READY_FOR_HANDOVER
  route(
    'post',
    '/management/print-orders/:orderId/ready',
    schemas.printOrderResponseSchema,
    (req, res) => {
      const { orderId } = parseStudio(orderParams, req.params);
      const body = parseStudio(schemas.transitionOrderBodySchema, req.body);
      return services.printOrders.markReadyForHandover(orderId, body, key(req), context(res));
    },
  );

  // 13. Manager transitions to HANDED_OVER
  route(
    'post',
    '/management/print-orders/:orderId/handover',
    schemas.printOrderResponseSchema,
    (req, res) => {
      const { orderId } = parseStudio(orderParams, req.params);
      const body = parseStudio(schemas.handoverOrderBodySchema, req.body);
      return services.printOrders.markHandedOver(orderId, body, key(req), context(res));
    },
  );

  // 14. Manager cancels print order
  route(
    'post',
    '/management/print-orders/:orderId/cancellation',
    schemas.printOrderResponseSchema,
    (req, res) => {
      const { orderId } = parseStudio(orderParams, req.params);
      const body = parseStudio(schemas.cancelOrderBodySchema, req.body);
      return services.printOrders.cancelPrintOrder(
        null,
        orderId,
        body,
        key(req),
        context(res),
        'MANAGER',
      );
    },
  );

  // 15. Manager proposes replacement quotation
  route(
    'post',
    '/management/print-orders/:orderId/replacement-proposals',
    schemas.printOrderResponseSchema,
    (req, res) => {
      const { orderId } = parseStudio(orderParams, req.params);
      const body = parseStudio(schemas.replacementProposalBodySchema, req.body);
      return services.printOrders.proposeReplacement(orderId, body, key(req), context(res));
    },
  );

  return router;
}
