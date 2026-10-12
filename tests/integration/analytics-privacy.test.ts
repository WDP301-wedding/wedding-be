import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'SPEC-10 private reporting database boundary',
  () => {
    const db = new CatalogTestDatabase('analytics_privacy');
    beforeAll(() => db.connect(), 60000);
    afterAll(() => db.disconnect());
    it('denies reporting rows to a granted non-owner role while owner capture remains functional', async () => {
      const f = await studioFixture(db.prisma);
      expect(
        await db.prisma.reportingFact.count({ where: { recordId: f.bookingId } }),
      ).toBeGreaterThan(0);
      const url = new URL(catalogMigrationDatabaseUrl!);
      url.pathname = '/' + db.databaseName;
      const client = new Client({ connectionString: url.toString() });
      await client.connect();
      const role = 'analytics_probe_' + randomUUID().replaceAll('-', '');
      const tables =
        '"ReportingSequence", "ReportingFact", "AnalyticsGeneration", "AnalyticsHead", "AnalyticsProjection"';
      try {
        await client.query(`CREATE ROLE ${role} NOLOGIN`);
        await client.query(`GRANT SELECT ON ${tables} TO ${role}`);
        await client.query('BEGIN');
        await client.query(`SET LOCAL ROLE ${role}`);
        expect((await client.query('SELECT * FROM "ReportingFact"')).rows).toEqual([]);
        expect((await client.query('SELECT * FROM "ReportingSequence"')).rows).toEqual([]);
        await client.query('ROLLBACK');
        const flags = await client.query<{ relrowsecurity: boolean }>(
          `SELECT relrowsecurity FROM pg_class WHERE oid IN ('"ReportingSequence"'::regclass,'"ReportingFact"'::regclass,'"AnalyticsGeneration"'::regclass,'"AnalyticsHead"'::regclass,'"AnalyticsProjection"'::regclass)`,
        );
        expect(flags.rows).toHaveLength(5);
        expect(flags.rows.every((r) => r.relrowsecurity)).toBe(true);
      } finally {
        await client.query('ROLLBACK');
        await client.query(`REVOKE SELECT ON ${tables} FROM ${role}`);
        await client.query(`DROP ROLE ${role}`);
        await client.end();
      }
    });
  },
);
