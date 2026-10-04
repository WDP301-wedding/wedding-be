import 'dotenv/config';

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../../src/core/database/prisma.js';
import {
  createIdentityRetentionService,
  createPrismaIdentityRetentionRepository,
} from '../../src/modules/identity-access/account/identity-retention.js';

const execFileAsync = promisify(execFile);
const migrationDatabaseUrl = process.env.TEST_MIGRATION_DATABASE_URL?.trim();
const describeWithDatabase = migrationDatabaseUrl ? describe : describe.skip;
const baseUrl = migrationDatabaseUrl ?? 'postgresql://unused:unused@127.0.0.1:1/unused';
const now = new Date('2027-01-01T00:00:00.000Z');

describeWithDatabase('identity retention execution', () => {
  const schemaName = `identity_retention_${randomUUID().replaceAll('-', '')}`;
  const scopedUrl = withSchema(baseUrl, schemaName);
  const admin = new Client({ connectionString: baseUrl });
  const prisma = createPrismaClient(scopedUrl);
  const repository = createPrismaIdentityRetentionRepository(prisma, { schema: schemaName });

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
    await deployMigrations(scopedUrl);
    await prisma.$connect();
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await admin.query(`DROP SCHEMA ${quoteIdentifier(schemaName)} CASCADE`);
    await admin.end();
  });

  it('anonymizes due PII once and revokes remaining authentication material', async () => {
    const accountId = await createDueAccount('due@example.com');
    const session = await prisma.session.create({
      data: {
        accountId,
        clientKind: 'WEB',
        refreshFamilyId: randomUUID(),
        idleExpiresAt: new Date('2027-02-01T00:00:00.000Z'),
        absoluteExpiresAt: new Date('2027-03-01T00:00:00.000Z'),
        accessCredentials: {
          create: { tokenHash: 'a'.repeat(43), expiresAt: new Date('2027-01-02T00:00:00.000Z') },
        },
        refreshCredentials: {
          create: { tokenHash: 'b'.repeat(43), expiresAt: new Date('2027-02-01T00:00:00.000Z') },
        },
      },
    });
    await prisma.passwordCredential.create({ data: { accountId, ...verifierData() } });
    await prisma.passwordResetCredential.create({
      data: {
        accountId,
        tokenHash: 'c'.repeat(43),
        expiresAt: new Date('2027-01-02T00:00:00.000Z'),
      },
    });
    await prisma.workspaceInvitation.create({
      data: {
        consultationId: randomUUID(),
        recipientEmailNormalized: 'due@example.com',
        resolvedAccountId: accountId,
        issuedByAccountId: accountId,
        sequence: 1,
        tokenHash: 'd'.repeat(43),
        expiresAt: new Date('2027-01-02T00:00:00.000Z'),
      },
    });

    const result = await service().run({ batchSize: 10 });

    expect(result.anonymizedAccounts).toBe(1);
    await expect(
      prisma.account.findUniqueOrThrow({ where: { id: accountId } }),
    ).resolves.toMatchObject({
      emailNormalized: `anonymized-${accountId}@identity.invalid`,
      displayEmail: 'anonymized@identity.invalid',
      piiAnonymizedAt: now,
    });
    await expect(
      prisma.passwordCredential.findUnique({ where: { accountId } }),
    ).resolves.toBeNull();
    await expect(
      prisma.session.findUniqueOrThrow({ where: { id: session.id } }),
    ).resolves.toMatchObject({
      status: 'REVOKED',
      revokedAt: now,
      revocationReason: 'PII_RETENTION',
    });
    await expect(
      prisma.accessCredential.findFirstOrThrow({ where: { sessionId: session.id } }),
    ).resolves.toMatchObject({
      status: 'REVOKED',
      revokedAt: now,
    });
    await expect(
      prisma.refreshCredential.findFirstOrThrow({ where: { sessionId: session.id } }),
    ).resolves.toMatchObject({
      status: 'REVOKED',
      revokedAt: now,
    });
    await expect(
      prisma.passwordResetCredential.findFirstOrThrow({ where: { accountId } }),
    ).resolves.toMatchObject({
      status: 'REVOKED',
      revokedAt: now,
    });
    await expect(
      prisma.workspaceInvitation.findFirstOrThrow({ where: { resolvedAccountId: accountId } }),
    ).resolves.toMatchObject({
      recipientEmailNormalized: `anonymized-${accountId}@identity.invalid`,
      status: 'REVOKED',
      revokedAt: now,
    });
    const audits = await prisma.auditLog.findMany({ where: { action: 'account.pii.anonymized' } });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toMatch(/due@example|a{43}|b{43}|c{43}|d{43}/iu);
  });

  it('keeps held and incomplete accounts unchanged', async () => {
    const heldId = await createDueAccount('held@example.com', {
      legalHoldUntil: new Date('2028-01-01T00:00:00.000Z'),
    });
    const incomplete = await prisma.account.create({
      data: {
        emailNormalized: 'incomplete@example.com',
        displayEmail: 'incomplete@example.com',
        status: 'DISABLED',
        disabledAt: new Date('2025-01-01T00:00:00.000Z'),
        piiRetentionEligibleAt: new Date('2026-01-01T00:00:00.000Z'),
        consultationAccesses: { create: { consultationId: randomUUID() } },
      },
    });

    await expect(service().run({ batchSize: 10 })).resolves.toMatchObject({
      anonymizedAccounts: 0,
    });
    await expect(
      prisma.account.findUniqueOrThrow({ where: { id: heldId } }),
    ).resolves.toMatchObject({
      emailNormalized: 'held@example.com',
      piiAnonymizedAt: null,
    });
    await expect(
      prisma.account.findUniqueOrThrow({ where: { id: incomplete.id } }),
    ).resolves.toMatchObject({
      emailNormalized: 'incomplete@example.com',
      piiAnonymizedAt: null,
    });
  });

  it('deletes only terminal metadata older than the approved windows', async () => {
    const issuer = await prisma.account.create({
      data: { emailNormalized: 'issuer@example.com', displayEmail: 'issuer@example.com' },
    });
    const account = await prisma.account.create({
      data: { emailNormalized: 'cleanup@example.com', displayEmail: 'cleanup@example.com' },
    });
    await prisma.workspaceInvitation.create({
      data: {
        consultationId: randomUUID(),
        recipientEmailNormalized: 'cleanup@example.com',
        issuedByAccountId: issuer.id,
        sequence: 1,
        tokenHash: 'e'.repeat(43),
        status: 'ACCEPTED',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        acceptedAt: new Date('2026-07-04T00:00:00.000Z'),
        expiresAt: new Date('2026-07-05T00:00:00.000Z'),
      },
    });
    await prisma.passwordResetCredential.create({
      data: {
        accountId: account.id,
        tokenHash: 'f'.repeat(43),
        status: 'CONSUMED',
        createdAt: new Date('2026-12-01T00:00:00.000Z'),
        consumedAt: new Date('2026-12-02T00:00:00.000Z'),
        expiresAt: new Date('2026-12-03T00:00:00.000Z'),
      },
    });
    await prisma.session.create({
      data: {
        accountId: account.id,
        clientKind: 'ANDROID',
        status: 'REVOKED',
        refreshFamilyId: randomUUID(),
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        idleExpiresAt: new Date('2026-10-04T00:00:00.000Z'),
        absoluteExpiresAt: new Date('2026-10-04T00:00:00.000Z'),
        revokedAt: new Date('2026-10-03T00:00:00.000Z'),
      },
    });

    await expect(service().run({ batchSize: 10 })).resolves.toMatchObject({
      deletedInvitations: 1,
      deletedPasswordResets: 1,
      deletedSessions: 1,
    });
  });

  it('lets concurrent workers anonymize an account only once', async () => {
    const accountId = await createDueAccount('race@example.com');

    const outcomes = await Promise.all([
      service().run({ batchSize: 1 }),
      service().run({ batchSize: 1 }),
    ]);

    expect(outcomes.reduce((total, result) => total + result.anonymizedAccounts, 0)).toBe(1);
    await expect(
      prisma.auditLog.count({ where: { action: 'account.pii.anonymized', entityId: accountId } }),
    ).resolves.toBe(1);
  });

  function service() {
    return createIdentityRetentionService({
      repository,
      retentionDays: {
        invitation: 180,
        passwordReset: 30,
        session: 90,
        disabledAccountPii: 365,
      },
      now: () => now,
      requestId: randomUUID,
    });
  }

  async function createDueAccount(
    email: string,
    options: { legalHoldUntil?: Date } = {},
  ): Promise<string> {
    const consultationId = randomUUID();
    const account = await prisma.account.create({
      data: {
        emailNormalized: email,
        displayEmail: email,
        status: 'DISABLED',
        disabledAt: new Date('2025-01-01T00:00:00.000Z'),
        piiRetentionEligibleAt: new Date('2026-01-01T00:00:00.000Z'),
        ...(options.legalHoldUntil === undefined ? {} : { legalHoldUntil: options.legalHoldUntil }),
        consultationAccesses: { create: { consultationId } },
        retentionFacts: {
          create: {
            consultationId,
            sourceBusinessRecordId: randomUUID(),
            eligibleAfter: new Date('2025-01-01T00:00:00.000Z'),
          },
        },
      },
    });
    return account.id;
  }
});

function verifierData() {
  return {
    algorithm: 'scrypt',
    version: 1,
    cost: 2,
    blockSize: 1,
    parallelization: 1,
    keyLengthBytes: 16,
    maxMemoryBytes: 4096,
    saltEncoded: 'c2FsdHNhbHRzYWx0c2FsdA',
    derivedKeyEncoded: 'ZGVyaXZlZGRlcml2ZWQ',
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
