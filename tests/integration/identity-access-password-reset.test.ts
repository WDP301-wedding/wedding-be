import 'dotenv/config';

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../../src/core/database/prisma.js';
import { createPrismaPasswordResetRepository } from '../../src/modules/identity-access/password-reset/password-reset.repository.js';
import { createPrismaSessionRepository } from '../../src/modules/identity-access/session/session.repository.js';

const execFileAsync = promisify(execFile);
const migrationDatabaseUrl = process.env.TEST_MIGRATION_DATABASE_URL?.trim();
const describeWithDatabase = migrationDatabaseUrl ? describe : describe.skip;
const baseUrl = migrationDatabaseUrl ?? 'postgresql://unused:unused@127.0.0.1:1/unused';
const verifier = {
  algorithm: 'scrypt' as const,
  version: 1 as const,
  parameters: {
    cost: 2,
    blockSize: 1,
    parallelization: 1,
    keyLengthBytes: 16,
    maxMemoryBytes: 4096,
  },
  saltEncoded: 'c2FsdHNhbHRzYWx0c2FsdA',
  derivedKeyEncoded: 'ZGVyaXZlZGRlcml2ZWQ',
};

describeWithDatabase('IA-09 password reset persistence', () => {
  const schemaName = `identity_reset_${randomUUID().replaceAll('-', '')}`;
  const scopedUrl = withSchema(baseUrl, schemaName);
  const admin = new Client({ connectionString: baseUrl });
  const prisma = createPrismaClient(scopedUrl);
  const repository = createPrismaPasswordResetRepository(prisma);
  const sessions = createPrismaSessionRepository(prisma);
  let accountId: string;

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
    await deployMigrations(scopedUrl);
    await prisma.$connect();
    const account = await prisma.account.create({
      data: { emailNormalized: 'couple@example.com', displayEmail: 'Couple@example.com' },
    });
    accountId = account.id;
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await admin.query(`DROP SCHEMA ${quoteIdentifier(schemaName)} CASCADE`);
    await admin.end();
  });

  it('does not distinguish unknown and disabled accounts from eligible lookup results', async () => {
    await prisma.account.create({
      data: {
        emailNormalized: 'disabled@example.com',
        displayEmail: 'disabled@example.com',
        status: 'DISABLED',
        disabledAt: new Date(),
      },
    });

    await expect(repository.findEligibleAccount('couple@example.com')).resolves.toEqual({
      accountId,
      displayEmail: 'Couple@example.com',
    });
    await expect(repository.findEligibleAccount('disabled@example.com')).resolves.toBeNull();
    await expect(repository.findEligibleAccount('unknown@example.com')).resolves.toBeNull();
  });

  it('allows one completion winner, replaces the password, and revokes every session atomically', async () => {
    const createdAt = new Date();
    await Promise.all([
      sessions.createSession({
        accountId,
        clientKind: 'WEB',
        accessTokenHash: 'a'.repeat(43),
        refreshTokenHash: 'b'.repeat(43),
        accessExpiresAt: addSeconds(createdAt, 600),
        idleExpiresAt: addSeconds(createdAt, 2_592_000),
        absoluteExpiresAt: addSeconds(createdAt, 7_776_000),
        now: createdAt,
      }),
      sessions.createSession({
        accountId,
        clientKind: 'ANDROID',
        accessTokenHash: 'c'.repeat(43),
        refreshTokenHash: 'd'.repeat(43),
        accessExpiresAt: addSeconds(createdAt, 600),
        idleExpiresAt: addSeconds(createdAt, 2_592_000),
        absoluteExpiresAt: addSeconds(createdAt, 7_776_000),
        now: createdAt,
      }),
    ]);
    const credential = await repository.createCredential({
      accountId,
      tokenHash: 'e'.repeat(43),
      expiresAt: addSeconds(createdAt, 1_800),
      now: createdAt,
      requestId: randomUUID(),
    });
    const completion = {
      resetTokenHash: 'e'.repeat(43),
      passwordVerifier: verifier,
      now: addSeconds(createdAt, 60),
      requestId: randomUUID(),
    };

    const results = await Promise.all([
      repository.complete(completion),
      repository.complete(completion),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await prisma.session.count({ where: { accountId, status: 'ACTIVE' } })).toBe(0);
    expect(await prisma.accessCredential.count({ where: { status: 'ACTIVE' } })).toBe(0);
    expect(await prisma.refreshCredential.count({ where: { status: 'ACTIVE' } })).toBe(0);
    expect(await prisma.passwordCredential.findUnique({ where: { accountId } })).toMatchObject({
      derivedKeyEncoded: verifier.derivedKeyEncoded,
    });
    const audit = await prisma.auditLog.findMany({
      where: { entityId: { in: [credential.credentialId, accountId] } },
    });
    expect(JSON.stringify(audit)).not.toMatch(/couple@example|wip_|e{43}|derivedKey|saltEncoded/iu);
  });

  it('expires an old credential and refuses replay without changing the password', async () => {
    const createdAt = new Date('2026-10-04T00:00:00.000Z');
    await repository.createCredential({
      accountId,
      tokenHash: 'f'.repeat(43),
      expiresAt: addSeconds(createdAt, 60),
      now: createdAt,
      requestId: randomUUID(),
    });

    await expect(
      repository.complete({
        resetTokenHash: 'f'.repeat(43),
        passwordVerifier: verifier,
        now: addSeconds(createdAt, 60),
        requestId: randomUUID(),
      }),
    ).resolves.toBe(false);
    await expect(
      repository.complete({
        resetTokenHash: 'e'.repeat(43),
        passwordVerifier: verifier,
        now: addSeconds(createdAt, 61),
        requestId: randomUUID(),
      }),
    ).resolves.toBe(false);
  });
});

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
function withSchema(databaseUrl: string, schema: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('schema', schema);
  return url.toString();
}
function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1_000);
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
