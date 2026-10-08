import { randomBytes } from 'node:crypto';

import type { Router } from 'express';

import type { Config } from '../../config/config.js';
import { createPrismaClient } from '../../core/database/prisma.js';
import type { ShutdownResource } from '../../core/http/lifecycle.js';
import { createEmailProvider } from '../../integrations/email/email-provider.factory.js';
import { createPrismaAccountRepository } from './account/account.repository.js';
import { createAccountService } from './account/account.service.js';
import { createAuthenticatedActorResolver } from './authorization/authenticated-actor.middleware.js';
import { hashPassword, verifyPassword } from './crypto/password.js';
import { createIdentityRouter } from './identity.router.js';
import { createIdentityEmailNotificationPort } from './identity-notification.port.js';
import { createPrismaPasswordResetRepository } from './password-reset/password-reset.repository.js';
import { createPasswordResetService } from './password-reset/password-reset.service.js';
import { createPrismaSessionRepository } from './session/session.repository.js';
import {
  createInMemoryAttemptThrottle,
  createSessionService,
  type IdentitySecurityEvent,
} from './session/session.service.js';
import { createWorkspaceInvitationAcceptanceService } from './workspace-invitation/workspace-invitation.acceptance.js';
import { createPrismaWorkspaceInvitationRepository } from './workspace-invitation/workspace-invitation.repository.js';

export type IdentityRuntime = Readonly<{
  router: Router;
  resource: ShutdownResource;
}>;

export async function createIdentityRuntime(config: Config): Promise<IdentityRuntime> {
  const prisma = createPrismaClient(config.database.url);
  try {
    await prisma.$connect();
    const passwordPolicy = config.identityAccess.password;
    const dummyPasswordVerifier = await hashPassword(
      randomBytes(32).toString('base64url'),
      passwordPolicy,
    );
    const accountRepository = createPrismaAccountRepository(prisma);
    const passwordCrypto = {
      hash: (password: string) => hashPassword(password, passwordPolicy),
      verify: (password: string, verifier: unknown) =>
        verifyPassword(password, verifier, passwordPolicy),
    };
    const accountService = createAccountService({
      repository: accountRepository,
      passwordCrypto,
      dummyPasswordVerifier,
      disabledAccountRetentionDays: config.identityAccess.retentionDays.disabledAccountPii,
    });
    const sessionRepository = createPrismaSessionRepository(prisma);
    const throttle = createInMemoryAttemptThrottle();
    const sessionService = createSessionService({
      repository: sessionRepository,
      authenticate: accountService.authenticate,
      throttle,
      config: {
        accessTokenTtlSeconds: config.identityAccess.lifetimesSeconds.accessToken,
        refreshIdleTtlSeconds: config.identityAccess.lifetimesSeconds.refreshIdle,
        refreshAbsoluteTtlSeconds: config.identityAccess.lifetimesSeconds.refreshAbsolute,
        tokenEntropyBytes: config.identityAccess.tokenEntropyBytes,
        loginRateLimit: config.identityAccess.rateLimits.login,
        refreshRateLimit: config.identityAccess.rateLimits.refresh,
      },
      recordSecurityEvent: (event) => recordSecurityEvent(prisma, event),
    });
    const publicWebBaseUrl = resolvePublicWebBaseUrl(config);
    const emailProvider = createEmailProvider(config.email);
    const notificationPort = createIdentityEmailNotificationPort(emailProvider, publicWebBaseUrl);
    const passwordResetService = createPasswordResetService({
      repository: createPrismaPasswordResetRepository(prisma),
      passwordCrypto,
      notificationPort,
      throttle,
      config: {
        tokenEntropyBytes: config.identityAccess.tokenEntropyBytes,
        lifetimeSeconds: config.identityAccess.lifetimesSeconds.passwordReset,
        requestRateLimit: config.identityAccess.rateLimits.resetRequest,
        completionRateLimit: config.identityAccess.rateLimits.tokenConsume,
      },
    });
    const invitationAcceptanceService = createWorkspaceInvitationAcceptanceService({
      repository: createPrismaWorkspaceInvitationRepository(prisma),
      passwordCrypto,
      throttle,
      config: {
        tokenEntropyBytes: config.identityAccess.tokenEntropyBytes,
        accessTokenTtlSeconds: config.identityAccess.lifetimesSeconds.accessToken,
        refreshIdleTtlSeconds: config.identityAccess.lifetimesSeconds.refreshIdle,
        refreshAbsoluteTtlSeconds: config.identityAccess.lifetimesSeconds.refreshAbsolute,
        tokenConsumeRateLimit: config.identityAccess.rateLimits.tokenConsume,
      },
    });
    const actorResolver = createAuthenticatedActorResolver(sessionRepository);
    const router = createIdentityRouter({
      services: {
        resolveActor: actorResolver.resolve,
        login: sessionService.login,
        refresh: sessionService.refresh,
        logout: sessionService.logout,
        listSessions: sessionService.listSessions,
        revokeOwnedSession: sessionService.revokeOwnedSession,
        requestPasswordReset: passwordResetService.request,
        completePasswordReset: passwordResetService.complete,
        acceptInvitation: invitationAcceptanceService.accept,
      },
      allowedWebOrigins: config.cors.allowedOrigins,
      refreshCookieName: config.identityAccess.refreshCookie.name,
    });
    return Object.freeze({
      router,
      resource: Object.freeze({
        name: 'identity-database',
        close: () => prisma.$disconnect(),
      }),
    });
  } catch (error: unknown) {
    await prisma.$disconnect();
    throw error;
  }
}

function resolvePublicWebBaseUrl(config: Config): string {
  const configured = config.cors.allowedOrigins[0];
  if (configured !== undefined) return configured;
  if (config.runtime.environment === 'development' || config.runtime.environment === 'test') {
    return 'http://localhost:3000';
  }
  throw new TypeError('Identity notification links require a configured Public Web origin.');
}

async function recordSecurityEvent(
  prisma: ReturnType<typeof createPrismaClient>,
  event: IdentitySecurityEvent,
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      requestId: event.requestId,
      actorType: 'SYSTEM',
      action: event.action,
      entityType: event.sessionId === undefined ? 'account' : 'session',
      entityId: event.sessionId ?? event.accountId ?? null,
      metadata: event.reasonCode === undefined ? {} : { reasonCode: event.reasonCode },
    },
  });
}
