import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { catalogMigrationDatabaseUrl } from '../venue-catalog/catalog-test-database.js';

const describeDatabase = catalogMigrationDatabaseUrl ? describe : describe.skip;
describeDatabase('SPEC-05 media upgrade preserves existing data', () => {
  it('preserves populated core/media history, backfills intents and stops conflicting history without rebinding it', async () => {
    const name = `isw1_upgrade_${randomUUID().replaceAll('-', '')}`;
    const admin = new Client({ connectionString: catalogMigrationDatabaseUrl });
    const url = new URL(catalogMigrationDatabaseUrl!);
    url.pathname = `/${name}`;
    url.searchParams.delete('schema');
    const client = new Client({ connectionString: url.toString() });
    let created = false,
      connected = false;
    try {
      await admin.connect();
      await admin.query(`CREATE DATABASE "${name}"`);
      created = true;
      await client.connect();
      connected = true;
      const root = join(process.cwd(), 'prisma', 'migrations');
      const names = (await readdir(root, { withFileTypes: true }))
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();
      for (const migration of names.filter((n) => n < '20261008000000'))
        await client.query(await readFile(join(root, migration, 'migration.sql'), 'utf8'));
      const accountId = randomUUID(),
        auditId = randomUUID(),
        intentId = randomUUID();
      await client.query(
        'INSERT INTO "Account" (id,"emailNormalized","displayEmail","updatedAt") VALUES ($1,$2,$2,$3)',
        [accountId, 'upgrade@example.test', new Date('2026-10-07T00:00:00Z')],
      );
      await client.query(
        'INSERT INTO "AuditLog" (id,"requestId","actorType",action,"entityType",metadata) VALUES ($1,$2,$3,$4,$5,$6)',
        [auditId, randomUUID(), 'SYSTEM', 'upgrade.fixture', 'account', { preserve: true }],
      );
      await client.query(
        'INSERT INTO "IdempotencyRecord" (id,namespace,"idempotencyKey","requestHash",status,"expiresAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$6)',
        [
          intentId,
          'upgrade.fixture',
          'keep-intent',
          'c'.repeat(64),
          'IN_PROGRESS',
          new Date('2027-01-01T00:00:00Z'),
        ],
      );
      const snapshot = await client.query(
        'SELECT row_to_json(a) AS value FROM "Account" a WHERE id=$1',
        [accountId],
      );
      const audit = await client.query(
        'SELECT row_to_json(a) AS value FROM "AuditLog" a WHERE id=$1',
        [auditId],
      );
      const intent = await client.query(
        'SELECT row_to_json(a) AS value FROM "IdempotencyRecord" a WHERE id=$1',
        [intentId],
      );
      await client.query(
        await readFile(join(root, '20261008000000_invitation_media', 'migration.sql'), 'utf8'),
      );
      const bookingId = randomUUID(),
        assetId = randomUUID(),
        fileId = randomUUID(),
        attemptId = randomUUID();
      const checksum = 'a'.repeat(64),
        key = 'b'.repeat(64),
        digest = 'c'.repeat(64);
      const attemptSql =
        'INSERT INTO "InvitationMediaUploadAttempt" (id,"bookingId","objectKey","checksumSha256","contentType","sizeBytes","intentKeyDigest","commandDigest","createdAt","policyRevision") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)';
      const attemptValues = [
        attemptId,
        bookingId,
        `private-wedding-media/${bookingId}/${checksum}.png`,
        checksum,
        'image/png',
        8,
        key,
        digest,
        new Date('2026-10-07T00:00:00Z'),
        0,
      ];
      await client.query(attemptSql, attemptValues);
      await client.query(attemptSql, [
        randomUUID(),
        ...attemptValues.slice(1, 6),
        'd'.repeat(64),
        digest,
        ...attemptValues.slice(8),
      ]);
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO "InvitationMediaAsset" (id,"bookingId",revision,"currentFileRevisionId") VALUES ($1,$2,1,$3)',
        [assetId, bookingId, fileId],
      );
      await client.query(
        'INSERT INTO "InvitationMediaFile" (id,"bookingId","assetId",revision,"objectKey","checksumSha256","contentType","sizeBytes",width,height,"altText","acceptedAt","policyRevision","cutoffAt","uploadAttemptId") VALUES ($1,$2,$3,1,$4,$5,\'image/png\',8,2,2,\'Preserve\',$6,0,$7,$8)',
        [
          fileId,
          bookingId,
          assetId,
          attemptValues[2],
          checksum,
          new Date('2026-10-07T00:00:00Z'),
          new Date('2026-10-12T00:00:00Z'),
          attemptId,
        ],
      );
      await client.query('COMMIT');
      await client.query(
        'INSERT INTO "InvitationMediaReceipt" ("bookingId","intentKeyDigest","commandDigest",result) VALUES ($1,$2,$3,$4)',
        [
          bookingId,
          key,
          digest,
          { id: assetId, revision: 1, currentFileRevisionId: fileId, detachedAt: null },
        ],
      );
      const oldFiles = (
        await client.query('SELECT to_jsonb(a) AS value FROM "InvitationMediaFile" a')
      ).rows;
      const oldAssets = (
        await client.query('SELECT to_jsonb(a) AS value FROM "InvitationMediaAsset" a')
      ).rows;
      const oldReceipts = (
        await client.query('SELECT to_jsonb(a) AS value FROM "InvitationMediaReceipt" a')
      ).rows;
      const oldAttempts = (
        await client.query(
          'SELECT to_jsonb(a) AS value FROM "InvitationMediaUploadAttempt" a ORDER BY id',
        )
      ).rows;
      const recoveryMigration = await readFile(
        join(root, '20261009000000_invitation_media_command_recovery', 'migration.sql'),
        'utf8',
      );
      // Conflict rehearsal is one rolled-back transaction in the test-owned DB.
      await client.query('BEGIN');
      await client.query(attemptSql, [
        randomUUID(),
        ...attemptValues.slice(1, 7),
        'e'.repeat(64),
        ...attemptValues.slice(8),
      ]);
      await expect(client.query(recoveryMigration)).rejects.toThrow(
        'Conflicting invitation media command history requires reconciliation',
      );
      await client.query('ROLLBACK');
      for (const migration of names.filter((n) => n > '20261008000000_invitation_media'))
        await client.query(await readFile(join(root, migration, 'migration.sql'), 'utf8'));
      expect(
        (
          await client.query('SELECT row_to_json(a) AS value FROM "Account" a WHERE id=$1', [
            accountId,
          ])
        ).rows,
      ).toEqual(snapshot.rows);
      expect(
        (
          await client.query('SELECT row_to_json(a) AS value FROM "AuditLog" a WHERE id=$1', [
            auditId,
          ])
        ).rows,
      ).toEqual(audit.rows);
      expect(
        (
          await client.query(
            'SELECT row_to_json(a) AS value FROM "IdempotencyRecord" a WHERE id=$1',
            [intentId],
          )
        ).rows,
      ).toEqual(intent.rows);
      expect(
        (await client.query('SELECT count(*)::int AS count FROM "InvitationMediaCommand"')).rows,
      ).toEqual([{ count: 2 }]);
      expect(
        (await client.query('SELECT count(*)::int AS count FROM "InvitationMediaUploadAttempt"'))
          .rows,
      ).toEqual([{ count: 2 }]);
      expect(
        (await client.query('SELECT to_jsonb(a) AS value FROM "InvitationMediaFile" a')).rows,
      ).toEqual(oldFiles);
      expect(
        (await client.query('SELECT to_jsonb(a) AS value FROM "InvitationMediaAsset" a')).rows,
      ).toEqual(oldAssets);
      expect(
        (await client.query('SELECT to_jsonb(a) AS value FROM "InvitationMediaReceipt" a')).rows,
      ).toEqual(oldReceipts);
      expect(
        (
          await client.query(
            'SELECT to_jsonb(a)-\'sequence\' AS value FROM "InvitationMediaUploadAttempt" a ORDER BY id',
          )
        ).rows,
      ).toEqual(oldAttempts);
      expect(
        (
          await client.query(
            'SELECT count(DISTINCT sequence)::int AS count FROM "InvitationMediaUploadAttempt"',
          )
        ).rows,
      ).toEqual([{ count: 2 }]);
    } finally {
      if (connected) await client.end();
      if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      await admin.end();
    }
  }, 60_000);
});
