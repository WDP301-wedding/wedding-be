import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

import type { AuthenticatedAccount } from '../account/account.service.js';
import {
  InvalidCredentialsError,
  invalidCredentialsReason,
  normalizeEmail,
} from '../account/account.service.js';
import { hashOpaqueToken, issueOpaqueToken } from '../crypto/token.js';
import type { SessionClientKind, SessionPage, SessionRepository } from './session.repository.js';

export type IdentitySecurityEvent = Readonly<{
  action:
    | 'session.login-succeeded'
    | 'session.login-failed'
    | 'session.login-throttled'
    | 'session.refreshed'
    | 'session.refresh-reuse'
    | 'session.logged-out'
    | 'session.revoked'
    | 'session.all-revoked';
  requestId: string;
  accountId?: string;
  sessionId?: string;
  reasonCode?: string;
}>;

export type AttemptThrottle = Readonly<{
  consume(
    input: Readonly<{
      bucket: AttemptThrottleBucket;
      key: string;
      maxAttempts: number;
      windowSeconds: number;
      now: Date;
    }>,
  ): Promise<Readonly<{ allowed: boolean; retryAfterSeconds: number }>>;
}>;

export type AttemptThrottleBucket =
  | 'login-ip'
  | 'login-subject'
  | 'refresh-ip'
  | 'refresh-token'
  | 'reset-request-ip'
  | 'reset-request-subject'
  | 'reset-complete-ip'
  | 'reset-token'
  | 'invitation-ip'
  | 'invitation-token';

export type SessionServiceConfig = Readonly<{
  accessTokenTtlSeconds: number;
  refreshIdleTtlSeconds: number;
  refreshAbsoluteTtlSeconds: number;
  tokenEntropyBytes: number;
  loginRateLimit: Readonly<{ maxAttempts: number; windowSeconds: number }>;
  refreshRateLimit: Readonly<{ maxAttempts: number; windowSeconds: number }>;
}>;

export type IssuedSession = Readonly<{
  account: AuthenticatedAccount;
  sessionId: string;
  clientKind: SessionClientKind;
  accessToken: string;
  accessExpiresAt: Date;
  refreshToken: string;
  refreshExpiresAt: Date;
  absoluteExpiresAt: Date;
}>;

export type RefreshedSession = Readonly<{
  sessionId: string;
  clientKind: SessionClientKind;
  accessToken: string;
  accessExpiresAt: Date;
  refreshToken: string;
  refreshExpiresAt: Date;
}>;

export class LoginRateLimitedError extends Error {
  override readonly name = 'LoginRateLimitedError';
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('Too many login attempts.');
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class RefreshRateLimitedError extends Error {
  override readonly name = 'RefreshRateLimitedError';
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('Too many refresh attempts.');
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class InvalidRefreshTokenError extends Error {
  override readonly name = 'InvalidRefreshTokenError';

  constructor() {
    super('The refresh credential is invalid or expired.');
  }
}

export class RefreshReplayError extends Error {
  override readonly name = 'RefreshReplayError';

  constructor() {
    super('Refresh credential reuse was detected.');
  }
}

export class OwnedSessionNotFoundError extends Error {
  override readonly name = 'OwnedSessionNotFoundError';

  constructor() {
    super('The session was not found.');
  }
}

export class InvalidClientIpError extends Error {
  override readonly name = 'InvalidClientIpError';

  constructor() {
    super('The resolved client IP is invalid.');
  }
}

export function createSessionService(
  options: Readonly<{
    repository: SessionRepository;
    authenticate(
      input: Readonly<{ email: string; password: string }>,
    ): Promise<AuthenticatedAccount>;
    throttle: AttemptThrottle;
    config: SessionServiceConfig;
    recordSecurityEvent(event: IdentitySecurityEvent): Promise<void>;
    onSessionRevoked?: ((sessionId: string, accountId?: string) => void | Promise<void>) | undefined;
    onAccountRevoked?: ((accountId: string) => void | Promise<void>) | undefined;
    now?: () => Date;
  }>,
) {
  const now = options.now ?? (() => new Date());

  return Object.freeze({
    async login(
      input: Readonly<{
        email: string;
        password: string;
        clientKind: SessionClientKind;
        clientIp: string;
        requestId: string;
      }>,
    ): Promise<IssuedSession> {
      const attemptedAt = now();
      assertClientIp(input.clientIp);
      const ipThrottleResult = await options.throttle.consume({
        bucket: 'login-ip',
        key: input.clientIp,
        ...options.config.loginRateLimit,
        now: attemptedAt,
      });
      if (!ipThrottleResult.allowed) {
        await options.recordSecurityEvent({
          action: 'session.login-throttled',
          requestId: input.requestId,
          reasonCode: 'rate-limit',
        });
        throw new LoginRateLimitedError(ipThrottleResult.retryAfterSeconds);
      }

      let normalizedEmail: string;
      try {
        normalizedEmail = normalizeEmail(input.email).normalized;
      } catch (error: unknown) {
        await options.recordSecurityEvent({
          action: 'session.login-failed',
          requestId: input.requestId,
          reasonCode: 'invalid-email',
        });
        throw error;
      }
      const subjectThrottleResult = await options.throttle.consume({
        bucket: 'login-subject',
        key: fingerprint('login-subject', normalizedEmail),
        ...options.config.loginRateLimit,
        now: attemptedAt,
      });
      if (!subjectThrottleResult.allowed) {
        await options.recordSecurityEvent({
          action: 'session.login-throttled',
          requestId: input.requestId,
          reasonCode: 'rate-limit',
        });
        throw new LoginRateLimitedError(subjectThrottleResult.retryAfterSeconds);
      }

      let account: AuthenticatedAccount;
      try {
        account = await options.authenticate({ email: normalizedEmail, password: input.password });
      } catch (error: unknown) {
        await options.recordSecurityEvent({
          action: 'session.login-failed',
          requestId: input.requestId,
          reasonCode:
            error instanceof InvalidCredentialsError
              ? invalidCredentialsReason(error)
              : 'authentication-error',
        });
        throw error;
      }

      const access = issueOpaqueToken('access', options.config.tokenEntropyBytes);
      const refresh = issueOpaqueToken('refresh', options.config.tokenEntropyBytes);
      const accessExpiresAt = addSeconds(attemptedAt, options.config.accessTokenTtlSeconds);
      const idleExpiresAt = addSeconds(attemptedAt, options.config.refreshIdleTtlSeconds);
      const absoluteExpiresAt = addSeconds(attemptedAt, options.config.refreshAbsoluteTtlSeconds);
      const stored = await options.repository.createSession({
        accountId: account.accountId,
        clientKind: input.clientKind,
        accessTokenHash: access.tokenHash,
        refreshTokenHash: refresh.tokenHash,
        accessExpiresAt,
        idleExpiresAt,
        absoluteExpiresAt,
        now: attemptedAt,
      });
      await options.recordSecurityEvent({
        action: 'session.login-succeeded',
        requestId: input.requestId,
        accountId: account.accountId,
        sessionId: stored.sessionId,
      });
      return Object.freeze({
        account,
        sessionId: stored.sessionId,
        clientKind: input.clientKind,
        accessToken: access.token,
        accessExpiresAt,
        refreshToken: refresh.token,
        refreshExpiresAt: idleExpiresAt,
        absoluteExpiresAt,
      });
    },

    async refresh(
      input: Readonly<{
        refreshToken: string;
        clientIp: string;
        requestId: string;
      }>,
    ): Promise<RefreshedSession> {
      const refreshedAt = now();
      assertClientIp(input.clientIp);
      const refreshFingerprint = fingerprint(
        'refresh-token',
        boundedFingerprintInput(input.refreshToken),
      );
      const throttleResult = await consumeBoth(
        options.throttle,
        [
          {
            bucket: 'refresh-ip',
            key: input.clientIp,
            ...options.config.refreshRateLimit,
          },
          {
            bucket: 'refresh-token',
            key: refreshFingerprint,
            ...options.config.refreshRateLimit,
          },
        ],
        refreshedAt,
      );
      if (!throttleResult.allowed) {
        throw new RefreshRateLimitedError(throttleResult.retryAfterSeconds);
      }
      if (!/^wir_[A-Za-z0-9_-]{43}$/u.test(input.refreshToken)) {
        throw new InvalidRefreshTokenError();
      }
      const presentedTokenHash = hashOpaqueToken(input.refreshToken, 'refresh');

      const access = issueOpaqueToken('access', options.config.tokenEntropyBytes);
      const refresh = issueOpaqueToken('refresh', options.config.tokenEntropyBytes);
      const requestedAccessExpiresAt = addSeconds(
        refreshedAt,
        options.config.accessTokenTtlSeconds,
      );
      const requestedIdleExpiresAt = addSeconds(refreshedAt, options.config.refreshIdleTtlSeconds);
      const outcome = await options.repository.rotateRefresh({
        presentedTokenHash,
        successorTokenHash: refresh.tokenHash,
        accessTokenHash: access.tokenHash,
        requestedAccessExpiresAt,
        requestedIdleExpiresAt,
        now: refreshedAt,
      });

      if (outcome.outcome === 'INVALID') {
        throw new InvalidRefreshTokenError();
      }
      if (outcome.outcome === 'REPLAYED') {
        await options.recordSecurityEvent({
          action: 'session.refresh-reuse',
          requestId: input.requestId,
          accountId: outcome.accountId,
          sessionId: outcome.sessionId,
          reasonCode: 'refresh-reuse',
        });
        void options.onSessionRevoked?.(outcome.sessionId, outcome.accountId);
        throw new RefreshReplayError();
      }
      await options.recordSecurityEvent({
        action: 'session.refreshed',
        requestId: input.requestId,
        accountId: outcome.accountId,
        sessionId: outcome.sessionId,
      });
      return Object.freeze({
        sessionId: outcome.sessionId,
        clientKind: outcome.clientKind,
        accessToken: access.token,
        accessExpiresAt: outcome.accessExpiresAt,
        refreshToken: refresh.token,
        refreshExpiresAt: outcome.refreshExpiresAt,
      });
    },

    async logout(
      input: Readonly<{
        accountId: string;
        sessionId: string;
        requestId: string;
      }>,
    ): Promise<void> {
      await options.repository.revokeSession({
        accountId: input.accountId,
        sessionId: input.sessionId,
        reason: 'logout',
        now: now(),
      });
      await options.recordSecurityEvent({
        action: 'session.logged-out',
        requestId: input.requestId,
        accountId: input.accountId,
        sessionId: input.sessionId,
      });
      void options.onSessionRevoked?.(input.sessionId, input.accountId);
    },

    async revokeOwnedSession(
      input: Readonly<{
        accountId: string;
        sessionId: string;
        requestId: string;
      }>,
    ): Promise<void> {
      const found = await options.repository.revokeSession({
        accountId: input.accountId,
        sessionId: input.sessionId,
        reason: 'owner-revoked',
        now: now(),
      });
      if (!found) {
        throw new OwnedSessionNotFoundError();
      }
      await options.recordSecurityEvent({
        action: 'session.revoked',
        requestId: input.requestId,
        accountId: input.accountId,
        sessionId: input.sessionId,
      });
      void options.onSessionRevoked?.(input.sessionId, input.accountId);
    },

    listSessions(
      accountId: string,
      input: Readonly<{ limit?: number; cursor?: string }> = {},
    ): Promise<SessionPage> {
      const limit = input.limit ?? 20;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw new RangeError('Session inventory limit must be between 1 and 100.');
      }
      return options.repository.listSessions(accountId, {
        limit,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      });
    },

    async revokeAllSessions(
      input: Readonly<{
        accountId: string;
        reason: 'password-reset' | 'account-disabled';
        requestId: string;
      }>,
    ): Promise<number> {
      const count = await options.repository.revokeAllSessions({
        accountId: input.accountId,
        reason: input.reason,
        now: now(),
      });
      await options.recordSecurityEvent({
        action: 'session.all-revoked',
        requestId: input.requestId,
        accountId: input.accountId,
        reasonCode: input.reason,
      });
      void options.onAccountRevoked?.(input.accountId);
      return count;
    },
  });
}

export function createInMemoryAttemptThrottle(): AttemptThrottle {
  const windows = new Map<string, { count: number; resetsAt: number }>();
  const maximumEntries = 10_000;
  let earliestResetAt = Number.POSITIVE_INFINITY;
  return Object.freeze({
    consume(input) {
      const mapKey = `${input.bucket}:${input.key}`;
      const nowMilliseconds = input.now.getTime();
      const existing = windows.get(mapKey);
      const windowMilliseconds = input.windowSeconds * 1_000;
      const state =
        existing === undefined || existing.resetsAt <= nowMilliseconds
          ? { count: 0, resetsAt: nowMilliseconds + windowMilliseconds }
          : existing;
      if (existing === undefined && windows.size >= maximumEntries) {
        if (earliestResetAt <= nowMilliseconds) {
          earliestResetAt = Number.POSITIVE_INFINITY;
          for (const [key, candidate] of windows) {
            if (candidate.resetsAt <= nowMilliseconds) {
              windows.delete(key);
            } else {
              earliestResetAt = Math.min(earliestResetAt, candidate.resetsAt);
            }
          }
        }
        if (windows.size >= maximumEntries) {
          return Promise.resolve(
            Object.freeze({
              allowed: false,
              retryAfterSeconds: Math.max(
                1,
                Math.ceil((earliestResetAt - nowMilliseconds) / 1_000),
              ),
            }),
          );
        }
      }
      state.count += 1;
      windows.set(mapKey, state);
      earliestResetAt = Math.min(earliestResetAt, state.resetsAt);
      return Promise.resolve(
        Object.freeze({
          allowed: state.count <= input.maxAttempts,
          retryAfterSeconds: Math.max(1, Math.ceil((state.resetsAt - nowMilliseconds) / 1_000)),
        }),
      );
    },
  });
}

async function consumeBoth(
  throttle: AttemptThrottle,
  buckets: readonly Readonly<{
    bucket: 'login-ip' | 'login-subject' | 'refresh-ip' | 'refresh-token';
    key: string;
    maxAttempts: number;
    windowSeconds: number;
  }>[],
  now: Date,
): Promise<Readonly<{ allowed: boolean; retryAfterSeconds: number }>> {
  const results = await Promise.all(buckets.map((bucket) => throttle.consume({ ...bucket, now })));
  return Object.freeze({
    allowed: results.every(({ allowed }) => allowed),
    retryAfterSeconds: Math.max(...results.map(({ retryAfterSeconds }) => retryAfterSeconds)),
  });
}

function fingerprint(purpose: string, value: string): string {
  return createHash('sha256')
    .update('wedding.identity-rate-limit.v1', 'utf8')
    .update('\0', 'utf8')
    .update(purpose, 'utf8')
    .update('\0', 'utf8')
    .update(value, 'utf8')
    .digest('base64url');
}

function boundedFingerprintInput(value: string): string {
  return value.length <= 256 ? value : `${value.length}:${value.slice(0, 256)}`;
}

function addSeconds(date: Date, seconds: number): Date {
  if (!Number.isSafeInteger(seconds) || seconds <= 0 || !Number.isFinite(date.getTime())) {
    throw new RangeError('Invalid session lifetime.');
  }
  return new Date(date.getTime() + seconds * 1_000);
}

function assertClientIp(clientIp: string): void {
  if (isIP(clientIp) === 0) {
    throw new InvalidClientIpError();
  }
}
