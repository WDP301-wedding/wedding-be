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
import type { ScryptPasswordVerifier } from '../crypto/password.js';
import {
  passwordChangeSchema,
  passwordChangedResponseSchema,
  profileResponseSchema,
  profileWriteSchema,
} from './settings.schemas.js';

type PasswordCrypto = Readonly<{
  hash(password: string): Promise<ScryptPasswordVerifier>;
  verify(password: string, verifier: unknown): Promise<Readonly<{ matches: boolean }>>;
}>;
export function createAccountSettingsRouter(
  prisma: PrismaClient,
  resolver: AuthenticatedActorResolver,
  crypto: PasswordCrypto,
) {
  const router = Router();
  const authenticate = createAuthenticatedActorMiddleware(resolver);
  const limited = createGeneralRateLimit({ maxRequests: 10, windowMs: 15 * 60_000 });
  router.use('/auth/profile', authenticate);
  router.use('/auth/password-changes', limited, authenticate);
  router.get('/auth/profile', async (_request, response) => {
    const actor = actorOf(response);
    const account = await prisma.account.findUniqueOrThrow({ where: { id: actor.accountId } });
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
        await requireActiveSession(tx, actor);
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
      const previous = await prisma.passwordCredential.findUnique({
        where: { accountId: actor.accountId },
      });
      if (
        previous === null ||
        !(
          await crypto.verify(body.currentPassword, {
            algorithm: previous.algorithm,
            version: previous.version,
            parameters: {
              cost: previous.cost,
              blockSize: previous.blockSize,
              parallelization: previous.parallelization,
              keyLengthBytes: previous.keyLengthBytes,
              maxMemoryBytes: previous.maxMemoryBytes,
            },
            saltEncoded: previous.saltEncoded,
            derivedKeyEncoded: previous.derivedKeyEncoded,
          })
        ).matches
      )
        throw failure(422, 'CURRENT_PASSWORD_INVALID');
      const verifier = await crypto.hash(body.newPassword);
      await prisma.$transaction(async (tx) => {
        await requireActiveSession(tx, actor);
        const changed = await tx.passwordCredential.updateMany({
          where: {
            accountId: actor.accountId,
            derivedKeyEncoded: previous.derivedKeyEncoded,
            saltEncoded: previous.saltEncoded,
          },
          data: {
            algorithm: verifier.algorithm,
            version: verifier.version,
            ...verifier.parameters,
            saltEncoded: verifier.saltEncoded,
            derivedKeyEncoded: verifier.derivedKeyEncoded,
          },
        });
        if (changed.count !== 1) throw failure(409, 'PASSWORD_CHANGED_CONCURRENTLY');
        const now = new Date();
        await tx.session.updateMany({
          where: { accountId: actor.accountId, status: 'ACTIVE' },
          data: { status: 'REVOKED', revokedAt: now, revocationReason: 'password-change' },
        });
        await tx.accessCredential.updateMany({
          where: { session: { accountId: actor.accountId }, status: 'ACTIVE' },
          data: { status: 'REVOKED', revokedAt: now },
        });
        await tx.refreshCredential.updateMany({
          where: { session: { accountId: actor.accountId }, status: 'ACTIVE' },
          data: { status: 'REVOKED', revokedAt: now },
        });
        await tx.passwordResetCredential.updateMany({
          where: { accountId: actor.accountId, status: 'ACTIVE' },
          data: { status: 'REVOKED', revokedAt: now },
        });
        await tx.auditLog.create({
          data: {
            requestId: request.requestId,
            actorType: 'USER',
            actorId: actor.accountId,
            action: 'account.password-changed',
            entityType: 'account',
            entityId: actor.accountId,
            metadata: { allSessionsRevoked: true },
          },
        });
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
async function requireActiveSession(tx: Prisma.TransactionClient, actor: AuthenticatedActor) {
  // Khóa tài khoản trước phiên để hai thiết bị đổi mật khẩu không khóa chéo nhau.
  await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${actor.accountId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "Session" WHERE "id" = ${actor.sessionId}::uuid FOR UPDATE`;
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
