import { createIdentityLocks } from '../account/identity-locks.js';
import { createHmac, createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import { AppError, RateLimitError } from '../../../core/errors/app-error.js';
import {
  createEmailIntentIdempotencyKey,
  type EmailProvider,
} from '../../../integrations/email/email-provider.js';
import { PasswordPolicyError, type ScryptPasswordVerifier } from '../crypto/password.js';
import type { AuthenticatedActor } from '../authorization/authenticated-actor.middleware.js';
import { createInMemoryAttemptThrottle } from '../session/session.service.js';

type Purpose = 'RESET' | 'CHANGE';
type Crypto = Readonly<{
  hash(password: string): Promise<ScryptPasswordVerifier>;
  verify(password: string, verifier: unknown): Promise<Readonly<{ matches: boolean }>>;
}>;
export function createPasswordOtpService(options: {
  prisma: PrismaClient;
  emailProvider: EmailProvider;
  passwordCrypto: Crypto;
  hashKey: string;
  emailEnabled: boolean;
  schema?: string;
  now?: () => Date;
}) {
  if (Buffer.byteLength(options.hashKey) < 32)
    throw new TypeError('OTP hash key must contain at least 32 bytes.');
  const locks = createIdentityLocks(options.schema);
  const now = options.now ?? (() => new Date());
  const throttle = createInMemoryAttemptThrottle();
  const digest = (id: string, purpose: Purpose, code: string) =>
    createHmac('sha256', options.hashKey)
      .update(`wedding.otp.v1\0${id}\0${purpose}\0${code}`)
      .digest('hex');

  async function request(input: {
    email?: string;
    currentPassword?: string;
    actor?: AuthenticatedActor;
    clientIp: string;
    requestId: string;
  }) {
    if (!options.emailEnabled) throw failure(503, 'EMAIL_NOT_CONFIGURED');
    const purpose: Purpose = input.actor ? 'CHANGE' : 'RESET';
    const normalized = input.email?.trim().toLowerCase() ?? input.actor!.accountId;
    const requestedAt = now();
    const subject = createHash('sha256').update(`${purpose}:${normalized}`).digest('hex');
    for (const rule of [
      {
        bucket: 'reset-request-subject' as const,
        key: subject,
        maxAttempts: 3,
        windowSeconds: 3600,
      },
      {
        bucket: 'reset-request-subject' as const,
        key: `cooldown:${subject}`,
        maxAttempts: 1,
        windowSeconds: 60,
      },
      {
        bucket: 'reset-request-ip' as const,
        key: input.clientIp,
        maxAttempts: 20,
        windowSeconds: 3600,
      },
    ]) {
      const result = await throttle.consume({ ...rule, now: requestedAt });
      if (!result.allowed) throw new RateLimitError(result.retryAfterSeconds);
    }
    const id = randomUUID();
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const account = await options.prisma.account.findFirst({
      where: {
        status: 'ACTIVE',
        ...(input.actor ? { id: input.actor.accountId } : { emailNormalized: normalized }),
      },
      include: { passwordCredential: true },
    });
    const response = {
      accepted: true as const,
      challengeId: id,
      expiresInSeconds: 600 as const,
      resendAfterSeconds: 60 as const,
    };
    if (account === null || account.passwordCredential === null) return response;
    const previous = account.passwordCredential;
    if (
      input.actor &&
      !(await options.passwordCrypto.verify(input.currentPassword ?? '', verifierData(previous)))
        .matches
    ) {
      throw failure(422, 'CURRENT_PASSWORD_INVALID');
    }
    await options.prisma.$transaction(async (tx) => {
      await locks.account(tx, account.id);
      if (input.actor) await requireSession(tx, input.actor, requestedAt, locks);
      // Also survives process restarts and concurrent requests in the local demo.
      const latest = await tx.passwordOtpChallenge.findFirst({
        where: { accountId: account.id, purpose },
        orderBy: { createdAt: 'desc' },
      });
      if (latest && latest.createdAt.getTime() + 60_000 > requestedAt.getTime())
        throw new RateLimitError(60);
      await tx.passwordOtpChallenge.updateMany({
        where: { accountId: account.id, purpose, status: 'ACTIVE' },
        data: { status: 'REVOKED' },
      });
      await tx.passwordOtpChallenge.create({
        data: {
          id,
          accountId: account.id,
          purpose,
          codeHash: digest(id, purpose, code),
          sessionId: input.actor?.sessionId ?? null,
          credentialFingerprint: fingerprint(previous),
          expiresAt: new Date(requestedAt.getTime() + 600_000),
          createdAt: requestedAt,
        },
      });
    });
    try {
      await options.emailProvider.send({
        idempotencyKey: createEmailIntentIdempotencyKey({
          entityId: id,
          intentType: purpose === 'RESET' ? 'password-reset-otp' : 'password-change-otp',
        }),
        to: [account.displayEmail],
        subject:
          purpose === 'RESET'
            ? 'Mã OTP đặt lại mật khẩu — Wedding Estate'
            : 'Mã OTP đổi mật khẩu — Wedding Estate',
        text: `Mã xác nhận của bạn: ${code}\nMã có hiệu lực trong 10 phút và chỉ dùng một lần. Không chia sẻ mã này với bất kỳ ai. Nếu bạn không yêu cầu thay đổi mật khẩu, hãy bỏ qua thư này.`,
      });
    } catch {
      await options.prisma.passwordOtpChallenge.updateMany({
        where: { id, status: 'ACTIVE' },
        data: { status: 'REVOKED' },
      });
      throw failure(503, 'OTP_EMAIL_DELIVERY_FAILED');
    }
    return response;
  }

  async function complete(input: {
    challengeId: string;
    code: string;
    newPassword: string;
    actor?: AuthenticatedActor;
    clientIp: string;
    requestId: string;
  }) {
    const purpose: Purpose = input.actor ? 'CHANGE' : 'RESET';
    const completedAt = now();
    const limit = await throttle.consume({
      bucket: 'reset-complete-ip',
      key: input.clientIp,
      maxAttempts: 20,
      windowSeconds: 900,
      now: completedAt,
    });
    if (!limit.allowed) throw new RateLimitError(limit.retryAfterSeconds);
    const candidate = await options.prisma.passwordOtpChallenge.findUnique({
      where: { id: input.challengeId },
    });
    if (candidate === null) throw failure(422, 'OTP_INVALID_OR_EXPIRED');
    let verifier: ScryptPasswordVerifier;
    try {
      verifier = await options.passwordCrypto.hash(input.newPassword);
    } catch (error) {
      if (error instanceof PasswordPolicyError) throw failure(422, 'VALIDATION_ERROR');
      throw error;
    }
    // Account lock serializes issuance, consumption, password mutation, and revocation.
    const outcome = await options.prisma.$transaction(async (tx) => {
      await locks.account(tx, candidate.accountId);
      const challenge = await tx.passwordOtpChallenge.findUniqueOrThrow({
        where: { id: input.challengeId },
      });
      if (
        challenge.purpose !== purpose ||
        challenge.status !== 'ACTIVE' ||
        challenge.attempts >= 5 ||
        challenge.expiresAt <= completedAt ||
        (input.actor &&
          (challenge.accountId !== input.actor.accountId ||
            challenge.sessionId !== input.actor.sessionId))
      )
        return false;
      const account = await tx.account.findUnique({
        where: { id: challenge.accountId },
        include: { passwordCredential: true },
      });
      if (
        account?.status !== 'ACTIVE' ||
        !account.passwordCredential ||
        challenge.credentialFingerprint !== fingerprint(account.passwordCredential)
      )
        return false;
      if (input.actor) await requireSession(tx, input.actor, completedAt, locks);
      if (
        !timingSafeEqual(
          Buffer.from(challenge.codeHash, 'hex'),
          Buffer.from(digest(challenge.id, purpose, input.code), 'hex'),
        )
      ) {
        await tx.passwordOtpChallenge.update({
          where: { id: challenge.id },
          data: {
            attempts: { increment: 1 },
            ...(challenge.attempts === 4 ? { status: 'REVOKED' as const } : {}),
          },
        });
        return false; // Commit the failed attempt; do not roll it back by throwing here.
      }
      await tx.passwordOtpChallenge.update({
        where: { id: challenge.id },
        data: { status: 'CONSUMED', consumedAt: completedAt },
      });
      await tx.passwordCredential.update({
        where: { accountId: challenge.accountId },
        data: {
          algorithm: verifier.algorithm,
          version: verifier.version,
          ...verifier.parameters,
          saltEncoded: verifier.saltEncoded,
          derivedKeyEncoded: verifier.derivedKeyEncoded,
        },
      });
      await tx.passwordOtpChallenge.updateMany({
        where: { accountId: challenge.accountId, status: 'ACTIVE' },
        data: { status: 'REVOKED' },
      });
      await tx.passwordResetCredential.updateMany({
        where: { accountId: challenge.accountId, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: completedAt },
      });
      await tx.session.updateMany({
        where: { accountId: challenge.accountId, status: 'ACTIVE' },
        data: {
          status: 'REVOKED',
          revokedAt: completedAt,
          revocationReason: purpose === 'RESET' ? 'password-reset' : 'password-change',
        },
      });
      await tx.accessCredential.updateMany({
        where: { session: { accountId: challenge.accountId }, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: completedAt },
      });
      await tx.refreshCredential.updateMany({
        where: { session: { accountId: challenge.accountId }, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: completedAt },
      });
      await tx.auditLog.create({
        data: {
          requestId: input.requestId,
          actorType: input.actor ? 'USER' : 'SYSTEM',
          actorId: input.actor?.accountId ?? null,
          action: purpose === 'RESET' ? 'password-reset.completed' : 'account.password-changed',
          entityType: 'account',
          entityId: challenge.accountId,
          metadata: { otpVerified: true, allSessionsRevoked: true },
        },
      });
      return true;
    });
    if (!outcome) throw failure(422, 'OTP_INVALID_OR_EXPIRED');
    return { completed: true as const, requiresLogin: true as const };
  }
  return { request, complete };
}
export type PasswordOtpService = ReturnType<typeof createPasswordOtpService>;
function failure(status: number, code: string) {
  return new AppError({
    status,
    code,
    message: 'The password confirmation could not be completed.',
  });
}
function fingerprint(credential: { saltEncoded: string; derivedKeyEncoded: string }) {
  return createHash('sha256')
    .update(`${credential.saltEncoded}:${credential.derivedKeyEncoded}`)
    .digest('hex');
}
function verifierData(credential: {
  algorithm: string;
  version: number;
  cost: number;
  blockSize: number;
  parallelization: number;
  keyLengthBytes: number;
  maxMemoryBytes: number;
  saltEncoded: string;
  derivedKeyEncoded: string;
}) {
  return {
    algorithm: credential.algorithm,
    version: credential.version,
    parameters: {
      cost: credential.cost,
      blockSize: credential.blockSize,
      parallelization: credential.parallelization,
      keyLengthBytes: credential.keyLengthBytes,
      maxMemoryBytes: credential.maxMemoryBytes,
    },
    saltEncoded: credential.saltEncoded,
    derivedKeyEncoded: credential.derivedKeyEncoded,
  };
}
async function requireSession(
  tx: Prisma.TransactionClient,
  actor: AuthenticatedActor,
  now: Date,
  locks: ReturnType<typeof createIdentityLocks>,
) {
  await locks.session(tx, actor.sessionId);
  const active = await tx.session.findFirst({
    where: {
      id: actor.sessionId,
      accountId: actor.accountId,
      status: 'ACTIVE',
      idleExpiresAt: { gt: now },
      absoluteExpiresAt: { gt: now },
    },
  });
  if (!active) throw failure(401, 'SESSION_REVOKED');
}
