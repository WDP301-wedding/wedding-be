import 'dotenv/config';

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Client, type DatabaseError } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../../../src/core/database/prisma.js';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';
import { createPrismaCatalogVersionRepository } from '../../../src/modules/venue-catalog/infrastructure/catalog-version.repository.js';

const execFileAsync = promisify(execFile);
const migrationDatabaseUrl = process.env.TEST_MIGRATION_DATABASE_URL?.trim();
const describeWithDatabase = migrationDatabaseUrl ? describe : describe.skip;
const schemaName = `venue_catalog_${randomUUID().replaceAll('-', '')}`;
const admin = new Client({ connectionString: migrationDatabaseUrl });
const database = new Client({ connectionString: migrationDatabaseUrl });
let prisma: PrismaClient | undefined;
let adminConnected = false;
let databaseConnected = false;
let schemaCreated = false;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function withSchema(databaseUrl: string, schema: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('schema', schema);
  url.searchParams.set('options', `-c search_path=${schema}`);
  return url.toString();
}

async function expectDatabaseCode(operation: Promise<unknown>, code: string): Promise<void> {
  try {
    await operation;
    throw new Error(`Expected PostgreSQL error ${code}.`);
  } catch (error: unknown) {
    expect((error as DatabaseError).code).toBe(code);
  }
}

async function withDatabaseTransaction(operation: () => Promise<void>): Promise<void> {
  await database.query('BEGIN');
  try {
    await operation();
    await database.query('COMMIT');
  } catch (error: unknown) {
    await database.query('ROLLBACK');
    throw error;
  }
}

describeWithDatabase('venue catalog persistence constraints', () => {
  beforeAll(async () => {
    await admin.connect();
    adminConnected = true;
    await admin.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
    schemaCreated = true;
    const prismaCliPath = join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
    await execFileAsync(
      process.execPath,
      [prismaCliPath, 'migrate', 'deploy', '--config', 'prisma.config.ts'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          MIGRATION_DATABASE_URL: withSchema(migrationDatabaseUrl!, schemaName),
        },
        maxBuffer: 1024 * 1024,
      },
    );
    await database.connect();
    databaseConnected = true;
    await database.query(`SET search_path TO ${quoteIdentifier(schemaName)}`);
    prisma = createPrismaClient(withSchema(migrationDatabaseUrl!, schemaName));
    await prisma.$connect();
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    if (databaseConnected) await database.end();
    if (adminConnected) {
      if (schemaCreated) {
        await admin.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`);
      }
      await admin.end();
    }
  });

  it('deploys the complete catalog schema after the identity baseline', async () => {
    const tables = await database.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = $1
          AND table_name IN (
            'RestaurantProfile', 'RestaurantShift', 'Hall', 'Dish', 'DishVersion',
            'MenuPackage', 'MenuPackageVersion', 'TimelineTemplate',
            'TimelineTemplateVersion', 'LayoutTemplate', 'LayoutTemplateVersion',
            'LayoutTableIdentity', 'LayoutTableGeometry', 'CatalogMediaAsset'
          )
        ORDER BY table_name`,
      [schemaName],
    );

    expect(tables.rows).toHaveLength(14);
    const migration = await database.query<{ finished_at: Date | null }>(
      `SELECT finished_at
         FROM "_prisma_migrations"
        WHERE migration_name = '20261005000000_venue_catalog_core'`,
    );
    expect(migration.rows).toHaveLength(1);
    expect(migration.rows[0]?.finished_at).toBeInstanceOf(Date);
  });

  it('rejects duplicate drafts, mismatched pointers, and invalid published state', async () => {
    const actorId = randomUUID();
    const dishId = randomUUID();
    const otherDishId = randomUUID();
    const draftId = randomUUID();
    const now = new Date();
    await database.query(
      `INSERT INTO "Dish" (
         "id", "displayOrder", "createdByAccountId", "updatedByAccountId", "updatedAt"
       ) VALUES ($1, 1, $2, $2, $3), ($4, 2, $2, $2, $3)`,
      [dishId, actorId, now, otherDishId],
    );
    await withDatabaseTransaction(async () => {
      await database.query(
        `INSERT INTO "DishVersion" (
           "id", "dishId", "name", "description", "categoryLabel",
           "createdByAccountId", "updatedAt"
         ) VALUES ($1, $2, 'Dish', '', 'Main', $3, $4)`,
        [draftId, dishId, actorId, now],
      );
      await database.query(`UPDATE "Dish" SET "draftVersionId" = $1 WHERE "id" = $2`, [
        draftId,
        dishId,
      ]);
    });

    await expectDatabaseCode(
      database.query(
        `INSERT INTO "DishVersion" (
           "id", "dishId", "name", "description", "categoryLabel",
           "createdByAccountId", "updatedAt"
         ) VALUES ($1, $2, 'Duplicate', '', 'Main', $3, $4)`,
        [randomUUID(), dishId, actorId, now],
      ),
      '23505',
    );
    await expectDatabaseCode(
      database.query(`UPDATE "Dish" SET "draftVersionId" = $1 WHERE "id" = $2`, [
        draftId,
        otherDishId,
      ]),
      '23503',
    );
    await expectDatabaseCode(
      database.query(`UPDATE "DishVersion" SET "state" = 'PUBLISHED' WHERE "id" = $1`, [draftId]),
      '23514',
    );
    await expectDatabaseCode(
      database.query(`UPDATE "Dish" SET "currentPublishedVersionId" = $1 WHERE "id" = $2`, [
        draftId,
        dishId,
      ]),
      '23514',
    );
  });

  it('enforces active names, table ownership, geometry, and media object ownership', async () => {
    const actorId = randomUUID();
    const hallId = randomUUID();
    const otherHallId = randomUUID();
    const templateId = randomUUID();
    const otherTemplateId = randomUUID();
    const versionId = randomUUID();
    const tableId = randomUUID();
    const now = new Date();
    await database.query(
      `INSERT INTO "Hall" (
         "id", "name", "nameNormalized", "description", "maxGuests", "displayOrder",
         "updatedByAccountId", "updatedAt"
       ) VALUES
         ($1, 'Grand Hall', 'grand hall', '', 100, 1, $3, $4),
         ($2, 'Other Hall', 'other hall', '', 100, 2, $3, $4)`,
      [hallId, otherHallId, actorId, now],
    );
    await expectDatabaseCode(
      database.query(
        `INSERT INTO "Hall" (
           "id", "name", "nameNormalized", "description", "maxGuests", "displayOrder",
           "updatedByAccountId", "updatedAt"
         ) VALUES ($1, 'Grand Hall', 'grand hall', '', 100, 3, $2, $3)`,
        [randomUUID(), actorId, now],
      ),
      '23505',
    );
    await database.query(
      `INSERT INTO "LayoutTemplate" (
         "id", "hallId", "displayOrder", "createdByAccountId", "updatedByAccountId", "updatedAt"
       ) VALUES ($1, $3, 1, $5, $5, $6), ($2, $4, 2, $5, $5, $6)`,
      [templateId, otherTemplateId, hallId, otherHallId, actorId, now],
    );
    await withDatabaseTransaction(async () => {
      await database.query(
        `INSERT INTO "LayoutTemplateVersion" (
           "id", "layoutTemplateId", "name", "description", "minGuests", "maxGuests",
           "createdByAccountId", "updatedAt"
         ) VALUES ($1, $2, 'Layout', '', 1, 10, $3, $4)`,
        [versionId, otherTemplateId, actorId, now],
      );
      await database.query(`UPDATE "LayoutTemplate" SET "draftVersionId" = $1 WHERE "id" = $2`, [
        versionId,
        otherTemplateId,
      ]);
    });
    await database.query(
      `INSERT INTO "LayoutTableIdentity" (
         "id", "layoutTemplateId", "createdByAccountId"
       ) VALUES ($1, $2, $3)`,
      [tableId, templateId, actorId],
    );
    await expectDatabaseCode(
      database.query(
        `INSERT INTO "LayoutTableGeometry" (
           "id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label",
           "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder"
         ) VALUES ($1, $2, $3, $4, 'T1', 'ROUND', 10, 0, 0, 100, 100, 0, 1)`,
        [randomUUID(), versionId, otherTemplateId, tableId],
      ),
      '23503',
    );
    await expectDatabaseCode(
      database.query(`DELETE FROM "LayoutTableIdentity" WHERE "id" = $1`, [tableId]),
      '23514',
    );

    const checksum = 'a'.repeat(64);
    await expectDatabaseCode(
      database.query(
        `INSERT INTO "CatalogMediaAsset" (
           "id", "resourceType", "resourceId", "objectKey", "checksumSha256",
           "contentType", "sizeBytes", "alternativeText", "displayOrder", "createdByAccountId"
         ) VALUES ($1, 'HALL', $2, $3, $4, 'image/png', 10, 'Hall', 1, $5)`,
        [
          randomUUID(),
          hallId,
          `venue-catalog-media/${otherHallId}/${checksum}.png`,
          checksum,
          actorId,
        ],
      ),
      '23514',
    );
  });

  it('preserves exact published history after retirement and prevents aggregate deletion', async () => {
    const actorId = randomUUID();
    const dishId = randomUUID();
    const versionId = randomUUID();
    const now = new Date();
    await database.query(
      `INSERT INTO "Dish" (
         "id", "displayOrder", "createdByAccountId", "updatedByAccountId", "updatedAt"
       ) VALUES ($1, 10, $2, $2, $3)`,
      [dishId, actorId, now],
    );
    await withDatabaseTransaction(async () => {
      await database.query(
        `INSERT INTO "DishVersion" (
           "id", "dishId", "versionNumber", "state", "name", "description", "categoryLabel",
           "createdByAccountId", "publishedAt", "updatedAt"
         ) VALUES ($1, $2, 1, 'PUBLISHED', 'Historical Dish', '', 'Main', $3, $4, $4)`,
        [versionId, dishId, actorId, now],
      );
      await database.query(
        `UPDATE "Dish"
            SET "currentPublishedVersionId" = $1, "lifecycle" = 'RETIRED', "retiredAt" = $2
          WHERE "id" = $3`,
        [versionId, now, dishId],
      );
    });

    const historical = await database.query<{ id: string; state: string }>(
      `SELECT "id", "state" FROM "DishVersion" WHERE "id" = $1`,
      [versionId],
    );
    expect(historical.rows).toEqual([{ id: versionId, state: 'PUBLISHED' }]);
    await expectDatabaseCode(
      database.query(`UPDATE "DishVersion" SET "name" = 'Mutated' WHERE "id" = $1`, [versionId]),
      '23514',
    );
    await expectDatabaseCode(
      database.query(`DELETE FROM "DishVersion" WHERE "id" = $1`, [versionId]),
      '23514',
    );
    await expectDatabaseCode(
      database.query(`DELETE FROM "Dish" WHERE "id" = $1`, [dishId]),
      '23503',
    );
  });

  it('serializes publish, draft CAS, and retirement races while preserving exact history', async () => {
    if (prisma === undefined) throw new Error('Prisma test client was not initialized.');
    const repository = createPrismaCatalogVersionRepository(prisma);
    const actorId = randomUUID();
    const aggregateId = randomUUID();
    const firstVersionId = randomUUID();
    const firstContext = { requestId: randomUUID(), actorId };
    await prisma.dish.create({
      data: {
        id: aggregateId,
        displayOrder: 20,
        createdByAccountId: actorId,
        updatedByAccountId: actorId,
      },
    });
    await prisma.$transaction(async (transaction) => {
      await transaction.dishVersion.create({
        data: {
          id: firstVersionId,
          dishId: aggregateId,
          name: 'Version One',
          description: '',
          categoryLabel: 'Main',
          createdByAccountId: actorId,
        },
      });
      await transaction.dish.update({
        where: { id: aggregateId },
        data: { draftVersionId: firstVersionId },
      });
    });

    const publishRace = await Promise.allSettled([
      repository.publish({
        kind: 'DISH',
        aggregateId,
        versionId: firstVersionId,
        expectedRevision: 1,
        context: firstContext,
      }),
      repository.publish({
        kind: 'DISH',
        aggregateId,
        versionId: firstVersionId,
        expectedRevision: 1,
        context: { requestId: randomUUID(), actorId },
      }),
    ]);
    expect(publishRace.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(publishRace.filter(({ status }) => status === 'rejected')).toHaveLength(1);

    const secondVersionId = randomUUID();
    await prisma.$transaction(async (transaction) => {
      await transaction.dishVersion.create({
        data: {
          id: secondVersionId,
          dishId: aggregateId,
          name: 'Version Two Draft',
          description: '',
          categoryLabel: 'Main',
          createdByAccountId: actorId,
        },
      });
      await transaction.dish.update({
        where: { id: aggregateId },
        data: { draftVersionId: secondVersionId },
      });
    });
    const casRace = await Promise.allSettled(
      ['Version Two A', 'Version Two B'].map((name) =>
        repository.compareAndSwapDraft({
          kind: 'DISH',
          aggregateId,
          versionId: secondVersionId,
          expectedRevision: 1,
          changedFields: ['name'],
          context: { requestId: randomUUID(), actorId },
          mutate: async (transaction) => {
            await transaction.dishVersion.update({
              where: { id: secondVersionId },
              data: { name },
            });
          },
        }),
      ),
    );
    expect(casRace.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(casRace.filter(({ status }) => status === 'rejected')).toHaveLength(1);

    const secondDraft = await prisma.dishVersion.findUniqueOrThrow({
      where: { id: secondVersionId },
    });
    await repository.publish({
      kind: 'DISH',
      aggregateId,
      versionId: secondVersionId,
      expectedRevision: secondDraft.revision,
      context: { requestId: randomUUID(), actorId },
    });
    const aggregate = await prisma.dish.findUniqueOrThrow({ where: { id: aggregateId } });
    const retirementRace = await Promise.allSettled([
      repository.changeLifecycle({
        kind: 'DISH',
        aggregateId,
        expectedRevision: aggregate.revision,
        transition: 'RETIRE',
        context: { requestId: randomUUID(), actorId },
      }),
      repository.changeLifecycle({
        kind: 'DISH',
        aggregateId,
        expectedRevision: aggregate.revision,
        transition: 'RETIRE',
        context: { requestId: randomUUID(), actorId },
      }),
    ]);
    expect(retirementRace.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(retirementRace.filter(({ status }) => status === 'rejected')).toHaveLength(1);

    await expect(repository.requireCurrentVersion('DISH', aggregateId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(repository.resolveExactVersion('DISH', firstVersionId)).resolves.toMatchObject({
      state: 'SUPERSEDED',
      versionNumber: 1,
    });
    await expect(repository.resolveExactVersion('DISH', secondVersionId)).resolves.toMatchObject({
      state: 'PUBLISHED',
      versionNumber: 2,
    });
  }, 30_000);
});
