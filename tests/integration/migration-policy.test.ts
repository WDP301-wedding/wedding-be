import 'dotenv/config';

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const migrationDatabaseUrl = process.env.TEST_MIGRATION_DATABASE_URL?.trim();
const describeWithMigrationDatabase =
  migrationDatabaseUrl === undefined || migrationDatabaseUrl === '' ? describe.skip : describe;

const probeMigrationName = '99990101000000_checkpoint_c1_probe';
const correctionMigrationName = '99990101000001_compensate_checkpoint_c1_probe';
const probeColumnName = '_checkpointC1Probe';

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function withSchema(databaseUrl: string, schemaName: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('schema', schemaName);
  return url.toString();
}

async function deployMigrations(configPath: string, databaseUrl: string): Promise<void> {
  const prismaCliPath = join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');

  await execFileAsync(
    process.execPath,
    [prismaCliPath, 'migrate', 'deploy', '--config', configPath],
    {
      cwd: process.cwd(),
      env: { ...process.env, MIGRATION_POLICY_DATABASE_URL: databaseUrl },
      maxBuffer: 1024 * 1024,
    },
  );
}

describeWithMigrationDatabase('migration policy', () => {
  it('deploys from empty and compensates with a new forward migration', async () => {
    const schemaName = `migration_policy_${randomUUID().replaceAll('-', '')}`;
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'wedding-migration-policy-'));
    const temporarySchemaPath = join(temporaryDirectory, 'schema.prisma');
    const temporaryMigrationsPath = join(temporaryDirectory, 'migrations');
    const temporaryConfigPath = join(temporaryDirectory, 'prisma.config.ts');
    const scopedDatabaseUrl = withSchema(migrationDatabaseUrl!, schemaName);
    const adminClient = new Client({ connectionString: migrationDatabaseUrl });
    let schemaCreated = false;

    try {
      await cp(join(process.cwd(), 'prisma', 'schema.prisma'), temporarySchemaPath);
      await cp(join(process.cwd(), 'prisma', 'migrations'), temporaryMigrationsPath, {
        recursive: true,
      });
      await writeFile(
        temporaryConfigPath,
        [
          'export default {',
          `  schema: ${JSON.stringify(temporarySchemaPath)},`,
          `  migrations: { path: ${JSON.stringify(temporaryMigrationsPath)} },`,
          '  datasource: { url: process.env.MIGRATION_POLICY_DATABASE_URL },',
          '};',
          '',
        ].join('\n'),
        'utf8',
      );

      await adminClient.connect();
      await adminClient.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
      schemaCreated = true;

      await deployMigrations(temporaryConfigPath, scopedDatabaseUrl);

      const freshTables = await adminClient.query<{ table_name: string }>(
        `SELECT table_name
           FROM information_schema.tables
           WHERE table_schema = $1
             AND table_name IN ('_prisma_migrations', 'AuditLog', 'IdempotencyRecord')
           ORDER BY table_name`,
        [schemaName],
      );
      expect(freshTables.rows.map(({ table_name: tableName }) => tableName)).toEqual([
        'AuditLog',
        'IdempotencyRecord',
        '_prisma_migrations',
      ]);

      const committedMigrationNames = (
        await readdir(temporaryMigrationsPath, {
          withFileTypes: true,
        })
      )
        .filter((entry) => entry.isDirectory())
        .map(({ name }) => name)
        .sort();
      const freshMigrations = await adminClient.query<{
        finished_at: Date | null;
        migration_name: string;
        rolled_back_at: Date | null;
      }>(
        `SELECT migration_name, finished_at, rolled_back_at
           FROM ${quoteIdentifier(schemaName)}."_prisma_migrations"
           ORDER BY migration_name`,
      );
      expect(freshMigrations.rows.map(({ migration_name: name }) => name)).toEqual(
        committedMigrationNames,
      );
      expect(
        freshMigrations.rows.every(
          ({ finished_at: finishedAt, rolled_back_at: rolledBackAt }) =>
            finishedAt instanceof Date && rolledBackAt === null,
        ),
      ).toBe(true);

      const probeDirectory = join(temporaryMigrationsPath, probeMigrationName);
      const probeSqlPath = join(probeDirectory, 'migration.sql');
      const probeSql = `ALTER TABLE "AuditLog" ADD COLUMN "${probeColumnName}" TEXT;\n`;
      await mkdir(probeDirectory);
      await writeFile(probeSqlPath, probeSql, 'utf8');
      await deployMigrations(temporaryConfigPath, scopedDatabaseUrl);

      const probeColumns = await adminClient.query<{ column_name: string }>(
        `SELECT column_name
           FROM information_schema.columns
           WHERE table_schema = $1
             AND table_name = 'AuditLog'
             AND column_name = $2`,
        [schemaName, probeColumnName],
      );
      expect(probeColumns.rows).toHaveLength(1);

      const correctionDirectory = join(temporaryMigrationsPath, correctionMigrationName);
      await mkdir(correctionDirectory);
      await writeFile(
        join(correctionDirectory, 'migration.sql'),
        `ALTER TABLE "AuditLog" DROP COLUMN "${probeColumnName}";\n`,
        'utf8',
      );
      await deployMigrations(temporaryConfigPath, scopedDatabaseUrl);

      const correctedColumns = await adminClient.query<{ column_name: string }>(
        `SELECT column_name
           FROM information_schema.columns
           WHERE table_schema = $1
             AND table_name = 'AuditLog'
             AND column_name = $2`,
        [schemaName, probeColumnName],
      );
      const policyMigrations = await adminClient.query<{
        finished_at: Date | null;
        migration_name: string;
        rolled_back_at: Date | null;
      }>(
        `SELECT migration_name, finished_at, rolled_back_at
           FROM ${quoteIdentifier(schemaName)}."_prisma_migrations"
           WHERE migration_name IN ($1, $2)
           ORDER BY migration_name`,
        [probeMigrationName, correctionMigrationName],
      );

      expect(correctedColumns.rows).toHaveLength(0);
      expect(await readFile(probeSqlPath, 'utf8')).toBe(probeSql);
      expect(policyMigrations.rows).toHaveLength(2);
      expect(policyMigrations.rows.map(({ migration_name: name }) => name)).toEqual([
        probeMigrationName,
        correctionMigrationName,
      ]);
      expect(
        policyMigrations.rows.every(
          ({ finished_at: finishedAt, rolled_back_at: rolledBackAt }) =>
            finishedAt instanceof Date && rolledBackAt === null,
        ),
      ).toBe(true);
    } finally {
      if (schemaCreated) {
        await adminClient.query(`DROP SCHEMA ${quoteIdentifier(schemaName)} CASCADE`);
      }
      await adminClient.end();
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  }, 60_000);
});
