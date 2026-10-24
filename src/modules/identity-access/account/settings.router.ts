import { createIdentityLocks } from './identity-locks.js';
import { Router, type Response } from 'express';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import { AppError } from '../../../core/errors/app-error.js';
import { createGeneralRateLimit } from '../../../core/http/rate-limit.js';
import { validateRequest, validatedRequest } from '../../../core/http/validate.js';
import {
  createAuthenticatedActorMiddleware,
  type AuthenticatedActor,
  type AuthenticatedActorResolver,
} from '../authorization/authenticated-actor.middleware.js';
import {
  passwordChangeSchema,
  passwordChangedResponseSchema,
  profileResponseSchema,
  profileWriteSchema,
} from './settings.schemas.js';

import type { Redis } from 'ioredis';
import type { PasswordOtpService } from '../password-otp/password-otp.service.js';

export function createAccountSettingsRouter(
  prisma: PrismaClient,
  resolver: AuthenticatedActorResolver,
  otp: PasswordOtpService,
  schema = 'public',
  redisClient?: Redis | null,
) {
  const router = Router();
  const locks = createIdentityLocks(schema);
  const authenticate = createAuthenticatedActorMiddleware(resolver);
  const limited = createGeneralRateLimit({ maxRequests: 10, windowMs: 15 * 60_000 }, redisClient, 'settings');
  router.use('/auth/profile', authenticate);
  router.use('/auth/password-changes', limited, authenticate);
  router.get('/auth/profile', async (_request, response) => {
    const actor = actorOf(response);
    const account = await prisma.account.findUniqueOrThrow({
      where: { id: actor.accountId },
      select: { id: true, displayEmail: true, displayName: true, profileRevision: true },
    });
    response.set('Cache-Control', 'no-store').json(
      profileResponseSchema.parse({
        data: {
          accountId: account.id,
          displayEmail: account.displayEmail,
          displayName: account.displayName,
          revision: account.profileRevision,
        },
      }),
    );
  });
  router.patch(
    '/auth/profile',
    validateRequest({ body: profileWriteSchema }),
    async (request, response) => {
      const actor = actorOf(response);
      const { body } = validatedRequest(response, { body: profileWriteSchema });
      const account = await prisma.$transaction(async (tx) => {
        await requireActiveSession(tx, actor, locks);
        const changed = await tx.account.updateMany({
          where: { id: actor.accountId, status: 'ACTIVE', profileRevision: body.expectedRevision },
          data: { displayName: body.displayName, profileRevision: { increment: 1 } },
        });
        if (changed.count !== 1) throw failure(409, 'PROFILE_REVISION_STALE');
        await tx.auditLog.create({
          data: {
            requestId: request.requestId,
            actorType: 'USER',
            actorId: actor.accountId,
            action: 'account.profile-updated',
            entityType: 'account',
            entityId: actor.accountId,
            metadata: {},
          },
        });
        return tx.account.findUniqueOrThrow({ where: { id: actor.accountId } });
      });
      response.set('Cache-Control', 'no-store').json(
        profileResponseSchema.parse({
          data: {
            accountId: account.id,
            displayEmail: account.displayEmail,
            displayName: account.displayName,
            revision: account.profileRevision,
          },
        }),
      );
    },
  );
  router.post(
    '/auth/password-changes',
    validateRequest({ body: passwordChangeSchema }),
    async (request, response) => {
      const actor = actorOf(response);
      const { body } = validatedRequest(response, { body: passwordChangeSchema });
      await otp.complete({
        ...body,
        actor,
        clientIp: request.ip ?? request.socket.remoteAddress ?? '',
        requestId: request.requestId,
      });
      response.clearCookie('__Host-wedding-refresh', {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
      });
      response
        .set('Cache-Control', 'no-store')
        .json(
          passwordChangedResponseSchema.parse({ data: { completed: true, requiresLogin: true } }),
        );
    },
  );
  return router;
}

function actorOf(response: Response): AuthenticatedActor {
  return response.locals.actor as AuthenticatedActor;
}
function failure(status: number, code: string) {
  return new AppError({ status, code, message: 'The account operation could not be completed.' });
}
async function requireActiveSession(
  tx: Prisma.TransactionClient,
  actor: AuthenticatedActor,
  locks: ReturnType<typeof createIdentityLocks>,
) {
  // Khóa tài khoản trước phiên để hai thiết bị đổi mật khẩu không khóa chéo nhau.
  await locks.account(tx, actor.accountId);
  await locks.session(tx, actor.sessionId);
  const session = await tx.session.findFirst({
    where: {
      id: actor.sessionId,
      accountId: actor.accountId,
      status: 'ACTIVE',
      idleExpiresAt: { gt: new Date() },
      absoluteExpiresAt: { gt: new Date() },
      account: { status: 'ACTIVE' },
    },
  });
  if (session === null) throw failure(401, 'SESSION_REVOKED');
}
