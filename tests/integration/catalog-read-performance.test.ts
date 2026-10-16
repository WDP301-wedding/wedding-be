import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { createCatalogQueryService } from '../../src/modules/venue-catalog/application/catalog-query.service.js';
import { createCatalogMediaService } from '../../src/modules/venue-catalog/application/catalog-media.service.js';
import { FakeStorageProvider } from '../../src/integrations/storage/fake-storage-provider.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'PERF-09 bounded public catalog work',
  () => {
    const db = new CatalogTestDatabase('catalog_perf');
    beforeAll(() => db.connect(), 60000);
    afterAll(() => db.disconnect(), 60000);
    it('paginates active halls in SQL, batches assets and rejects retired or missing cursors', async () => {
      const actorId = randomUUID();
      const halls = Array.from({ length: 23 }, (_, n) => ({
        id: randomUUID(),
        name: `Hall ${n}`,
        nameNormalized: `hall ${n}`,
        description: '',
        maxGuests: 100,
        displayOrder: Math.floor(n / 3),
        lifecycle: n === 22 ? ('RETIRED' as const) : ('ACTIVE' as const),
        retiredAt: n === 22 ? new Date() : null,
        updatedByAccountId: actorId,
      }));
      await db.prisma.hall.createMany({ data: halls });
      const expected = halls
        .filter((h) => h.lifecycle === 'ACTIVE')
        .sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id));
      const media = createCatalogMediaService(db.prisma, new FakeStorageProvider());
      const service = createCatalogQueryService(db.prisma, media);
      const find = vi.spyOn(db.prisma.hall, 'findMany'),
        assets = vi.spyOn(db.prisma.catalogMediaAsset, 'findMany');
      try {
        for (const limit of [1, 20]) {
          find.mockClear();
          assets.mockClear();
          const page = await service.listPublicHalls({ limit });
          expect(page.items).toEqual(
            expected.slice(0, limit).map(({ id, name, description, maxGuests }) => ({
              id,
              name,
              description,
              maxGuests,
              media: [],
            })),
          );
          expect(find).toHaveBeenCalledWith(expect.objectContaining({ take: limit + 1 }));
          expect(assets).toHaveBeenCalledTimes(1);
          const next = await service.listPublicHalls({ limit: 100, cursor: page.nextCursor! });
          expect([...page.items, ...next.items]).toHaveLength(22);
        }
        for (const cursor of [randomUUID(), halls[22]!.id])
          await expect(service.listPublicHalls({ limit: 20, cursor })).rejects.toMatchObject({
            status: 422,
          });
      } finally {
        find.mockRestore();
        assets.mockRestore();
      }
    });
  },
);
