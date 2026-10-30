import type { Router, RequestHandler } from 'express';
import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import { AppError } from '../../../core/errors/app-error.js';
import { validateRequest, validatedRequest } from '../../../core/http/validate.js';
import type { AuthenticatedActor } from '../../identity-access/authorization/authenticated-actor.middleware.js';
import { linkExistingCustomer } from '../infrastructure/existing-customer-access.js';
import {
  activationParams,
  existingCustomerLinkBody,
  existingCustomerLinkResponse,
} from './activation.schemas.js';

const failure = (status: number, code: string) =>
  new AppError({
    status,
    code,
    message:
      'The customer link could not be confirmed. Refresh the consultation and select the customer again.',
  });

export function registerExistingCustomerAccess(
  router: Router,
  prisma: PrismaClient,
  authenticate: RequestHandler,
  idempotent: (path: string) => RequestHandler,
) {
  const path = '/management/consultations/:consultationId/existing-customer-access';
  router.post(
    path,
    authenticate,
    validateRequest({ params: activationParams, body: existingCustomerLinkBody }),
    async (_request, response, next) => {
      const actor = response.locals.actor as AuthenticatedActor;
      const { params } = validatedRequest(response, { params: activationParams });
      if (
        !actor.roles.includes('MANAGER') ||
        !(await prisma.consultation.findFirst({
          where: { id: params.consultationId, managerAccountId: actor.accountId },
          select: { id: true },
        }))
      )
        throw failure(404, 'NOT_FOUND');
      next();
    },
    idempotent('/management/consultations/{consultationId}/existing-customer-access'),
    async (request, response) => {
      const actor = response.locals.actor as AuthenticatedActor;
      const { params, body } = validatedRequest(response, {
        params: activationParams,
        body: existingCustomerLinkBody,
      });
      try {
        await prisma.$transaction(
          async (transaction) => {
            const target = await transaction.consultation.findFirst({
              where: { id: params.consultationId, managerAccountId: actor.accountId },
              select: { revision: true, intendedEmailNormalized: true },
            });
            if (!target) throw failure(404, 'NOT_FOUND');
            if (target.revision !== body.expectedRevision)
              throw failure(409, 'CONSULTATION_REVISION_STALE');
            const grant = await transaction.consultationAccess.findFirst({
              where: {
                consultationId: params.consultationId,
                account: {
                  emailNormalized: target.intendedEmailNormalized,
                  status: 'ACTIVE',
                  passwordCredential: { isNot: null },
                },
              },
              select: { id: true },
            });
            if (grant) return;
            const latest = await transaction.workspaceInvitation.findFirst({
              where: {
                consultationId: params.consultationId,
                recipientEmailNormalized: target.intendedEmailNormalized,
              },
              orderBy: { sequence: 'desc' },
              select: { status: true },
            });
            if (latest?.status === 'REVOKED' || latest?.status === 'ACCEPTED')
              throw failure(409, 'CUSTOMER_ACCESS_UNAVAILABLE');
            const result = await linkExistingCustomer(transaction, {
              consultationId: params.consultationId,
              sourceConsultationId: body.sourceConsultationId,
              managerAccountId: actor.accountId,
              emailNormalized: target.intendedEmailNormalized,
              requestId: request.requestId,
            });
            if (!result) throw failure(409, 'CUSTOMER_ACCESS_UNAVAILABLE');
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error: unknown) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')
          throw failure(409, 'CONSULTATION_REVISION_STALE');
        throw error;
      }
      response.set('Cache-Control', 'no-store').json(
        existingCustomerLinkResponse.parse({
          data: { consultationId: params.consultationId, linked: true },
        }),
      );
    },
  );
}
