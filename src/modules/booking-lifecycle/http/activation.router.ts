import { createHash } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { AppError } from '../../../core/errors/app-error.js';
import { validateRequest, validatedRequest } from '../../../core/http/validate.js';
import {
  createAuthenticatedActorMiddleware,
  type AuthenticatedActor,
  type AuthenticatedActorResolver,
} from '../../identity-access/authorization/authenticated-actor.middleware.js';
import type { WorkspaceInvitationIssuer } from '../../identity-access/workspace-invitation/workspace-invitation.service.js';
import {
  ActiveInvitationExistsError,
  InvitationNotFoundError,
  InvitationReissueLimitError,
} from '../../identity-access/workspace-invitation/workspace-invitation.repository.js';
import {
  activationParams,
  activationStatusQuery,
  activationBody,
  activationResponse,
  activationSentResponse,
} from './activation.schemas.js';

const failure = (status: number, code: string) =>
  new AppError({ status, code, message: 'The activation operation could not be completed.' });
export function createActivationRouter(
  prisma: PrismaClient,
  resolver: AuthenticatedActorResolver,
  invitations: WorkspaceInvitationIssuer,
  idempotent: (path: string) => RequestHandler,
) {
  const router = Router(),
    authenticate = createAuthenticatedActorMiddleware(resolver);
  const root = '/management/consultations/:consultationId';
  async function context(consultationId: string, actor: AuthenticatedActor) {
    if (!actor.roles.includes('MANAGER')) throw failure(404, 'NOT_FOUND');
    const consultation = await prisma.consultation.findFirst({
      where: { id: consultationId, managerAccountId: actor.accountId },
      include: { invitationIntent: { select: { status: true } } },
    });
    if (!consultation) throw failure(404, 'NOT_FOUND');
    const [grant, latest, account] = await Promise.all([
      prisma.consultationAccess.findFirst({
        where: {
          consultationId,
          account: { emailNormalized: consultation.intendedEmailNormalized },
        },
        select: { id: true },
      }),
      prisma.workspaceInvitation.findFirst({
        where: { consultationId, recipientEmailNormalized: consultation.intendedEmailNormalized },
        orderBy: { sequence: 'desc' },
        select: { id: true, status: true, expiresAt: true, acceptedAt: true },
      }),
      prisma.account.findUnique({
        where: { emailNormalized: consultation.intendedEmailNormalized },
        select: { status: true, passwordCredential: { select: { accountId: true } } },
      }),
    ]);
    const accountState =
      account === null
        ? ('NOT_REGISTERED' as const)
        : account.status === 'ACTIVE' && account.passwordCredential !== null
          ? ('ACTIVE' as const)
          : ('UNAVAILABLE' as const);
    return { consultation, grant, latest, accountState };
  }
  router.get(
    root + '/activation-status',
    authenticate,
    validateRequest({ params: activationParams, query: activationStatusQuery }),
    async (_request, response) => {
      const { params, query } = validatedRequest(response, {
        params: activationParams,
        query: activationStatusQuery,
      });
      const { consultation, grant, latest, accountState } = await context(
        params.consultationId,
        response.locals.actor as AuthenticatedActor,
      );
      const state = grant
        ? accountState === 'ACTIVE'
          ? 'ACTIVATED'
          : 'ACCOUNT_UNAVAILABLE'
        : latest?.status === 'ACCEPTED'
          ? 'ACCESS_UNAVAILABLE'
          : latest?.status === 'REVOKED'
            ? 'REVOKED'
            : latest && latest.expiresAt.getTime() <= Date.now()
              ? 'EXPIRED'
              : latest?.status === 'ACTIVE'
                ? 'AWAITING_ACCEPTANCE'
                : consultation.invitationIntent?.status === 'PENDING'
                  ? 'DELIVERY_PENDING'
                  : 'NOT_ISSUED';
      response.set('Cache-Control', 'no-store').json(
        activationResponse.parse({
          data: {
            consultationId: consultation.id,
            consultationRevision: consultation.revision,
            recipientEmail: consultation.intendedEmail,
            state,
            ...(query.includeAccountState === 'true'
              ? {
                  accountState,
                  accessState:
                    accountState === 'UNAVAILABLE' || state === 'ACCESS_UNAVAILABLE'
                      ? 'UNAVAILABLE'
                      : grant
                        ? 'GRANTED'
                        : 'NOT_GRANTED',
                }
              : {}),
            expiresAt: latest?.expiresAt.toISOString() ?? null,
            acceptedAt: latest?.acceptedAt?.toISOString() ?? null,
            canSend:
              accountState !== 'UNAVAILABLE' &&
              !grant &&
              latest?.status !== 'ACCEPTED' &&
              latest?.status !== 'REVOKED',
          },
        }),
      );
    },
  );
  router.post(
    root + '/activation-invitations',
    authenticate,
    validateRequest({ params: activationParams, query: z.strictObject({}), body: activationBody }),
    // Authorize before looking up/replaying an idempotent operation.
    async (_request, response, next) => {
      const { params, body } = validatedRequest(response, {
        params: activationParams,
        body: activationBody,
      });
      const facts = await context(
        params.consultationId,
        response.locals.actor as AuthenticatedActor,
      );
      if (facts.consultation.revision !== body.expectedRevision)
        throw failure(409, 'CONSULTATION_REVISION_STALE');
      next();
    },
    idempotent('/management/consultations/{consultationId}/activation-invitations'),
    async (request, response) => {
      const { params, body } = validatedRequest(response, {
        params: activationParams,
        body: activationBody,
      });
      const actor = response.locals.actor as AuthenticatedActor;
      const { consultation, grant, latest, accountState } = await context(
        params.consultationId,
        actor,
      );
      if (consultation.revision !== body.expectedRevision)
        throw failure(409, 'CONSULTATION_REVISION_STALE');
      if (grant || latest?.status === 'ACCEPTED') throw failure(409, 'ACCOUNT_ALREADY_ACTIVATED');
      if (accountState === 'UNAVAILABLE') throw failure(409, 'ACCOUNT_UNAVAILABLE');
      if (latest?.status === 'REVOKED') throw failure(409, 'INVITATION_REVOKED');
      const hex = createHash('sha256')
        .update(actor.accountId + ':' + consultation.id + ':' + request.get('idempotency-key'))
        .digest('hex');
      const invitationIntentId =
        hex.slice(0, 8) +
        '-' +
        hex.slice(8, 12) +
        '-5' +
        hex.slice(13, 16) +
        '-a' +
        hex.slice(17, 20) +
        '-' +
        hex.slice(20, 32);
      const sameIntent = latest?.id === invitationIntentId;
      const operation =
        !sameIntent && latest?.status === 'ACTIVE' && latest.expiresAt.getTime() > Date.now()
          ? 'reissue'
          : 'issue';
      try {
        const result = await invitations[operation]({
          invitationIntentId,
          consultationId: consultation.id,
          recipientEmail: consultation.intendedEmail,
          issuedByAccountId: actor.accountId,
          requestId: request.requestId,
        });
        response
          .set('Cache-Control', 'no-store')
          .status(202)
          .json(
            activationSentResponse.parse({
              data: { invitationId: result.invitationId, state: 'ISSUED' },
            }),
          );
      } catch (error) {
        if (error instanceof InvitationReissueLimitError) throw failure(429, 'RATE_LIMITED');
        if (
          error instanceof ActiveInvitationExistsError ||
          error instanceof InvitationNotFoundError
        )
          throw failure(409, 'INVITATION_STATE_CHANGED');
        throw new AppError({
          status: 503,
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Invitation outcome is not confirmed; retry with the same idempotency key.',
          cause: error,
        });
      }
    },
  );
  return router;
}
