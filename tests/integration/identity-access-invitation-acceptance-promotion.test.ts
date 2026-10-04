import 'dotenv/config';

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConflictError } from '../../src/core/errors/app-error.js';
import { createPrismaClient } from '../../src/core/database/prisma.js';
import {
  createCoupleAccessPromoter,
  createPrismaCoupleAccessPromotionRepository,
} from '../../src/modules/identity-access/authorization/couple-access-promotion.js';
import { hashPassword, verifyPassword } from '../../src/modules/identity-access/crypto/password.js';
import { hashOpaqueToken } from '../../src/modules/identity-access/crypto/token.js';
import { createInMemoryAttemptThrottle } from '../../src/modules/identity-access/session/session.service.js';
import {
  createWorkspaceInvitationAcceptanceService,
  InvalidOrExpiredInvitationError,
} from '../../src/modules/identity-access/workspace-invitation/workspace-invitation.acceptance.js';
import { createPrismaWorkspaceInvitationRepository } from '../../src/modules/identity-access/workspace-invitation/workspace-invitation.repository.js';

const execFileAsync = promisify(execFile);
const migrationDatabaseUrl = process.env.TEST_MIGRATION_DATABASE_URL?.trim();
const describeWithDatabase = migrationDatabaseUrl ? describe : describe.skip;
const baseUrl = migrationDatabaseUrl ?? 'postgresql://unused:unused@127.0.0.1:1/unused';
const passwordPolicy = {
  minimumCharacters: 12,
  maximumCharacters: 128,
  maximumBytes: 512,
  scrypt: {
    cost: 2,
    blockSize: 1,
    parallelization: 1,
    keyLengthBytes: 16,
    maxMemoryBytes: 4096,
  },
} as const;

describeWithDatabase('IA-11 and IA-12 identity transitions', () => {
  const schemaName = `identity_acceptance_${randomUUID().replaceAll('-', '')}`;
  const scopedUrl = withSchema(baseUrl, schemaName);
  const admin = new Client({ connectionString: baseUrl });
  const prisma = createPrismaClient(scopedUrl);
  const invitations = createPrismaWorkspaceInvitationRepository(prisma);
  let issuerId: string;

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
    await deployMigrations(scopedUrl);
    await prisma.$connect();
    issuerId = (
      await prisma.account.create({
        data: { emailNormalized: 'manager@example.com', displayEmail: 'manager@example.com' },
      })
    ).id;
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await admin.query(`DROP SCHEMA ${quoteIdentifier(schemaName)} CASCADE`);
    await admin.end();
  });

  it('proves ACC-006 by atomically creating one account, access, and session', async () => {
    const now = new Date('2026-10-03T00:00:00.000Z');
    const token = await issueInvitation('new-couple@example.com', randomUUID(), 'a', now);
    const acceptance = acceptanceService(now);

    const outcomes = await Promise.allSettled([
      acceptance.accept(command(token, 'new-password-123')),
      acceptance.accept(command(token, 'new-password-123')),
    ]);
    const outcomeSummary = outcomes.map((outcome) =>
      outcome.status === 'fulfilled'
        ? 'fulfilled'
        : outcome.reason instanceof Error
          ? `${outcome.reason.name}: ${outcome.reason.message}`
          : String(outcome.reason),
    );

    expect(
      outcomes.filter(({ status }) => status === 'fulfilled'),
      outcomeSummary.join(' | '),
    ).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const account = await prisma.account.findUniqueOrThrow({
      where: { emailNormalized: 'new-couple@example.com' },
      include: { consultationAccesses: true, sessions: true, roles: true },
    });
    expect(account.consultationAccesses).toHaveLength(1);
    expect(account.consultationAccesses[0]?.level).toBe('RESTRICTED');
    expect(account.sessions).toHaveLength(1);
    expect(account.roles).toHaveLength(0);
    const storedInvitation = await prisma.workspaceInvitation.findUniqueOrThrow({
      where: { tokenHash: hashOpaqueToken(token, 'invitation') },
    });
    expect(storedInvitation).toMatchObject({ status: 'ACCEPTED', resolvedAccountId: account.id });
    expect(
      JSON.stringify(await prisma.auditLog.findMany({ where: { entityId: storedInvitation.id } })),
    ).not.toMatch(/new-couple@example|new-password|wii_|tokenHash/iu);
  });

  it('verifies an existing password, preserves its credential, and rejects mismatch and expiry', async () => {
    const verifier = await hashPassword('existing-password', passwordPolicy);
    const account = await prisma.account.create({
      data: {
        emailNormalized: 'existing@example.com',
        displayEmail: 'Existing@example.com',
        passwordCredential: { create: verifierData(verifier) },
      },
      include: { passwordCredential: true },
    });
    const now = new Date('2026-10-04T00:00:00.000Z');
    const token = await issueInvitation('existing@example.com', randomUUID(), 'b', now);
    const acceptance = acceptanceService(now);

    await expect(acceptance.accept(command(token, 'wrong-password'))).rejects.toBeInstanceOf(
      InvalidOrExpiredInvitationError,
    );
    await expect(acceptance.accept(command(token, 'existing-password'))).resolves.toMatchObject({
      account: { accountId: account.id },
      clientKind: 'WEB',
    });
    const after = await prisma.passwordCredential.findUniqueOrThrow({
      where: { accountId: account.id },
    });
    expect(after.derivedKeyEncoded).toBe(account.passwordCredential?.derivedKeyEncoded);

    const expiredToken = await issueInvitation(
      'expired@example.com',
      randomUUID(),
      'c',
      new Date('2026-10-01T00:00:00.000Z'),
      60,
    );
    await expect(
      acceptance.accept(command(expiredToken, 'new-password-123')),
    ).rejects.toBeInstanceOf(InvalidOrExpiredInvitationError);
  });

  it('proves ACC-005 by serializing races and preserving identity during promotion', async () => {
    const now = new Date('2026-10-05T00:00:00.000Z');
    const consultationId = randomUUID();
    const token = await issueInvitation('promotion@example.com', consultationId, 'd', now);
    const replacementToken = `wii_${'e'.repeat(43)}`;
    const acceptance = acceptanceService(now);
    const race = await Promise.allSettled([
      acceptance.accept(command(token, 'new-password-123')),
      invitations.reissue({
        ...invitationInput('promotion@example.com', consultationId, now),
        tokenHash: hashOpaqueToken(replacementToken, 'invitation'),
        now: new Date(now.getTime() + 1),
      }),
    ]);
    expect(race.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);

    let account = await prisma.account.findUnique({
      where: { emailNormalized: 'promotion@example.com' },
    });
    if (account === null) {
      await acceptanceService(new Date(now.getTime() + 2)).accept(
        command(replacementToken, 'new-password-123'),
      );
      account = await prisma.account.findUniqueOrThrow({
        where: { emailNormalized: 'promotion@example.com' },
      });
    }

    const promoter = createCoupleAccessPromoter(
      createPrismaCoupleAccessPromotionRepository(prisma),
    );
    const evidence = {
      accountId: account.id,
      consultationId,
      sourcePaymentId: randomUUID(),
      requestId: randomUUID(),
    };
    const promotions = await Promise.all([promoter.promote(evidence), promoter.promote(evidence)]);
    expect(promotions.map(({ replayed }) => replayed).sort()).toEqual([false, true]);
    expect(new Set(promotions.map(({ accessId }) => accessId)).size).toBe(1);
    const access = await prisma.consultationAccess.findUniqueOrThrow({
      where: { accountId_consultationId: { accountId: account.id, consultationId } },
    });
    expect(access.level).toBe('FULL');
    await expect(
      prisma.accountRole.count({ where: { accountId: account.id, role: 'COUPLE' } }),
    ).resolves.toBe(1);

    const other = await prisma.account.create({
      data: {
        emailNormalized: 'other@example.com',
        displayEmail: 'other@example.com',
        consultationAccesses: { create: { consultationId: randomUUID() } },
      },
      include: { consultationAccesses: true },
    });
    await expect(
      promoter.promote({
        accountId: other.id,
        consultationId: other.consultationAccesses[0]!.consultationId,
        sourcePaymentId: evidence.sourcePaymentId,
        requestId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    const conflictAudit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'consultation-access.promotion-conflict' },
    });
    expect(JSON.stringify(conflictAudit)).not.toContain(evidence.sourcePaymentId);
  });

  function acceptanceService(now: Date) {
    return createWorkspaceInvitationAcceptanceService({
      repository: invitations,
      passwordCrypto: {
        hash: (password) => hashPassword(password, passwordPolicy),
        verify: (password, verifier) => verifyPassword(password, verifier, passwordPolicy),
      },
      throttle: createInMemoryAttemptThrottle(),
      config: {
        tokenEntropyBytes: 32,
        accessTokenTtlSeconds: 600,
        refreshIdleTtlSeconds: 2_592_000,
        refreshAbsoluteTtlSeconds: 7_776_000,
        tokenConsumeRateLimit: { maxAttempts: 10, windowSeconds: 900 },
      },
      now: () => now,
    });
  }

  async function issueInvitation(
    email: string,
    consultationId: string,
    tokenCharacter: string,
    now: Date,
    lifetimeSeconds = 259_200,
  ): Promise<string> {
    const token = `wii_${tokenCharacter.repeat(43)}`;
    await invitations.issue({
      ...invitationInput(email, consultationId, now, lifetimeSeconds),
      tokenHash: hashOpaqueToken(token, 'invitation'),
    });
    return token;
  }

  function invitationInput(
    email: string,
    consultationId: string,
    now: Date,
    lifetimeSeconds = 259_200,
  ) {
    return {
      consultationId,
      recipientEmailNormalized: email,
      issuedByAccountId: issuerId,
      tokenHash: 'x'.repeat(43),
      expiresAt: new Date(now.getTime() + lifetimeSeconds * 1_000),
      now,
      requestId: randomUUID(),
      reissueLimit: 3,
      reissueWindowSeconds: 86_400,
    };
  }
});

function command(invitationToken: string, password: string) {
  return { invitationToken, password, clientIp: '127.0.0.1', requestId: randomUUID() };
}
function verifierData(verifier: Awaited<ReturnType<typeof hashPassword>>) {
  return {
    algorithm: verifier.algorithm,
    version: verifier.version,
    cost: verifier.parameters.cost,
    blockSize: verifier.parameters.blockSize,
    parallelization: verifier.parameters.parallelization,
    keyLengthBytes: verifier.parameters.keyLengthBytes,
    maxMemoryBytes: verifier.parameters.maxMemoryBytes,
    saltEncoded: verifier.saltEncoded,
    derivedKeyEncoded: verifier.derivedKeyEncoded,
  };
}
function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
function withSchema(databaseUrl: string, schema: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('schema', schema);
  return url.toString();
}
async function deployMigrations(databaseUrl: string): Promise<void> {
  const cli = join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
  await execFileAsync(
    process.execPath,
    [cli, 'migrate', 'deploy', '--config', 'prisma.config.ts'],
    {
      cwd: process.cwd(),
      env: { ...process.env, MIGRATION_DATABASE_URL: databaseUrl },
      maxBuffer: 1024 * 1024,
    },
  );
}
