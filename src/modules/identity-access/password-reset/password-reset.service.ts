import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

import { RateLimitError } from '../../../core/errors/app-error.js';
import { normalizeEmail, type PasswordCrypto } from '../account/account.service.js';
import { hashOpaqueToken, issueOpaqueToken } from '../crypto/token.js';
import type { IdentityNotificationPort } from '../identity-notification.port.js';
import type { AttemptThrottle, AttemptThrottleBucket } from '../session/session.service.js';
import type { PasswordResetRepository } from './password-reset.repository.js';

export class InvalidOrExpiredResetTokenError extends Error {
  override readonly name = 'InvalidOrExpiredResetTokenError';

  constructor() {
    super('The password reset credential is invalid or expired.');
  }
}

export function createPasswordResetService(
  options: Readonly<{
    repository: PasswordResetRepository;
    passwordCrypto: Pick<PasswordCrypto, 'hash'>;
    notificationPort: IdentityNotificationPort;
    throttle: AttemptThrottle;
    config: Readonly<{
      tokenEntropyBytes: number;
      lifetimeSeconds: number;
      requestRateLimit: Readonly<{ maxAttempts: number; windowSeconds: number }>;
      completionRateLimit: Readonly<{ maxAttempts: number; windowSeconds: number }>;
    }>;
    now?: () => Date;
  }>,
) {
  const now = options.now ?? (() => new Date());

  return Object.freeze({
    async request(
      input: Readonly<{
        email: string;
        clientIp: string;
        requestId: string;
      }>,
    ): Promise<Readonly<{ accepted: true }>> {
      assertIp(input.clientIp);
      const requestedAt = now();
      const email = normalizeEmail(input.email);
      await enforceThrottle(
        options.throttle,
        [
          { bucket: 'reset-request-ip', key: input.clientIp, ...options.config.requestRateLimit },
          {
            bucket: 'reset-request-subject',
            key: fingerprint('reset-subject', email.normalized),
            ...options.config.requestRateLimit,
          },
        ],
        requestedAt,
      );

      const account = await options.repository.findEligibleAccount(email.normalized);
      if (account === null) {
        return Object.freeze({ accepted: true as const });
      }
      const issued = issueOpaqueToken('password-reset', options.config.tokenEntropyBytes);
      const credential = await options.repository.createCredential({
        accountId: account.accountId,
        tokenHash: issued.tokenHash,
        expiresAt: addSeconds(requestedAt, options.config.lifetimeSeconds),
        now: requestedAt,
        requestId: input.requestId,
      });
      await options.notificationPort.sendPasswordReset({
        credentialId: credential.credentialId,
        recipientEmail: account.displayEmail,
        resetToken: issued.token,
      });
      return Object.freeze({ accepted: true as const });
    },

    async complete(
      input: Readonly<{
        resetToken: string;
        newPassword: string;
        clientIp: string;
        requestId: string;
      }>,
    ): Promise<Readonly<{ completed: true }>> {
      assertIp(input.clientIp);
      const completedAt = now();
      const boundedToken =
        input.resetToken.length <= 256
          ? input.resetToken
          : `${input.resetToken.length}:${input.resetToken.slice(0, 256)}`;
      await enforceThrottle(
        options.throttle,
        [
          {
            bucket: 'reset-complete-ip',
            key: input.clientIp,
            ...options.config.completionRateLimit,
          },
          {
            bucket: 'reset-token',
            key: fingerprint('reset-token', boundedToken),
            ...options.config.completionRateLimit,
          },
        ],
        completedAt,
      );
      if (!/^wip_[A-Za-z0-9_-]{43}$/u.test(input.resetToken)) {
        throw new InvalidOrExpiredResetTokenError();
      }
      const passwordVerifier = await options.passwordCrypto.hash(input.newPassword);
      const completed = await options.repository.complete({
        resetTokenHash: hashOpaqueToken(input.resetToken, 'password-reset'),
        passwordVerifier,
        now: completedAt,
        requestId: input.requestId,
      });
      if (!completed) {
        throw new InvalidOrExpiredResetTokenError();
      }
      return Object.freeze({ completed: true as const });
    },
  });
}

async function enforceThrottle(
  throttle: AttemptThrottle,
  buckets: readonly Readonly<{
    bucket: AttemptThrottleBucket;
    key: string;
    maxAttempts: number;
    windowSeconds: number;
  }>[],
  now: Date,
): Promise<void> {
  const results = await Promise.all(buckets.map((bucket) => throttle.consume({ ...bucket, now })));
  if (results.some(({ allowed }) => !allowed)) {
    throw new RateLimitError(
      Math.max(...results.map(({ retryAfterSeconds }) => retryAfterSeconds)),
    );
  }
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
    throw new RangeError('Invalid password reset lifetime.');
  }
  return new Date(date.getTime() + seconds * 1_000);
}

function assertIp(value: string): void {
  if (isIP(value) === 0) {
    throw new TypeError('The resolved client IP is invalid.');
  }
}
