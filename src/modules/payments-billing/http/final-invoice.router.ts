import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { validateRequest, validatedRequest } from '../../../core/http/validate.js';
import { createIdempotencyMiddleware } from '../../../core/idempotency/idempotency.middleware.js';
import { createIdempotencyService } from '../../../core/idempotency/idempotency.service.js';
import { createPrismaIdempotencyRepository } from '../../../core/idempotency/idempotency.repository.js';
import { defineIdempotencyPolicy } from '../../../core/idempotency/idempotency.policy.js';
import {
  createAuthenticatedActorMiddleware,
  type AuthenticatedActor,
  type AuthenticatedActorResolver,
} from '../../identity-access/authorization/authenticated-actor.middleware.js';
import type { createIncidentalExpenseService } from '../application/incidental-expense.service.js';
import type { createFinalInvoiceService } from '../application/final-invoice.service.js';
import {
  createExpenseSchema,
  updateExpenseSchema,
  deleteExpenseSchema,
  expenseDraftResponseSchema,
  finalizeInvoiceSchema,
  invoiceAdjustmentSchema,
  finalInvoiceResponseSchema,
  finalInvoiceViewSchema,
} from '../domain/final-invoice.js';

const params = z.strictObject({ bookingId: z.uuid() });
const lineParams = params.extend({ lineId: z.uuid() });
const invoiceParams = params.extend({ invoiceRevisionId: z.uuid() });
const query = z.strictObject({ cursor: z.uuid().optional() });
export const finalInvoicesResponseSchema = z.strictObject({
  data: z.strictObject({
    bookingId: z.uuid(),
    currentRevisionId: z.uuid().nullable(),
    revisions: z.array(finalInvoiceViewSchema).max(50),
    nextCursor: z.uuid().nullable(),
  }),
});
export function createFinalInvoiceRouter(
  prisma: PrismaClient,
  services: {
    expenses: ReturnType<typeof createIncidentalExpenseService>;
    invoices: ReturnType<typeof createFinalInvoiceService>;
  },
  resolver: AuthenticatedActorResolver,
) {
  const router = Router(),
    authenticate = createAuthenticatedActorMiddleware(resolver),
    idempotency = createIdempotencyService(createPrismaIdempotencyRepository(prisma));
  const actor = (response: Parameters<RequestHandler>[1]) =>
    response.locals.actor as AuthenticatedActor;
  const manager: RequestHandler = async (request, response, next) => {
    const input = validatedRequest(response, {
      params: params.extend({ lineId: z.uuid().optional() }),
    });
    await services.expenses.authorize(
      input.params.bookingId,
      actor(response),
      request.requestId,
      true,
    );
    response.set('Cache-Control', 'no-store');
    next();
  };
  const idempotent = (normalizedRoute: string) =>
    createIdempotencyMiddleware({
      service: idempotency,
      policy: defineIdempotencyPolicy({
        actorScope: (request) => (request.res!.locals.actor as AuthenticatedActor).accountId,
        normalizedRoute,
        operationVersion: 'v1',
        payload: (request) => ({
          params: request.params,
          query: request.query,
          body: request.body as unknown,
        }),
      }),
    });
  const expensePath = '/management/bookings/:bookingId/incidental-expenses';
  for (const path of [expensePath, '/bookings/:bookingId/incidental-expenses'])
    router.get(path, authenticate, validateRequest({ params }), async (request, response) => {
      const input = validatedRequest(response, { params });
      response.set('Cache-Control', 'no-store').json(
        expenseDraftResponseSchema.parse({
          data: await services.expenses.read(
            input.params.bookingId,
            actor(response),
            request.requestId,
          ),
        }),
      );
    });
  router.post(
    expensePath,
    authenticate,
    validateRequest({ params, body: createExpenseSchema }),
    manager,
    idempotent('/management/bookings/{bookingId}/incidental-expenses'),
    async (request, response) => {
      const input = validatedRequest(response, { params, body: createExpenseSchema });
      response.status(201).json(
        expenseDraftResponseSchema.parse({
          data: await services.expenses.create(
            input.params.bookingId,
            input.body,
            actor(response),
            request.requestId,
          ),
        }),
      );
    },
  );
  for (const method of ['patch', 'delete'] as const) {
    const body = method === 'patch' ? updateExpenseSchema : deleteExpenseSchema;
    router[method](
      expensePath + '/:lineId',
      authenticate,
      validateRequest({ params: lineParams, body }),
      manager,
      idempotent('/management/bookings/{bookingId}/incidental-expenses/{lineId}'),
      async (request, response) => {
        const input = validatedRequest(response, { params: lineParams, body });
        const data =
          method === 'patch'
            ? await services.expenses.update(
                input.params.bookingId,
                input.params.lineId,
                updateExpenseSchema.parse(input.body),
                actor(response),
                request.requestId,
              )
            : await services.expenses.remove(
                input.params.bookingId,
                input.params.lineId,
                deleteExpenseSchema.parse(input.body),
                actor(response),
                request.requestId,
              );
        response.json(expenseDraftResponseSchema.parse({ data }));
      },
    );
  }
  router.post(
    '/management/bookings/:bookingId/final-invoices',
    authenticate,
    validateRequest({ params, body: finalizeInvoiceSchema }),
    manager,
    idempotent('/management/bookings/{bookingId}/final-invoices'),
    async (request, response) => {
      const input = validatedRequest(response, { params, body: finalizeInvoiceSchema });
      response.status(201).json(
        finalInvoiceResponseSchema.parse({
          data: await services.invoices.finalize(
            input.params.bookingId,
            input.body,
            actor(response),
            request.requestId,
          ),
        }),
      );
    },
  );
  router.post(
    '/management/bookings/:bookingId/invoice-adjustments',
    authenticate,
    validateRequest({ params, body: invoiceAdjustmentSchema }),
    manager,
    idempotent('/management/bookings/{bookingId}/invoice-adjustments'),
    async (request, response) => {
      const input = validatedRequest(response, { params, body: invoiceAdjustmentSchema });
      response.status(201).json(
        finalInvoiceResponseSchema.parse({
          data: await services.invoices.adjust(
            input.params.bookingId,
            input.body,
            actor(response),
            request.requestId,
          ),
        }),
      );
    },
  );
  router.get(
    '/bookings/:bookingId/final-invoices',
    authenticate,
    validateRequest({ params, query }),
    async (request, response) => {
      const input = validatedRequest(response, { params, query });
      response.set('Cache-Control', 'no-store').json(
        finalInvoicesResponseSchema.parse({
          data: await services.invoices.list(
            input.params.bookingId,
            actor(response),
            request.requestId,
            input.query.cursor,
          ),
        }),
      );
    },
  );
  router.get(
    '/bookings/:bookingId/final-invoices/:invoiceRevisionId',
    authenticate,
    validateRequest({ params: invoiceParams }),
    async (request, response) => {
      const input = validatedRequest(response, { params: invoiceParams });
      response.set('Cache-Control', 'no-store').json(
        finalInvoiceResponseSchema.parse({
          data: await services.invoices.read(
            input.params.bookingId,
            input.params.invoiceRevisionId,
            actor(response),
            request.requestId,
          ),
        }),
      );
    },
  );
  return router;
}
