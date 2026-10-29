import { Router, type Response } from 'express';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { AppError } from '../../../core/errors/app-error.js';
import { registerBookingLookup } from './booking-lookup.route.js';
import { validateRequest, validatedRequest } from '../../../core/http/validate.js';
import {
  createAuthenticatedActorMiddleware,
  type AuthenticatedActorResolver,
  type AuthenticatedActor,
} from '../../identity-access/authorization/authenticated-actor.middleware.js';
import {
  consultationWorkspaceParamsSchema,
  consultationWorkspaceResponseSchema,
  consultationCustomerQuerySchema,
  consultationCustomersResponseSchema,
} from './experience.schemas.js';

/** Resume by server identity, never by stale URL contact fields or browser history. */
export function createConsultationWorkspaceRouter(
  prisma: PrismaClient,
  resolver: AuthenticatedActorResolver,
) {
  const router = Router();
  router.use(
    ['/consultations/:consultationId/workspace', '/consultation-customers', '/booking-lookups'],
    createAuthenticatedActorMiddleware(resolver),
    (_request, response, next) => {
      if (!(response.locals.actor as AuthenticatedActor).roles.includes('MANAGER')) {
        return next(
          new AppError({ status: 403, code: 'FORBIDDEN', message: 'Manager access required.' }),
        );
      }
      response.set('Cache-Control', 'no-store');
      next();
    },
  );
  const managerId = (response: Response) => (response.locals.actor as AuthenticatedActor).accountId;
  registerBookingLookup(router, prisma);
  router.get(
    '/consultations/:consultationId/workspace',
    validateRequest({ params: consultationWorkspaceParamsSchema }),
    async (_request, response) => {
      const { params } = validatedRequest(response, { params: consultationWorkspaceParamsSchema });
      const item = await prisma.consultation.findFirst({
        where: { id: params.consultationId, managerAccountId: managerId(response) },
        select: {
          id: true,
          revision: true,
          displayName: true,
          intendedEmail: true,
          note: true,
          booking: { select: { id: true, phase: true } },
          intakeRequest: {
            select: {
              preferredDate: true,
              expectedGuests: true,
              preferredHallId: true,
              preferredMenuVersionId: true,
              preferredShift: true,
            },
          },
        },
      });
      if (!item)
        throw new AppError({
          status: 404,
          code: 'CONSULTATION_NOT_FOUND',
          message: 'Consultation not found.',
        });
      response.json(
        consultationWorkspaceResponseSchema.parse({
          data: {
            consultationId: item.id,
            revision: item.revision,
            displayName: item.displayName,
            email: item.intendedEmail,
            note: item.note,
            bookingId: item.booking?.id ?? null,
            bookingPhase: item.booking?.phase ?? null,
            preferredDate: item.intakeRequest?.preferredDate?.toISOString().slice(0, 10) ?? null,
            expectedGuests: item.intakeRequest?.expectedGuests ?? null,
            preferredHallId: item.intakeRequest?.preferredHallId ?? null,
            preferredMenuVersionId: item.intakeRequest?.preferredMenuVersionId ?? null,
            preferredShift: item.intakeRequest?.preferredShift ?? null,
          },
        }),
      );
    },
  );
  router.get(
    '/consultation-customers',
    validateRequest({ query: consultationCustomerQuerySchema }),
    async (_request, response) => {
      const { query } = validatedRequest(response, { query: consultationCustomerQuerySchema });
      const q = query.q.normalize('NFC');
      const items = await prisma.consultation.findMany({
        where: {
          managerAccountId: managerId(response),
          OR: [
            { displayName: { contains: q, mode: 'insensitive' } },
            { intendedEmailNormalized: { contains: q.toLowerCase() } },
            { intakeRequest: { phone: { contains: q } } },
          ],
        },
        distinct: ['intendedEmailNormalized'],
        take: 15,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        select: { id: true, displayName: true, intendedEmail: true },
      });
      response.json(
        consultationCustomersResponseSchema.parse({
          data: items.map((item) => ({
            consultationId: item.id,
            displayName: item.displayName,
            email: item.intendedEmail,
          })),
        }),
      );
    },
  );
  return router;
}
