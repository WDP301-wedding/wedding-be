import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../../src/core/database/prisma.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
const describeWithDatabase =
  databaseUrl === undefined || databaseUrl === '' ? describe.skip : describe;
const testDatabaseUrl = databaseUrl ?? 'postgresql://unused:unused@127.0.0.1:1/unused';

describeWithDatabase('PostgreSQL foundation', () => {
  const prisma = createPrismaClient(testDatabaseUrl);

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('connects to a database with the initial core-platform migration deployed', async () => {
    const tables = await prisma.$queryRaw<Array<{ tableName: string }>>`
      SELECT tablename AS "tableName"
      FROM pg_catalog.pg_tables
      WHERE schemaname = current_schema()
        AND tablename IN ('_prisma_migrations', 'AuditLog', 'IdempotencyRecord')
      ORDER BY tablename
    `;
    const migration = await prisma.$queryRaw<
      Array<{ finishedAt: Date | null; rolledBackAt: Date | null }>
    >`
      SELECT finished_at AS "finishedAt", rolled_back_at AS "rolledBackAt"
      FROM "_prisma_migrations"
      WHERE migration_name = '20260928000000_core_platform'
    `;

    expect(tables.map(({ tableName }) => tableName)).toEqual([
      'AuditLog',
      'IdempotencyRecord',
      '_prisma_migrations',
    ]);
    expect(migration).toHaveLength(1);
    expect(migration[0]?.finishedAt).toBeInstanceOf(Date);
    expect(migration[0]?.rolledBackAt).toBeNull();
  });

  it('commits and rolls back PostgreSQL transactions', async () => {
    const namespace = `database-test-${randomUUID()}`;
    const expiresAt = new Date(Date.now() + 60_000);
    const committed = await prisma.$transaction((transaction) =>
      transaction.idempotencyRecord.create({
        data: {
          namespace,
          idempotencyKey: 'committed',
          requestHash: 'a'.repeat(64),
          status: 'IN_PROGRESS',
          expiresAt,
        },
      }),
    );
    const rollback = new Error('ROLLBACK_DATABASE_TEST');

    try {
      await expect(
        prisma.$transaction(async (transaction) => {
          await transaction.idempotencyRecord.create({
            data: {
              namespace,
              idempotencyKey: 'rolled-back',
              requestHash: 'b'.repeat(64),
              status: 'IN_PROGRESS',
              expiresAt,
            },
          });

          throw rollback;
        }),
      ).rejects.toBe(rollback);

      await expect(
        prisma.idempotencyRecord.findUnique({
          where: {
            namespace_idempotencyKey: { namespace, idempotencyKey: 'committed' },
          },
        }),
      ).resolves.toMatchObject({ id: committed.id });
      await expect(
        prisma.idempotencyRecord.findUnique({
          where: {
            namespace_idempotencyKey: { namespace, idempotencyKey: 'rolled-back' },
          },
        }),
      ).resolves.toBeNull();
    } finally {
      await prisma.idempotencyRecord.deleteMany({ where: { namespace } });
    }
  });
});
