import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)('Private external-work claims', () => {
  const db = new CatalogTestDatabase('studio_claim_privacy');
  beforeAll(() => db.connect(), 60000);
  afterAll(() => db.disconnect(), 60000);

  it('denies direct client reads and mutations even with explicit row grants', async () => {
    const url = new URL(catalogMigrationDatabaseUrl!);
    url.pathname = '/' + db.databaseName;
    const client = new Client({ connectionString: url.toString() });
    const role = 'claim_probe_' + randomUUID().replaceAll('-', '');
    const bookingId = randomUUID();
    await client.connect();
    try {
      await client.query(
        'INSERT INTO "InvitationExternalWork" ("bookingId","intentDigest",token,"expiresAt") VALUES ($1,$2,$3,now()+interval \'1 minute\')',
        [bookingId, 'a'.repeat(64), randomUUID()],
      );
      await client.query(`CREATE ROLE ${role} NOLOGIN`);
      await client.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON "InvitationExternalWork" TO ${role}`,
      );
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE ${role}`);
      expect((await client.query('SELECT * FROM "InvitationExternalWork"')).rows).toEqual([]);
      expect(
        (await client.query('UPDATE "InvitationExternalWork" SET "reservedFiles"=1')).rowCount,
      ).toBe(0);
      expect((await client.query('DELETE FROM "InvitationExternalWork"')).rowCount).toBe(0);
      await expect(
        client.query(
          'INSERT INTO "InvitationExternalWork" ("bookingId","intentDigest",token,"expiresAt") VALUES ($1,$2,$3,now())',
          [randomUUID(), 'b'.repeat(64), randomUUID()],
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await client.query('ROLLBACK');
      expect(
        (
          await client.query('SELECT * FROM "InvitationExternalWork" WHERE "bookingId"=$1', [
            bookingId,
          ])
        ).rows,
      ).toHaveLength(1);
      expect(
        (
          await client.query(
            'SELECT relrowsecurity FROM pg_class WHERE oid=\'"InvitationExternalWork"\'::regclass',
          )
        ).rows,
      ).toEqual([{ relrowsecurity: true }]);
    } finally {
      await client.query('ROLLBACK');
      await client.query(`REVOKE ALL ON "InvitationExternalWork" FROM ${role}`);
      await client.query(`DROP ROLE IF EXISTS ${role}`);
      await client.end();
    }
  });
});
