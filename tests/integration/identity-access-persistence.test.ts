import 'dotenv/config';

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const migrationDatabaseUrl = process.env.TEST_MIGRATION_DATABASE_URL?.trim();
const describeWithMigrationDatabase =
  migrationDatabaseUrl === undefined || migrationDatabaseUrl === '' ? describe.skip : describe;

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

async function expectDatabaseError(
  operation: Promise<unknown>,
  expectedCode: '23505' | '23514',
): Promise<void> {
  try {
    await operation;
    throw new Error(`Expected PostgreSQL error ${expectedCode}.`);
  } catch (error: unknown) {
    expect(error).toMatchObject({ code: expectedCode });
  }
}

describeWithMigrationDatabase('identity access persistence', () => {
  it('deploys cleanly and enforces identity concurrency and normalization invariants', async () => {
    const schemaName = `identity_access_${randomUUID().replaceAll('-', '')}`;
    const scopedDatabaseUrl = withSchema(migrationDatabaseUrl!, schemaName);
    const client = new Client({ connectionString: migrationDatabaseUrl });
    let schemaCreated = false;

    const accountId = randomUUID();
    const secondAccountId = randomUUID();
    const consultationId = randomUUID();
    const secondConsultationId = randomUUID();
    const paymentId = randomUUID();
    const sessionId = randomUUID();

    try {
      await client.connect();
      await client.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
      schemaCreated = true;
      try {
        await deployMigrations(scopedDatabaseUrl);
      } catch (error: unknown) {
        const migrationTable = await client.query<{ exists: boolean }>(
          `SELECT to_regclass($1) IS NOT NULL AS "exists"`,
          [`${schemaName}._prisma_migrations`],
        );
        const migrationFailure = migrationTable.rows[0]?.exists
          ? await client.query<{ logs: string | null; migration_name: string }>(
              `SELECT migration_name, logs
               FROM ${quoteIdentifier(schemaName)}."_prisma_migrations"
               WHERE finished_at IS NULL
               ORDER BY started_at DESC
               LIMIT 1`,
            )
          : undefined;
        throw new Error(
          `Identity migration deploy failed: ${migrationFailure?.rows[0]?.logs ?? 'no migration log'}`,
          { cause: error },
        );
      }
      await client.query(`SET search_path TO ${quoteIdentifier(schemaName)}`);

      const tables = await client.query<{ table_name: string }>(
        `SELECT table_name
           FROM information_schema.tables
           WHERE table_schema = $1
             AND table_name IN (
               'Account', 'PasswordCredential', 'AccountRole', 'ConsultationAccess',
               'WorkspaceInvitation', 'Session', 'AccessCredential', 'RefreshCredential',
               'PasswordResetCredential', 'AccountRetentionEligibilityFact'
             )
           ORDER BY table_name`,
        [schemaName],
      );
      expect(tables.rows.map(({ table_name: tableName }) => tableName)).toHaveLength(10);

      await client.query(
        `INSERT INTO "Account" ("id", "emailNormalized", "displayEmail", "updatedAt")
         VALUES ($1, 'couple@example.com', 'Couple@example.com', CURRENT_TIMESTAMP),
                ($2, 'other@example.com', 'other@example.com', CURRENT_TIMESTAMP)`,
        [accountId, secondAccountId],
      );
      await expectDatabaseError(
        client.query(
          `INSERT INTO "Account" ("id", "emailNormalized", "displayEmail", "updatedAt")
           VALUES ($1, 'couple@example.com', 'duplicate@example.com', CURRENT_TIMESTAMP)`,
          [randomUUID()],
        ),
        '23505',
      );
      await expectDatabaseError(
        client.query(
          `INSERT INTO "Account" ("id", "emailNormalized", "displayEmail", "updatedAt")
           VALUES ($1, 'Not-Normalized@example.com', 'Not-Normalized@example.com', CURRENT_TIMESTAMP)`,
          [randomUUID()],
        ),
        '23514',
      );

      await client.query(
        `INSERT INTO "AccountRole" ("id", "accountId", "role") VALUES ($1, $2, 'COUPLE')`,
        [randomUUID(), accountId],
      );
      await expectDatabaseError(
        client.query(
          `INSERT INTO "AccountRole" ("id", "accountId", "role") VALUES ($1, $2, 'COUPLE')`,
          [randomUUID(), accountId],
        ),
        '23505',
      );

      await client.query(
        `INSERT INTO "ConsultationAccess"
           ("id", "accountId", "consultationId", "level", "promotedAt", "sourcePaymentId", "updatedAt")
         VALUES ($1, $2, $3, 'FULL', CURRENT_TIMESTAMP, $4, CURRENT_TIMESTAMP)`,
        [randomUUID(), accountId, consultationId, paymentId],
      );
      await expectDatabaseError(
        client.query(
          `INSERT INTO "ConsultationAccess"
             ("id", "accountId", "consultationId", "level", "promotedAt", "sourcePaymentId", "updatedAt")
           VALUES ($1, $2, $3, 'FULL', CURRENT_TIMESTAMP, $4, CURRENT_TIMESTAMP)`,
          [randomUUID(), accountId, consultationId, randomUUID()],
        ),
        '23505',
      );
      await expectDatabaseError(
        client.query(
          `INSERT INTO "ConsultationAccess"
             ("id", "accountId", "consultationId", "level", "promotedAt", "sourcePaymentId", "updatedAt")
           VALUES ($1, $2, $3, 'FULL', CURRENT_TIMESTAMP, $4, CURRENT_TIMESTAMP)`,
          [randomUUID(), secondAccountId, secondConsultationId, paymentId],
        ),
        '23505',
      );

      const invitationId = randomUUID();
      await client.query(
        `INSERT INTO "WorkspaceInvitation"
           ("id", "consultationId", "recipientEmailNormalized", "issuedByAccountId", "sequence", "tokenHash", "expiresAt", "updatedAt")
         VALUES ($1, $2, 'invitee@example.com', $3, 1, $4, CURRENT_TIMESTAMP + INTERVAL '72 hours', CURRENT_TIMESTAMP)`,
        [invitationId, consultationId, accountId, 'a'.repeat(43)],
      );
      await expectDatabaseError(
        client.query(
          `INSERT INTO "WorkspaceInvitation"
             ("id", "consultationId", "recipientEmailNormalized", "issuedByAccountId", "sequence", "tokenHash", "expiresAt", "updatedAt")
           VALUES ($1, $2, 'invitee@example.com', $3, 2, $4, CURRENT_TIMESTAMP + INTERVAL '72 hours', CURRENT_TIMESTAMP)`,
          [randomUUID(), consultationId, accountId, 'b'.repeat(43)],
        ),
        '23505',
      );
      await client.query(
        `UPDATE "WorkspaceInvitation"
         SET "status" = 'SUPERSEDED', "supersededAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
         WHERE "id" = $1`,
        [invitationId],
      );
      await client.query(
        `INSERT INTO "WorkspaceInvitation"
           ("id", "consultationId", "recipientEmailNormalized", "issuedByAccountId", "sequence", "tokenHash", "expiresAt", "updatedAt")
         VALUES ($1, $2, 'invitee@example.com', $3, 2, $4, CURRENT_TIMESTAMP + INTERVAL '72 hours', CURRENT_TIMESTAMP)`,
        [randomUUID(), consultationId, accountId, 'b'.repeat(43)],
      );

      await client.query(
        `INSERT INTO "Session"
           ("id", "accountId", "clientKind", "refreshFamilyId", "idleExpiresAt", "absoluteExpiresAt", "updatedAt")
         VALUES ($1, $2, 'WEB', $3, CURRENT_TIMESTAMP + INTERVAL '30 days', CURRENT_TIMESTAMP + INTERVAL '90 days', CURRENT_TIMESTAMP)`,
        [sessionId, accountId, randomUUID()],
      );
      const predecessorId = randomUUID();
      await client.query(
        `INSERT INTO "RefreshCredential" ("id", "sessionId", "tokenHash", "expiresAt")
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP + INTERVAL '30 days')`,
        [predecessorId, sessionId, 'c'.repeat(43)],
      );
      await client.query(
        `INSERT INTO "RefreshCredential" ("id", "sessionId", "predecessorId", "tokenHash", "expiresAt")
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + INTERVAL '30 days')`,
        [randomUUID(), sessionId, predecessorId, 'd'.repeat(43)],
      );
      await expectDatabaseError(
        client.query(
          `INSERT INTO "RefreshCredential" ("id", "sessionId", "predecessorId", "tokenHash", "expiresAt")
           VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + INTERVAL '30 days')`,
          [randomUUID(), sessionId, predecessorId, 'e'.repeat(43)],
        ),
        '23505',
      );

      const columns = await client.query<{ column_name: string }>(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = $1`,
        [schemaName],
      );
      const forbiddenRawCredentialColumns = new Set([
        'password',
        'accessToken',
        'refreshToken',
        'invitationToken',
        'resetToken',
        'rawToken',
        'rawPassword',
        'secret',
      ]);
      expect(
        columns.rows.filter(({ column_name: columnName }) =>
          forbiddenRawCredentialColumns.has(columnName),
        ),
      ).toEqual([]);
    } finally {
      if (schemaCreated) {
        await client.query(`DROP SCHEMA ${quoteIdentifier(schemaName)} CASCADE`);
      }
      await client.end();
    }
  }, 60_000);
});
