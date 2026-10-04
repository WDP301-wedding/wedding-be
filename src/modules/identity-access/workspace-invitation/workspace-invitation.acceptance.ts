import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

import { RateLimitError } from '../../../core/errors/app-error.js';
import type { PasswordCrypto } from '../account/account.service.js';
import { hashOpaqueToken, issueOpaqueToken } from '../crypto/token.js';
import type { AttemptThrottle } from '../session/session.service.js';
import type { IssuedSession } from '../session/session.service.js';
import type { WorkspaceInvitationAcceptanceRepository } from './workspace-invitation.repository.js';

export class InvalidOrExpiredInvitationError extends Error {
  override readonly name = 'InvalidOrExpiredInvitationError';

  constructor() {
    super('The workspace invitation is invalid or expired.');
  }
}

export function createWorkspaceInvitationAcceptanceService(
  options: Readonly<{
    repository: WorkspaceInvitationAcceptanceRepository;
    passwordCrypto: PasswordCrypto;
    throttle: AttemptThrottle;
    config: Readonly<{
      tokenEntropyBytes: number;
      accessTokenTtlSeconds: number;
      refreshIdleTtlSeconds: number;
      refreshAbsoluteTtlSeconds: number;
      tokenConsumeRateLimit: Readonly<{ maxAttempts: number; windowSeconds: number }>;
    }>;
    now?: () => Date;
  }>,
) {
  const now = options.now ?? (() => new Date());

  return Object.freeze({
    async accept(
      input: Readonly<{
        invitationToken: string;
        password: string;
        clientIp: string;
        requestId: string;
      }>,
    ): Promise<IssuedSession> {
      if (isIP(input.clientIp) === 0) throw new TypeError('The resolved client IP is invalid.');
      const acceptedAt = now();
      const boundedToken =
        input.invitationToken.length <= 256
          ? input.invitationToken
          : `${input.invitationToken.length}:${input.invitationToken.slice(0, 256)}`;
      const throttleResults = await Promise.all([
        options.throttle.consume({
          bucket: 'invitation-ip',
          key: input.clientIp,
          ...options.config.tokenConsumeRateLimit,
          now: acceptedAt,
        }),
        options.throttle.consume({
          bucket: 'invitation-token',
          key: fingerprint('invitation-token', boundedToken),
          ...options.config.tokenConsumeRateLimit,
          now: acceptedAt,
        }),
      ]);
      if (throttleResults.some(({ allowed }) => !allowed)) {
        throw new RateLimitError(
          Math.max(...throttleResults.map(({ retryAfterSeconds }) => retryAfterSeconds)),
        );
      }
      if (!/^wii_[A-Za-z0-9_-]{43}$/u.test(input.invitationToken)) {
        throw new InvalidOrExpiredInvitationError();
      }

      const invitationTokenHash = hashOpaqueToken(input.invitationToken, 'invitation');
      const preview = await options.repository.previewAcceptance(invitationTokenHash, acceptedAt);
      if (preview === null) throw new InvalidOrExpiredInvitationError();

      let expectedAccountId: string | null = null;
      let expectedPasswordUpdatedAt: Date | null = null;
      let newAccountPasswordVerifier = null;
      if (preview.account === null) {
        newAccountPasswordVerifier = await options.passwordCrypto.hash(input.password);
      } else {
        if (preview.account.status !== 'ACTIVE' || preview.account.passwordVerifier === null) {
          throw new InvalidOrExpiredInvitationError();
        }
        const verification = await options.passwordCrypto.verify(
          input.password,
          preview.account.passwordVerifier,
        );
        if (!verification.matches) throw new InvalidOrExpiredInvitationError();
        expectedAccountId = preview.account.accountId;
        expectedPasswordUpdatedAt = preview.account.passwordUpdatedAt;
      }

      const access = issueOpaqueToken('access', options.config.tokenEntropyBytes);
      const refresh = issueOpaqueToken('refresh', options.config.tokenEntropyBytes);
      const accessExpiresAt = addSeconds(acceptedAt, options.config.accessTokenTtlSeconds);
      const refreshExpiresAt = addSeconds(acceptedAt, options.config.refreshIdleTtlSeconds);
      const absoluteExpiresAt = addSeconds(acceptedAt, options.config.refreshAbsoluteTtlSeconds);
      const stored = await options.repository.accept({
        invitationTokenHash,
        expectedAccountId,
        expectedPasswordUpdatedAt,
        newAccountPasswordVerifier,
        accessTokenHash: access.tokenHash,
        refreshTokenHash: refresh.tokenHash,
        accessExpiresAt,
        idleExpiresAt: refreshExpiresAt,
        absoluteExpiresAt,
        now: acceptedAt,
        requestId: input.requestId,
      });
      if (stored === null) throw new InvalidOrExpiredInvitationError();

      return Object.freeze({
        account: stored.account,
        sessionId: stored.sessionId,
        clientKind: 'WEB' as const,
        accessToken: access.token,
        accessExpiresAt,
        refreshToken: refresh.token,
        refreshExpiresAt,
        absoluteExpiresAt,
      });
    },
  });
}

function fingerprint(purpose: string, value: string): string {
  return createHash('sha256')
    .update('wedding.identity-rate-limit.v1\0')
    .update(purpose)
    .update('\0')
    .update(value)
    .digest('base64url');
}

function addSeconds(date: Date, seconds: number): Date {
  if (!Number.isSafeInteger(seconds) || seconds <= 0 || !Number.isFinite(date.getTime())) {
    throw new RangeError('Invalid invitation acceptance lifetime.');
  }
  return new Date(date.getTime() + seconds * 1_000);
}
