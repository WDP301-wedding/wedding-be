import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';
import { studioFixture } from './studio-fixture.js';
import {
  newDatabaseDiagnostics,
  withDatabaseDiagnostics,
} from '../../../src/core/database/diagnostics.js';

const suite = catalogMigrationDatabaseUrl ? describe : describe.skip;
suite('Public invitation bounded SQL reads', () => {
  const db = new CatalogTestDatabase('public_invitation_budget');
  let f: Awaited<ReturnType<typeof studioFixture>>;
  let publication: Awaited<ReturnType<typeof f.services.publication.publish>>;
  beforeAll(async () => {
    vi.stubEnv('DB_DIAGNOSTICS_ENABLED', 'true');
    await db.connect();
    f = await studioFixture(db.prisma);
    const design = await f.services.designs.create(
      { bookingId: f.bookingId, content: f.content, idempotencyKey: randomUUID() },
      f.couple,
    );
    publication = await f.services.publication.publish(
      {
        bookingId: f.bookingId,
        designId: design.designId,
        designRevisionId: design.revisionId,
        expectedRevision: design.revisionNumber,
        expectedPublicationRevision: 0,
        idempotencyKey: randomUUID(),
      },
      f.couple,
    );
  }, 60000);
  afterAll(async () => {
    try {
      await db.disconnect();
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('uses one joined content read and a separate revocation recheck', async () => {
    const diagnostics = newDatabaseDiagnostics();
    const result = await withDatabaseDiagnostics(diagnostics, () =>
      f.services.publication.readPublic(publication.publicSlug),
    );
    expect(result).toMatchObject({
      publishedRevisionId: publication.publishedRevisionId,
      title: f.content.title,
    });
    expect(diagnostics.queries).toBe(2);
  });
  it('conceals unknown and revoked slugs with one query', async () => {
    const unknown = newDatabaseDiagnostics();
    await expect(
      withDatabaseDiagnostics(unknown, () => f.services.publication.readPublic('0'.repeat(64))),
    ).rejects.toMatchObject({ status: 404 });
    expect(unknown.queries).toBe(1);
    await f.services.publication.unpublish(
      {
        bookingId: f.bookingId,
        expectedRevision: publication.publicationRevision,
        idempotencyKey: randomUUID(),
      },
      f.couple,
    );
    const revoked = newDatabaseDiagnostics();
    await expect(
      withDatabaseDiagnostics(revoked, () =>
        f.services.publication.readPublic(publication.publicSlug),
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(revoked.queries).toBe(1);
  });
});
