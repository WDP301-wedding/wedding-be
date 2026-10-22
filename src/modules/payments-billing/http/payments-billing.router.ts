import { Router, type RequestHandler, type ErrorRequestHandler } from 'express';
import {
  AppError,
  IdempotencyKeyRequiredError,
  InvalidIdempotencyKeyError,
} from '../../../core/errors/app-error.js';
import { readIdempotencyKey } from '../../../core/idempotency/idempotency.policy.js';
import { validateRequest, validatedRequest } from '../../../core/http/validate.js';
import {
  createAuthenticatedActorMiddleware,
  type AuthenticatedActor,
  type AuthenticatedActorResolver,
} from '../../identity-access/authorization/authenticated-actor.middleware.js';
import type { PaymentsBillingHttpServices } from './payments-billing.http-services.js';
import {
  bookingParamsSchema,
  attemptParamsSchema,
  depositBodySchema,
  balanceBodySchema,
  manualBodySchema,
  refundBodySchema,
  refundApprovalBodySchema,
  billingQuerySchema,
  billingResponseSchema,
  ipnResponseSchema,
} from './payments-billing.schemas.js';

export function createPaymentsBillingRouter(
  options: Readonly<{
    services: PaymentsBillingHttpServices;
    resolveActor: AuthenticatedActorResolver;
  }>,
) {
  const router = Router();
  const services = options.services;
  const authenticate = createAuthenticatedActorMiddleware(options.resolveActor);
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });
  // Preserve the raw query: Express's parsed query loses duplicate provider keys.
  router.get(
    '/billing/callbacks/vnpay',
    handle(async (request, response) => {
      const index = request.originalUrl.indexOf('?');
      response
        .status(200)
        .json(
          ipnResponseSchema.parse(
            await services.ipn(index < 0 ? '' : request.originalUrl.slice(index + 1)),
          ),
        );
    }),
  );
  const writes = [
    ['DEPOSIT', '/bookings/:bookingId/payments/deposit', depositBodySchema, bookingParamsSchema],
    ['BALANCE', '/bookings/:bookingId/payments/balance', balanceBodySchema, bookingParamsSchema],
    ['MANUAL', '/management/billing/payments/manual', manualBodySchema, undefined],
    ['REFUND', '/management/billing/refunds', refundBodySchema, undefined],
    ['APPROVAL', '/management/billing/refund-approvals', refundApprovalBodySchema, undefined],
  ] as const;
  for (const [operation, path, bodySchema, paramsSchema] of writes) {
    const schemas = {
      body: bodySchema,
      ...(paramsSchema === undefined ? {} : { params: paramsSchema }),
    };
    router.post(
      path,
      authenticate,
      validateRequest(schemas),
      handle(async (request, response) => {
        const header = readIdempotencyKey(request);
        if (header.outcome === 'MISSING') throw new IdempotencyKeyRequiredError();
        if (header.outcome === 'INVALID') throw new InvalidIdempotencyKeyError();
        const parsed = validatedRequest(response, schemas);
        const result = await services.mutate({
          operation,
          ...(paramsSchema === undefined
            ? {}
            : {
                bookingId: validatedRequest(response, { params: bookingParamsSchema }).params
                  .bookingId,
              }),
          body: parsed.body,
          key: header.key,
          actor: response.locals.actor as AuthenticatedActor,
          requestId: request.requestId,
          ip: request.ip ?? request.socket.remoteAddress ?? '127.0.0.1',
        });
        response.status(result.status).json(result.body);
      }),
    );
  }
  router.get(
    '/bookings/:bookingId/payments/active',
    authenticate,
    validateRequest({ params: bookingParamsSchema }),
    handle(async (_request, response) => {
      const { params } = validatedRequest(response, { params: bookingParamsSchema });
      response.json(
        await services.activeAttempts(
          params.bookingId,
          response.locals.actor as AuthenticatedActor,
        ),
      );
    }),
  );
  router.get(
    '/bookings/:bookingId/payments/:attemptId',
    authenticate,
    validateRequest({ params: attemptParamsSchema }),
    handle(async (request, response) => {
      const { params } = validatedRequest(response, { params: attemptParamsSchema });
      response.json(
        await services.attempt(
          params.bookingId,
          params.attemptId,
          response.locals.actor as AuthenticatedActor,
          request.requestId,
        ),
      );
    }),
  );
  router.get(
    '/bookings/:bookingId/billing',
    authenticate,
    validateRequest({ params: bookingParamsSchema, query: billingQuerySchema }),
    handle(async (request, response) => {
      const { params, query } = validatedRequest(response, {
        params: bookingParamsSchema,
        query: billingQuerySchema,
      });
      response.json(
        billingResponseSchema.parse({
          data: await services.read(
            params.bookingId,
            query,
            response.locals.actor as AuthenticatedActor,
            request.requestId,
          ),
        }),
      );
    }),
  );
  router.use(services.commercialRouter(options.resolveActor));
  const denialAudit: ErrorRequestHandler = (error: unknown, request, response, next) => {
    if (!(error instanceof AppError) || ![401, 403, 404].includes(error.status)) return next(error);
    const actor = response.locals.actor as AuthenticatedActor | undefined;
    void services
      .auditDenial(
        request.requestId,
        actor?.accountId ?? null,
        request.route === undefined ? 'billing' : (request.route as { path: string }).path,
        error,
      )
      .then(() => next(error))
      .catch(next);
  };
  router.use(denialAudit);
  return router;
}
function handle(
  handler: (
    request: Parameters<RequestHandler>[0],
    response: Parameters<RequestHandler>[1],
  ) => Promise<void>,
): RequestHandler {
  return (request, response, next) => {
    void handler(request, response).catch(next);
  };
}
