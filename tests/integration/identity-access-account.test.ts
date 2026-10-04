import 'dotenv/config';

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../../src/core/database/prisma.js';
import {
  createPrismaAccountRepository,
  InitialManagerAlreadyExistsRepositoryError,
} from '../../src/modules/identity-access/account/account.repository.js';

const execFileAsync = promisify(execFile);
const migrationDatabaseUrl = process.env.TEST_MIGRATION_DATABASE_URL?.trim();
const describeWithDatabase =
  migrationDatabaseUrl === undefined || migrationDatabaseUrl === '' ? describe.skip : describe;
const testMigrationDatabaseUrl =
  migrationDatabaseUrl ?? 'postgresql://unused:unused@127.0.0.1:1/unused';

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

describeWithDatabase('identity account persistence', () => {
  const schemaName = `identity_account_${randomUUID().replaceAll('-', '')}`;
  const scopedUrl = withSchema(testMigrationDatabaseUrl, schemaName);
  const admin = new Client({ connectionString: testMigrationDatabaseUrl });
  const prisma = createPrismaClient(scopedUrl);
  const repository = createPrismaAccountRepository(prisma);

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

  it('bootstraps exactly one Manager and stores no password or email audit metadata', async () => {
    const requestId = randomUUID();
    const manager = await repository.bootstrapInitialManager({
      emailNormalized: 'manager@example.com',
      displayEmail: 'Manager@Example.com',
      passwordVerifier: verifier,
      environment: 'test',
      operatorReference: 'operator-01',
      audit: { requestId },
    });

    await expect(
      repository.bootstrapInitialManager({
        emailNormalized: 'other@example.com',
        displayEmail: 'other@example.com',
        passwordVerifier: verifier,
        environment: 'test',
        operatorReference: 'operator-02',
        audit: { requestId: randomUUID() },
      }),
    ).rejects.toBeInstanceOf(InitialManagerAlreadyExistsRepositoryError);
    await expect(repository.findForAuthentication('manager@example.com')).resolves.toMatchObject({
      accountId: manager.accountId,
      displayEmail: 'Manager@Example.com',
      status: 'ACTIVE',
      roles: ['MANAGER'],
    });

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { requestId } });
    expect(audit.metadata).toEqual({ environment: 'test', operatorReference: 'operator-01' });
    expect(JSON.stringify(audit)).not.toMatch(/manager@example|password|derivedKey|saltEncoded/iu);
  });

  it('replaces a password verifier and grants only the requested internal role idempotently', async () => {
    const account = await prisma.account.create({
      data: { emailNormalized: 'staff@example.com', displayEmail: 'staff@example.com' },
    });
    await repository.replacePassword({
      accountId: account.id,
      passwordVerifier: verifier,
      audit: { requestId: randomUUID() },
    });
    await repository.grantRole({
      accountId: account.id,
      role: 'STAFF',
      audit: { requestId: randomUUID() },
    });
    await repository.grantRole({
      accountId: account.id,
      role: 'STAFF',
      audit: { requestId: randomUUID() },
    });

    await expect(
      prisma.passwordCredential.count({ where: { accountId: account.id } }),
    ).resolves.toBe(1);
    await expect(prisma.accountRole.count({ where: { accountId: account.id } })).resolves.toBe(1);
  });

  it('fails retention closed for missing terminal facts and active holds', async () => {
    const account = await prisma.account.create({
      data: {
        emailNormalized: 'disabled@example.com',
        displayEmail: 'disabled@example.com',
        status: 'DISABLED',
        disabledAt: new Date('2025-01-01T00:00:00.000Z'),
        legalHoldUntil: new Date('2028-01-01T00:00:00.000Z'),
      },
    });
    const firstConsultationId = randomUUID();
    const secondConsultationId = randomUUID();
    await prisma.consultationAccess.createMany({
      data: [
        { accountId: account.id, consultationId: firstConsultationId },
        { accountId: account.id, consultationId: secondConsultationId },
      ],
    });

    const firstResult = await repository.recordRetentionEligibility({
      accountId: account.id,
      consultationId: firstConsultationId,
      sourceBusinessRecordId: randomUUID(),
      eligibleAfter: new Date('2025-01-01T00:00:00.000Z'),
      piiEligibleAt: new Date('2026-01-01T00:00:00.000Z'),
      audit: { requestId: randomUUID() },
    });
    expect(firstResult).toBeNull();
    await expect(
      repository.isPiiErasureAllowed(account.id, new Date('2027-01-02T00:00:00.000Z')),
    ).resolves.toBe(false);

    await repository.recordRetentionEligibility({
      accountId: account.id,
      consultationId: secondConsultationId,
      sourceBusinessRecordId: randomUUID(),
      eligibleAfter: new Date('2025-02-01T00:00:00.000Z'),
      piiEligibleAt: new Date('2026-02-01T00:00:00.000Z'),
      audit: { requestId: randomUUID() },
    });
    await expect(
      repository.isPiiErasureAllowed(account.id, new Date('2027-01-02T00:00:00.000Z')),
    ).resolves.toBe(false);

    await prisma.account.update({ where: { id: account.id }, data: { legalHoldUntil: null } });
    await expect(
      repository.isPiiErasureAllowed(account.id, new Date('2027-01-02T00:00:00.000Z')),
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
