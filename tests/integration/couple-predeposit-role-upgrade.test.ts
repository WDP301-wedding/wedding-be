import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../src/core/database/prisma.js';
import type { AccountRole, ConsultationAccess } from '../../src/generated/prisma/client.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';

const suite = catalogMigrationDatabaseUrl ? describe : describe.skip;
suite('pre-deposit Couple role forward migration', () => {
  const db = new CatalogTestDatabase('couple_role_upgrade');
  const restricted = randomUUID(),
    full = randomUUID(),
    staff = randomUUID(),
    unrelated = randomUUID(),
    suspended = randomUUID();
  let originalGrants: ConsultationAccess[] = [];
  let originalRoles: AccountRole[] = [];
  const migration = '20261023020000_couple_predeposit_app_access';
  beforeAll(async () => {
    await db.connect(async (name, url) => {
      if (name !== migration) return;
      const prior = createPrismaClient(url);
      try {
        for (const id of [restricted, full, staff, unrelated, suspended]) {
          await prior.account.create({
            data: {
              id,
              emailNormalized: `${id}@example.test`,
              displayEmail: `${id}@example.test`,
              ...(id === suspended ? { status: 'SUSPENDED' } : {}),
            },
          });
        }
        await prior.accountRole.createMany({
          data: [
            { accountId: full, role: 'COUPLE' },
            { accountId: staff, role: 'STAFF' },
          ],
        });
        for (const id of [restricted, full, staff, suspended, restricted]) {
          await prior.consultationAccess.create({
            data: {
              accountId: id,
              consultationId: randomUUID(),
              ...(id === full
                ? {
                    level: 'FULL',
                    bookingId: randomUUID(),
                    sourcePaymentId: randomUUID(),
                    promotedAt: new Date(),
                  }
                : {}),
            },
          });
        }
        originalGrants = await prior.consultationAccess.findMany({ orderBy: { id: 'asc' } });
        originalRoles = await prior.accountRole.findMany({ orderBy: { id: 'asc' } });
      } finally {
        await prior.$disconnect();
      }
    });
  }, 90_000);
  afterAll(async () => {
    await db.disconnect();
  });

  it('grants COUPLE once to existing workspace owners, preserves all grants and is safe to reapply', async () => {
    expect(await db.prisma.consultationAccess.findMany({ orderBy: { id: 'asc' } })).toEqual(
      originalGrants,
    );
    for (const accountId of [restricted, full, staff, suspended]) {
      expect(await db.prisma.accountRole.count({ where: { accountId, role: 'COUPLE' } })).toBe(1);
    }
    expect(await db.prisma.accountRole.count({ where: { accountId: unrelated } })).toBe(0);
    expect(
      await db.prisma.accountRole.findMany({
        where: { OR: [{ accountId: full }, { role: 'STAFF' }] },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(originalRoles);
    expect((await db.prisma.account.findUniqueOrThrow({ where: { id: suspended } })).status).toBe(
      'SUSPENDED',
    );
    const roles = await db.prisma.accountRole.findMany({ orderBy: { id: 'asc' } });
    const url = new URL(catalogMigrationDatabaseUrl!);
    url.pathname = '/' + db.databaseName;
    url.searchParams.delete('schema');
    url.searchParams.delete('options');
    const client = new Client({ connectionString: url.toString() });
    try {
      await client.connect();
      await client.query(await readFile(`prisma/migrations/${migration}/migration.sql`, 'utf8'));
    } finally {
      await client.end();
    }
    expect(await db.prisma.accountRole.findMany({ orderBy: { id: 'asc' } })).toEqual(roles);
    expect(await db.prisma.consultationAccess.findMany({ orderBy: { id: 'asc' } })).toEqual(
      originalGrants,
    );
  });
});
