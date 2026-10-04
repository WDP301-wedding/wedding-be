import 'dotenv/config';

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../../src/core/database/prisma.js';
import { createPrismaSessionRepository } from '../../src/modules/identity-access/session/session.repository.js';

const execFileAsync = promisify(execFile);
const migrationDatabaseUrl = process.env.TEST_MIGRATION_DATABASE_URL?.trim();
const describeWithDatabase =
  migrationDatabaseUrl === undefined || migrationDatabaseUrl === '' ? describe.skip : describe;
const testMigrationDatabaseUrl =
  migrationDatabaseUrl ?? 'postgresql://unused:unused@127.0.0.1:1/unused';
const sessionStartedAt = new Date();
const accessExpiresAt = addSeconds(sessionStartedAt, 10 * 60);
const idleExpiresAt = addSeconds(sessionStartedAt, 30 * 24 * 60 * 60);
const absoluteExpiresAt = addSeconds(sessionStartedAt, 90 * 24 * 60 * 60);

describeWithDatabase('identity session persistence', () => {
  const schemaName = `identity_session_${randomUUID().replaceAll('-', '')}`;
  const scopedUrl = withSchema(testMigrationDatabaseUrl, schemaName);
  const admin = new Client({ connectionString: testMigrationDatabaseUrl });
  const prisma = createPrismaClient(scopedUrl);
  const repository = createPrismaSessionRepository(prisma);
  let accountId: string;
  let otherAccountId: string;

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
    await deployMigrations(scopedUrl);
    await prisma.$connect();
    const accounts = await prisma.account.createManyAndReturn({
      data: [
        { emailNormalized: 'couple@example.com', displayEmail: 'couple@example.com' },
        { emailNormalized: 'other@example.com', displayEmail: 'other@example.com' },
      ],
    });
    accountId = accounts[0]!.id;
    otherAccountId = accounts[1]!.id;
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await admin.query(`DROP SCHEMA ${quoteIdentifier(schemaName)} CASCADE`);
    await admin.end();
  });

  it('persists only hashes and clamps rotation to the absolute session lifetime', async () => {
    const clampedAbsoluteExpiresAt = addSeconds(sessionStartedAt, 20 * 24 * 60 * 60);
    const created = await repository.createSession({
      accountId,
      clientKind: 'ANDROID',
      accessTokenHash: 'a'.repeat(43),
      refreshTokenHash: 'b'.repeat(43),
      accessExpiresAt,
      idleExpiresAt: clampedAbsoluteExpiresAt,
      absoluteExpiresAt: clampedAbsoluteExpiresAt,
      now: sessionStartedAt,
    });
    const rotationAt = addSeconds(clampedAbsoluteExpiresAt, -5 * 60);
    const outcome = await repository.rotateRefresh({
      presentedTokenHash: 'b'.repeat(43),
      successorTokenHash: 'c'.repeat(43),
      accessTokenHash: 'd'.repeat(43),
      requestedAccessExpiresAt: addSeconds(rotationAt, 10 * 60),
      requestedIdleExpiresAt: addSeconds(rotationAt, 30 * 24 * 60 * 60),
      now: rotationAt,
    });

    expect(outcome).toMatchObject({
      outcome: 'ROTATED',
      sessionId: created.sessionId,
      accessExpiresAt: clampedAbsoluteExpiresAt,
      refreshExpiresAt: clampedAbsoluteExpiresAt,
    });
    const stored = await prisma.session.findUniqueOrThrow({
      where: { id: created.sessionId },
      include: { accessCredentials: true, refreshCredentials: true },
    });
    expect(stored.refreshCredentials).toHaveLength(2);
    expect(JSON.stringify(stored)).not.toMatch(/wia_|wir_/u);
  });

  it('allows one concurrent rotation winner and contains replay by compromising the family', async () => {
    const created = await repository.createSession({
      accountId,
      clientKind: 'WEB',
      accessTokenHash: 'e'.repeat(43),
      refreshTokenHash: 'f'.repeat(43),
      accessExpiresAt,
      idleExpiresAt,
      absoluteExpiresAt,
      now: sessionStartedAt,
    });
    const base = {
      presentedTokenHash: 'f'.repeat(43),
      requestedAccessExpiresAt: addSeconds(sessionStartedAt, 11 * 60),
      requestedIdleExpiresAt: addSeconds(sessionStartedAt, 30 * 24 * 60 * 60 + 60),
      now: addSeconds(sessionStartedAt, 60),
    };
    const outcomes = await Promise.all([
      repository.rotateRefresh({
        ...base,
        successorTokenHash: 'g'.repeat(43),
        accessTokenHash: 'h'.repeat(43),
      }),
      repository.rotateRefresh({
        ...base,
        successorTokenHash: 'i'.repeat(43),
        accessTokenHash: 'j'.repeat(43),
      }),
    ]);

    expect(outcomes.filter(({ outcome }) => outcome === 'ROTATED')).toHaveLength(1);
    expect(outcomes.filter(({ outcome }) => outcome === 'REPLAYED')).toHaveLength(1);
    const stored = await prisma.session.findUniqueOrThrow({
      where: { id: created.sessionId },
      include: { accessCredentials: true, refreshCredentials: true },
    });
    expect(stored.status).toBe('COMPROMISED');
    expect(stored.refreshCredentials.filter(({ status }) => status === 'ACTIVE')).toHaveLength(0);
    expect(stored.accessCredentials.filter(({ status }) => status === 'ACTIVE')).toHaveLength(0);
  });

  it('lists safe summaries and makes owned revocation idempotent without cross-account access', async () => {
    const created = await repository.createSession({
      accountId,
      clientKind: 'WEB',
      accessTokenHash: 'k'.repeat(43),
      refreshTokenHash: 'l'.repeat(43),
      accessExpiresAt,
      idleExpiresAt,
      absoluteExpiresAt,
      now: sessionStartedAt,
    });

    const page = await repository.listSessions(accountId, { limit: 20 });
    const summary = page.sessions.find(({ sessionId }) => sessionId === created.sessionId);
    expect(summary).toMatchObject({
      sessionId: created.sessionId,
      clientKind: 'WEB',
      status: 'ACTIVE',
    });
    expect(summary?.createdAt).toBeInstanceOf(Date);
    expect(summary?.lastSeenAt).toBeInstanceOf(Date);
    expect(summary?.idleExpiresAt).toBeInstanceOf(Date);
    expect(summary?.absoluteExpiresAt).toBeInstanceOf(Date);
    await expect(
      repository.revokeSession({
        accountId: otherAccountId,
        sessionId: created.sessionId,
        reason: 'owner-revoked',
        now: addSeconds(sessionStartedAt, 60),
      }),
    ).resolves.toBe(false);
    await expect(
      repository.revokeSession({
        accountId,
        sessionId: created.sessionId,
        reason: 'owner-revoked',
        now: addSeconds(sessionStartedAt, 60),
      }),
    ).resolves.toBe(true);
    await expect(
      repository.revokeSession({
        accountId,
        sessionId: created.sessionId,
        reason: 'owner-revoked',
        now: addSeconds(sessionStartedAt, 120),
      }),
    ).resolves.toBe(true);
  });
});

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function withSchema(databaseUrl: string, schemaName: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('schema', schemaName);
  return url.toString();
}

async function deployMigrations(databaseUrl: string): Promise<void> {
  const prismaCliPath = join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
  await execFileAsync(
    process.execPath,
    [prismaCliPath, 'migrate', 'deploy', '--config', 'prisma.config.ts'],
    {
      cwd: process.cwd(),
      env: { ...process.env, MIGRATION_DATABASE_URL: databaseUrl },
      maxBuffer: 1024 * 1024,
    },
  );
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1_000);
}
