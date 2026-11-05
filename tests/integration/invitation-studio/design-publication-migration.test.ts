import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';

const database = new CatalogTestDatabase('design_publication_migration');
const suite = catalogMigrationDatabaseUrl ? describe : describe.skip;
const rows = [true, false].map((published) => ({
  bookingId: randomUUID(),
  designId: randomUUID(),
  designRevisionId: randomUUID(),
  publicId: randomUUID(),
  publicationId: randomUUID(),
  slug: randomUUID().replaceAll('-', '').repeat(2),
  published,
}));

suite('per-design publication forward migration', () => {
  beforeAll(
    () =>
      database.connect(async (name, url) => {
        if (name !== '20261105090000_per_design_publication') return;
        const client = new Client({ connectionString: url });
        await client.connect();
        try {
          await client.query('BEGIN');
          for (const row of rows) {
            await client.query(
              'INSERT INTO "InvitationDesign" (id,"bookingId",revision,"currentRevisionId") VALUES ($1,$2,1,$3)',
              [row.designId, row.bookingId, row.designRevisionId],
            );
            await client.query(
              'INSERT INTO "InvitationDesignRevision" (id,"designId","bookingId",revision,content) VALUES ($1,$2,$3,1,$4)',
              [
                row.designRevisionId,
                row.designId,
                row.bookingId,
                JSON.stringify({ title: 'Thiệp giữ nguyên' }),
              ],
            );
            await client.query(
              'INSERT INTO "InvitationPublishedRevision" (id,"bookingId","designRevisionId",content,"assetIds") VALUES ($1,$2,$3,$4,$5)',
              [
                row.publicationId,
                row.bookingId,
                row.designRevisionId,
                JSON.stringify({ title: 'Nội dung lịch sử' }),
                [],
              ],
            );
            await client.query(
              'INSERT INTO "InvitationPublicIdentity" (id,"bookingId",slug,"publicUrl",revision,"currentPublicationId") VALUES ($1,$2,$3,$4,7,$5)',
              [
                row.publicId,
                row.bookingId,
                row.slug,
                `https://example.test/t/${row.slug}`,
                row.published ? row.publicationId : null,
              ],
            );
          }
          await client.query('COMMIT');
        } finally {
          await client.end();
        }
      }),
    60000,
  );
  afterAll(() => database.disconnect(), 60000);

  it('retains existing active and unpublished links, revision numbers and immutable content', async () => {
    for (const row of rows) {
      expect(
        await database.prisma.invitationPublicIdentity.findUnique({ where: { id: row.publicId } }),
      ).toMatchObject({
        bookingId: row.bookingId,
        designId: row.designId,
        isDefault: true,
        revision: 7,
        slug: row.slug,
        publicUrl: `https://example.test/t/${row.slug}`,
        currentPublicationId: row.published ? row.publicationId : null,
      });
      expect(
        (
          await database.prisma.invitationPublishedRevision.findUniqueOrThrow({
            where: { id: row.publicationId },
          })
        ).content,
      ).toEqual({ title: 'Nội dung lịch sử' });
    }
  });
});
