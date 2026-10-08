import { randomUUID, randomBytes } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { createPasswordOtpService } from '../../src/modules/identity-access/password-otp/password-otp.service.js';
import { hashPassword, verifyPassword } from '../../src/modules/identity-access/crypto/password.js';
import type { SendEmailCommand } from '../../src/integrations/email/email-provider.js';
import type { AuthenticatedActor } from '../../src/modules/identity-access/authorization/authenticated-actor.middleware.js';

const suite = catalogMigrationDatabaseUrl ? describe : describe.skip;
suite('email OTP password confirmation', () => {
  const db = new CatalogTestDatabase('password_otp');
  const messages: SendEmailCommand[] = [];
  let clock = new Date('2026-10-08T12:00:00Z');
  const policy = {
    minimumCharacters: 12,
    maximumCharacters: 128,
    maximumBytes: 512,
    scrypt: {
      cost: 1024,
      blockSize: 8,
      parallelization: 1,
      keyLengthBytes: 32,
      maxMemoryBytes: 67108864,
    },
  };
  const crypto = {
    hash: (password: string) => hashPassword(password, policy),
    verify: (password: string, verifier: unknown) => verifyPassword(password, verifier, policy),
  };
  let service: ReturnType<typeof createPasswordOtpService>;
  beforeAll(async () => {
    await db.connect();
    service = createPasswordOtpService({
      prisma: db.prisma,
      passwordCrypto: crypto,
      hashKey: 'a'.repeat(64),
      emailEnabled: true,
      now: () => clock,
      emailProvider: {
        send(message) {
          messages.push(message);
          return Promise.resolve({
            idempotencyKey: message.idempotencyKey,
            messageId: randomUUID(),
          });
        },
      },
    });
  }, 60_000);
  afterAll(() => db.disconnect());
  async function fixture() {
    const id = randomUUID();
    const email = `${id}@example.com`;
    const sessionId = randomUUID();
    const verifier = await crypto.hash('Initial-password-123');
    await db.prisma.account.create({
      data: {
        id,
        emailNormalized: email,
        displayEmail: email,
        passwordCredential: {
          create: {
            algorithm: verifier.algorithm,
            version: verifier.version,
            ...verifier.parameters,
            saltEncoded: verifier.saltEncoded,
            derivedKeyEncoded: verifier.derivedKeyEncoded,
          },
        },
        sessions: {
          create: {
            id: sessionId,
            clientKind: 'WEB',
            refreshFamilyId: randomUUID(),
            idleExpiresAt: new Date(clock.getTime() + 86400_000),
            absoluteExpiresAt: new Date(clock.getTime() + 86400_000),
            accessCredentials: {
              create: {
                tokenHash: randomBytes(32).toString('base64url'),
                expiresAt: new Date(clock.getTime() + 86400_000),
              },
            },
            refreshCredentials: {
              create: {
                tokenHash: randomBytes(32).toString('base64url'),
                expiresAt: new Date(clock.getTime() + 86400_000),
              },
            },
          },
        },
      },
    });
    const actor: AuthenticatedActor = {
      accountId: id,
      sessionId,
      displayEmail: email,
      roles: ['COUPLE'],
    };
    return { id, email, actor };
  }
  const requestMeta = () => ({ clientIp: '127.0.0.1', requestId: randomUUID() });
  const code = () => messages.at(-1)!.text.match(/\b\d{6}\b/u)![0];
  const advance = () => {
    clock = new Date(clock.getTime() + 61_000);
  };

  it('does not expose a code or account existence; OTPs are HMAC digests, never plaintext', async () => {
    const f = await fixture();
    const known = await service.request({ email: f.email, ...requestMeta() });
    const missing = await service.request({ email: 'missing@example.com', ...requestMeta() });
    expect(Object.keys(known)).toEqual(Object.keys(missing));
    expect(JSON.stringify(known)).not.toContain(code());
    const stored = await db.prisma.passwordOtpChallenge.findUniqueOrThrow({
      where: { id: known.challengeId },
    });
    expect(stored.codeHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(stored.codeHash).not.toContain(code());
    await expect(
      service.complete({
        challengeId: missing.challengeId,
        code: '123456',
        newPassword: 'Replacement-password-123',
        ...requestMeta(),
      }),
    ).rejects.toMatchObject({ code: 'OTP_INVALID_OR_EXPIRED' });
  });
  it('requires current password and binds a change OTP to its original session and purpose', async () => {
    const f = await fixture();
    await expect(
      service.request({ actor: f.actor, currentPassword: 'wrong', ...requestMeta() }),
    ).rejects.toMatchObject({ code: 'CURRENT_PASSWORD_INVALID' });
    advance();
    const challenge = await service.request({
      actor: f.actor,
      currentPassword: 'Initial-password-123',
      ...requestMeta(),
    });
    const otp = code();
    await expect(
      service.complete({
        challengeId: challenge.challengeId,
        code: otp,
        newPassword: 'Replacement-password-123',
        ...requestMeta(),
      }),
    ).rejects.toMatchObject({ code: 'OTP_INVALID_OR_EXPIRED' });
    await expect(
      service.complete({
        actor: { ...f.actor, sessionId: randomUUID() },
        challengeId: challenge.challengeId,
        code: otp,
        newPassword: 'Replacement-password-123',
        ...requestMeta(),
      }),
    ).rejects.toMatchObject({ code: 'OTP_INVALID_OR_EXPIRED' });
    expect(
      await service.complete({
        actor: f.actor,
        challengeId: challenge.challengeId,
        code: otp,
        newPassword: 'Replacement-password-123',
        ...requestMeta(),
      }),
    ).toEqual({ completed: true, requiresLogin: true });
    expect(
      (await db.prisma.session.findUniqueOrThrow({ where: { id: f.actor.sessionId } })).status,
    ).toBe('REVOKED');
    expect(
      await db.prisma.accessCredential.count({
        where: { sessionId: f.actor.sessionId, status: 'ACTIVE' },
      }),
    ).toBe(0);
    expect(
      await db.prisma.refreshCredential.count({
        where: { sessionId: f.actor.sessionId, status: 'ACTIVE' },
      }),
    ).toBe(0);
  });
  it('persists failed attempts, locks after five errors, expires codes, and supersedes them on resend', async () => {
    const f = await fixture();
    const first = await service.request({ email: f.email, ...requestMeta() });
    const correct = code();
    const wrong = correct === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++)
      await expect(
        service.complete({
          challengeId: first.challengeId,
          code: wrong,
          newPassword: 'Replacement-password-123',
          ...requestMeta(),
        }),
      ).rejects.toMatchObject({ code: 'OTP_INVALID_OR_EXPIRED' });
    expect(
      (await db.prisma.passwordOtpChallenge.findUniqueOrThrow({ where: { id: first.challengeId } }))
        .attempts,
    ).toBe(5);
    await expect(
      service.complete({
        challengeId: first.challengeId,
        code: correct,
        newPassword: 'Replacement-password-123',
        ...requestMeta(),
      }),
    ).rejects.toMatchObject({ code: 'OTP_INVALID_OR_EXPIRED' });
    advance();
    const second = await service.request({ email: f.email, ...requestMeta() });
    const secondCode = code();
    advance();
    const third = await service.request({ email: f.email, ...requestMeta() });
    const thirdCode = code();
    await expect(
      service.complete({
        challengeId: second.challengeId,
        code: secondCode,
        newPassword: 'Replacement-password-123',
        ...requestMeta(),
      }),
    ).rejects.toMatchObject({ code: 'OTP_INVALID_OR_EXPIRED' });
    clock = new Date(clock.getTime() + 600_001);
    await expect(
      service.complete({
        challengeId: third.challengeId,
        code: thirdCode,
        newPassword: 'Replacement-password-123',
        ...requestMeta(),
      }),
    ).rejects.toMatchObject({ code: 'OTP_INVALID_OR_EXPIRED' });
  });
  it('atomically consumes a reset OTP: simultaneous submissions change password once', async () => {
    const f = await fixture();
    const challenge = await service.request({ email: f.email, ...requestMeta() });
    const input = {
      challengeId: challenge.challengeId,
      code: code(),
      newPassword: 'Replacement-password-123',
      ...requestMeta(),
    };
    const results = await Promise.allSettled([service.complete(input), service.complete(input)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      await db.prisma.auditLog.count({
        where: { entityId: f.id, action: 'password-reset.completed' },
      }),
    ).toBe(1);
    const credential = await db.prisma.passwordCredential.findUniqueOrThrow({
      where: { accountId: f.id },
    });
    expect(
      (
        await crypto.verify(input.newPassword, {
          ...credential,
          parameters: {
            cost: credential.cost,
            blockSize: credential.blockSize,
            parallelization: credential.parallelization,
            keyLengthBytes: credential.keyLengthBytes,
            maxMemoryBytes: credential.maxMemoryBytes,
          },
        })
      ).matches,
    ).toBe(true);
  });
  it('revokes undelivered OTPs and refuses a disabled mail provider', async () => {
    const f = await fixture();
    const options = {
      prisma: db.prisma,
      passwordCrypto: crypto,
      hashKey: 'b'.repeat(64),
      now: () => clock,
      emailProvider: {
        send(): Promise<never> {
          return Promise.reject(new Error('provider unavailable'));
        },
      },
    };
    await expect(
      createPasswordOtpService({ ...options, emailEnabled: false }).request({
        email: f.email,
        ...requestMeta(),
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_NOT_CONFIGURED' });
    await expect(
      createPasswordOtpService({ ...options, emailEnabled: true }).request({
        email: f.email,
        ...requestMeta(),
      }),
    ).rejects.toMatchObject({ code: 'OTP_EMAIL_DELIVERY_FAILED' });
    expect(
      await db.prisma.passwordOtpChallenge.count({ where: { accountId: f.id, status: 'ACTIVE' } }),
    ).toBe(0);
  });
});
