import { randomBytes } from 'node:crypto';

import type { Router } from 'express';

import type { Config } from '../../config/config.js';
import { createPrismaClient } from '../../core/database/prisma.js';
import type { ShutdownResource } from '../../core/http/lifecycle.js';
import { createEmailProvider } from '../../integrations/email/email-provider.factory.js';
import { createPrismaAccountRepository } from './account/account.repository.js';
import { createAccountService } from './account/account.service.js';
import { createAccountSettingsRouter } from './account/settings.router.js';
import { createAuthenticatedActorResolver } from './authorization/authenticated-actor.middleware.js';
import { hashPassword, verifyPassword } from './crypto/password.js';
import { createIdentityRouter } from './identity.router.js';
import { AppError } from '../../core/errors/app-error.js';
import { createPasswordOtpService } from './password-otp/password-otp.service.js';
import { createPasswordOtpRouter } from './password-otp/password-otp.router.js';
import {
  createPrismaSessionRepository,
  type SessionRepository,
} from './session/session.repository.js';
import {
  createInMemoryAttemptThrottle,
  createSessionService,
  type AttemptThrottle,
  type IdentitySecurityEvent,
} from './session/session.service.js';
import { createWorkspaceInvitationAcceptanceService } from './workspace-invitation/workspace-invitation.acceptance.js';
import { createPrismaWorkspaceInvitationRepository } from './workspace-invitation/workspace-invitation.repository.js';

export type IdentityRuntime = Readonly<{
  router: Router;
  sessionRepository: Pick<SessionRepository, 'findActorByAccessTokenHash'>;
  resource: ShutdownResource;
}>;

export async function createIdentityRuntime(
  config: Config,
  dependencies?: {
    throttle?: AttemptThrottle | undefined;
    onSessionRevoked?: ((sessionId: string, accountId?: string) => void | Promise<void>) | undefined;
    onAccountRevoked?: ((accountId: string) => void | Promise<void>) | undefined;
  },
): Promise<IdentityRuntime> {
  const prisma = createPrismaClient(config.database.url);
  try {
    await prisma.$connect();
    const schema = config.database.url
      ? (new URL(config.database.url).searchParams.get('schema') ?? 'public')
      : 'public';
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
    const throttle = dependencies?.throttle ?? createInMemoryAttemptThrottle();
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
      ...(dependencies?.onSessionRevoked ? { onSessionRevoked: dependencies.onSessionRevoked } : {}),
      ...(dependencies?.onAccountRevoked ? { onAccountRevoked: dependencies.onAccountRevoked } : {}),
    });
    const emailProvider = createEmailProvider(config.email);
    const otpKey = config.identityAccess.passwordOtpHashKey;
    if (
      !otpKey &&
      config.runtime.environment !== 'development' &&
      config.runtime.environment !== 'test'
    )
      throw new TypeError('AUTH_OTP_HASH_KEY is required.');
    const passwordOtpService = createPasswordOtpService({
      prisma,
      passwordCrypto,
      emailProvider,
      emailEnabled: config.email.enabled,
      schema,
      hashKey: otpKey ?? randomBytes(32).toString('hex'),
    });
    const retiredReset = (): Promise<never> =>
      Promise.reject(
        new AppError({
          status: 410,
          code: 'PASSWORD_OTP_REQUIRED',
          message: 'Use the email OTP password confirmation endpoints.',
        }),
      );
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
        requestPasswordReset: retiredReset,
        completePasswordReset: retiredReset,
        acceptInvitation: invitationAcceptanceService.accept,
      },
      allowedWebOrigins: config.cors.allowedOrigins,
      refreshCookieName: config.identityAccess.refreshCookie.name,
    });
    router.use(createPasswordOtpRouter(passwordOtpService, actorResolver));
    router.use(createAccountSettingsRouter(prisma, actorResolver, passwordOtpService, schema));
    return Object.freeze({
      router,
      sessionRepository,
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
