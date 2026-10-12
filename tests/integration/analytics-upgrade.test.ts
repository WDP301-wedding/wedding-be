import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../src/core/database/prisma.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';
import { createAnalyticsServices } from '../../src/modules/analytics-dashboard/infrastructure/analytics.composition.js';
(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'SPEC-10 populated forward migration',
  () => {
    const db = new CatalogTestDatabase('analytics_upgrade');
    let bookingId: string, managerId: string, oldCount: number;
    beforeAll(
      () =>
        db.connect(async (name, url) => {
          if (name !== '20261013001000_analytics_owner_feeds') return;
          const prisma = createPrismaClient(url);
          await prisma.$connect();
          try {
            const f = await studioFixture(prisma);
            bookingId = f.bookingId;
            managerId = f.manager.actorId;
            oldCount = await prisma.bookingReportingSnapshot.count();
          } finally {
            await prisma.$disconnect();
          }
        }),
      60000,
    );
    afterAll(() => db.disconnect());
    it('backfills existing owner facts without changing old evidence or inventing historical slots', async () => {
      const s = createAnalyticsServices(db.prisma),
        context = {
          authority: 'AUTHENTICATED' as const,
          actorAccountId: managerId,
          requestId: randomUUID(),
          causationId: randomUUID(),
        };
      const p = await s.sources.booking.readPage({ afterSequence: 0, limit: 500 }, context);
      expect(p.rows.find((r) => r.recordId === bookingId)?.value).toMatchObject({
        bookingId,
        phase: 'CONFIRMED',
        planningHeadcount: 20,
      });
      expect(await db.prisma.bookingReportingSnapshot.count()).toBe(oldCount);
      const v = await s.sources.venue.readPage({ afterSequence: 0, limit: 500 }, context);
      expect(v.rows).toHaveLength(1);
      expect(Date.parse(v.rows[0]!.value.observedAt)).toBeGreaterThan(Date.now() - 120000);
      const client = new Client({ connectionString: catalogMigrationDatabaseUrl });
      await client.connect();
      try {
        expect((await client.query('SELECT version()')).rows[0]).toHaveProperty('version');
      } finally {
        await client.end();
      }
    });
  },
);
