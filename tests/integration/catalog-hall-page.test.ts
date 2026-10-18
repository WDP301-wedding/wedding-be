import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { createApp } from '../../src/app.js';
import { createVenueCatalogRouter } from '../../src/modules/venue-catalog/http/venue-catalog.router.js';
import {
  catalogPageSchema,
  publicHallSchema,
} from '../../src/modules/venue-catalog/http/venue-catalog.schemas.js';
import { createVenueService } from '../../src/modules/venue-catalog/application/venue.service.js';
import { createMenuService } from '../../src/modules/venue-catalog/application/menu.service.js';
import { createLayoutService } from '../../src/modules/venue-catalog/application/layout.service.js';
import { createTimelineService } from '../../src/modules/venue-catalog/application/timeline.service.js';
import { createPrismaClient } from '../../src/core/database/prisma.js';
import {
  newDatabaseDiagnostics,
  withDatabaseDiagnostics,
} from '../../src/core/database/diagnostics.js';
import { FakeStorageProvider } from '../../src/integrations/storage/fake-storage-provider.js';
import { createCatalogMediaService } from '../../src/modules/venue-catalog/application/catalog-media.service.js';
import { createCatalogQueryService } from '../../src/modules/venue-catalog/application/catalog-query.service.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)('PERF-09 captured Hall page', () => {
  const db = new CatalogTestDatabase('hall_snapshot');
  const actor = randomUUID();
  const storage = new FakeStorageProvider();
  let measured: ReturnType<typeof createPrismaClient>;
  let queries: ReturnType<typeof createCatalogQueryService>;
  const halls = Array.from({ length: 41 }, (_, n) => ({
    id: randomUUID(),
    name: `Snapshot ${n}`,
    nameNormalized: `snapshot ${n}`,
    description: `Description ${n}`,
    maxGuests: 100 + n,
    displayOrder: Math.floor(n / 2),
    lifecycle: n === 40 ? ('RETIRED' as const) : ('ACTIVE' as const),
    retiredAt: n === 40 ? new Date() : null,
    updatedByAccountId: actor,
  }));
  const ordered = halls
    .filter((h) => h.lifecycle === 'ACTIVE')
    .sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id));
  beforeAll(async () => {
    await db.connect();
    const url = new URL(catalogMigrationDatabaseUrl!);
    url.pathname = '/' + db.databaseName;
    measured = createPrismaClient(url.toString(), true);
    queries = createCatalogQueryService(measured, createCatalogMediaService(measured, storage));
    await measured.$connect();
    await db.prisma.hall.createMany({ data: halls });
    for (const hall of ordered.slice(20)) {
      const asset = await storage.put({
        bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]),
        contentType: 'image/png',
        purpose: 'VENUE_CATALOG_MEDIA',
        resourceId: hall.id,
      });
      await db.prisma.catalogMediaAsset.create({
        data: {
          id: randomUUID(),
          resourceType: 'HALL',
          resourceId: hall.id,
          objectKey: asset.objectKey,
          checksumSha256: asset.checksumSha256,
          contentType: asset.contentType,
          sizeBytes: asset.sizeBytes,
          alternativeText: hall.name,
          displayOrder: 1,
          createdByAccountId: actor,
        },
      });
    }
  }, 60000);
  afterAll(async () => {
    await measured?.$disconnect();
    await db.disconnect();
  }, 60000);

  for (const count of [1, 20])
    for (const assets of [false, true]) {
      it(`returns exactly ${count} ${assets ? 'media' : 'plain'} Halls in one driver command`, async () => {
        const offset = assets ? 20 : 0;
        const diagnostics = newDatabaseDiagnostics();
        const result = await withDatabaseDiagnostics(diagnostics, () =>
          queries.listPublicHalls({ limit: count, ...(assets ? { cursor: ordered[19]!.id } : {}) }),
        );
        expect(result.items).toHaveLength(count);
        expect(result.items).toEqual(
          ordered.slice(offset, offset + count).map((h) => ({
            id: h.id,
            name: h.name,
            description: h.description,
            maxGuests: h.maxGuests,
            media: assets
              ? [expect.objectContaining({ resourceId: h.id, signedUrlExpiresInSeconds: 900 })]
              : [],
          })),
        );
        expect(diagnostics.errors).toBe(0);
        expect(diagnostics.queries).toBe(1);
        expect(JSON.stringify(result)).not.toMatch(
          /objectKey|checksumSha256|updatedBy|revision|retiredAt/,
        );
      });
    }
  it('keeps tied display-order cursor continuity and ends at an empty page', async () => {
    const first = await queries.listPublicHalls({ limit: 20 });
    const last = await queries.listPublicHalls({ limit: 20, cursor: first.nextCursor! });
    expect([...first.items, ...last.items].map((h) => (h as { id: string }).id)).toEqual(
      ordered.map((h) => h.id),
    );
    expect(last.nextCursor).toBeNull();
    expect(await queries.listPublicHalls({ limit: 20, cursor: ordered.at(-1)!.id })).toEqual({
      items: [],
      nextCursor: null,
    });
  });
  it('rejects missing and retired cursor identities', async () => {
    for (const cursor of [randomUUID(), halls[40]!.id])
      await expect(queries.listPublicHalls({ limit: 20, cursor })).rejects.toMatchObject({
        status: 422,
      });
  });
  for (const limit of [1, 20])
    for (const assets of [false, true]) {
      it(`keeps the strict HTTP page and one command for ${limit} ${assets ? 'media' : 'plain'} Halls`, async () => {
        const diagnostics = newDatabaseDiagnostics();
        const media = createCatalogMediaService(measured, storage);
        const signing = vi.spyOn(storage, 'createSignedReadUrl');
        const app = createApp({
          runtimeEnvironment: 'test',
          registerRoutes(a) {
            a.use((_req, _res, next) => withDatabaseDiagnostics(diagnostics, next));
            a.use(
              '/api/v1',
              createVenueCatalogRouter({
                createIdempotencyHandler: () => (_req, _res, next) =>
                  next(new Error('No mutations')),
                services: {
                  authorizeManager: () => Promise.reject(new Error('No manager operation')),
                  venue: createVenueService(measured),
                  menu: createMenuService(measured),
                  layout: createLayoutService(measured),
                  timeline: createTimelineService(measured),
                  media,
                  queries,
                },
              }),
            );
          },
        });
        try {
          const response = await request(app)
            .get('/api/v1/catalog/halls')
            .query({ limit, ...(assets ? { cursor: ordered[19]!.id } : {}) });
          expect(response.status).toBe(200);
          const schema = catalogPageSchema(
            publicHallSchema.extend({
              media: z.array(
                z.strictObject({
                  id: z.uuid(),
                  resourceType: z.literal('HALL'),
                  resourceId: z.uuid(),
                  contentType: z.literal('image/png'),
                  sizeBytes: z.int().positive(),
                  alternativeText: z.string(),
                  displayOrder: z.int(),
                  signedUrl: z.url(),
                  signedUrlExpiresInSeconds: z.literal(900),
                }),
              ),
            }),
          );
          expect(schema.parse(response.body).data.items).toHaveLength(limit);
          expect(diagnostics.queries).toBe(1);
          expect(diagnostics.errors).toBe(0);
          expect(signing).toHaveBeenCalledTimes(assets ? limit : 0);
        } finally {
          signing.mockRestore();
        }
      });
    }
  it('reads only its configured quoted schema, including empty pages and cursor concealment', async () => {
    const schema = 'hall"scope_' + randomUUID().replaceAll('-', '');
    const quote = '"' + schema.replaceAll('"', '""') + '"';
    const url = new URL(catalogMigrationDatabaseUrl!);
    url.pathname = '/' + db.databaseName;
    url.searchParams.set('schema', schema);
    const scoped = createPrismaClient(url.toString(), true);
    try {
      await db.prisma.$executeRawUnsafe('CREATE SCHEMA ' + quote);
      for (const table of ['Hall', 'CatalogMediaAsset'])
        await db.prisma.$executeRawUnsafe(
          'CREATE TABLE ' + quote + '."' + table + '" (LIKE public."' + table + '" INCLUDING ALL)',
        );
      const service = createCatalogQueryService(scoped, createCatalogMediaService(scoped, storage));
      expect(await service.listPublicHalls({ limit: 20 })).toEqual({ items: [], nextCursor: null });
      await expect(
        service.listPublicHalls({ limit: 20, cursor: ordered[0]!.id }),
      ).rejects.toMatchObject({ status: 422 });
      await db.prisma.$executeRawUnsafe(
        'INSERT INTO ' + quote + '."Hall" SELECT * FROM public."Hall" WHERE id=$1::uuid',
        ordered[20]!.id,
      );
      await db.prisma.$executeRawUnsafe(
        'UPDATE ' + quote + '."Hall" SET name=$1,"nameNormalized"=$2',
        'Scoped Hall',
        'scoped hall',
      );
      await db.prisma.$executeRawUnsafe(
        'INSERT INTO ' +
          quote +
          '."CatalogMediaAsset" SELECT * FROM public."CatalogMediaAsset" WHERE "resourceId"=$1::uuid',
        ordered[20]!.id,
      );
      expect(await service.listPublicHalls({ limit: 20 })).toEqual({
        items: [
          expect.objectContaining({
            id: ordered[20]!.id,
            name: 'Scoped Hall',
            media: [expect.objectContaining({ resourceId: ordered[20]!.id })],
          }),
        ],
        nextCursor: null,
      });
    } finally {
      await scoped.$disconnect();
      await db.prisma.$executeRawUnsafe('DROP TABLE ' + quote + '."CatalogMediaAsset"');
      await db.prisma.$executeRawUnsafe('DROP TABLE ' + quote + '."Hall"');
      await db.prisma.$executeRawUnsafe('DROP SCHEMA ' + quote);
    }
  });
  it('observes retirement and detached media on the next request without caching', async () => {
    const hall = ordered[20]!;
    await db.prisma.catalogMediaAsset.updateMany({
      where: { resourceId: hall.id },
      data: { detachedAt: new Date() },
    });
    const noMedia = await queries.listPublicHalls({ limit: 1, cursor: ordered[19]!.id });
    expect(noMedia.items).toEqual([
      {
        id: hall.id,
        name: hall.name,
        description: hall.description,
        maxGuests: hall.maxGuests,
        media: [],
      },
    ]);
    await db.prisma.hall.update({
      where: { id: hall.id },
      data: { lifecycle: 'RETIRED', retiredAt: new Date() },
    });
    const retired = await queries.listPublicHalls({ limit: 1, cursor: ordered[19]!.id });
    expect(retired.items).toEqual([expect.objectContaining({ id: ordered[21]!.id })]);
    await expect(queries.listPublicHalls({ limit: 1, cursor: hall.id })).rejects.toMatchObject({
      status: 422,
    });
  });
  it('orders only attached Hall-owned assets and signs each fresh page again', async () => {
    const hall = ordered[22]!;
    for (const [n, resourceType] of [
      [2, 'HALL'],
      [3, 'DISH_VERSION'],
    ] as const) {
      const object = await storage.put({
        bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, n]),
        purpose: 'VENUE_CATALOG_MEDIA',
        resourceId: hall.id,
        contentType: 'image/png',
      });
      await db.prisma.catalogMediaAsset.create({
        data: {
          id: randomUUID(),
          resourceType,
          resourceId: hall.id,
          objectKey: object.objectKey,
          checksumSha256: object.checksumSha256,
          contentType: object.contentType,
          sizeBytes: object.sizeBytes,
          alternativeText: 'Additional fixture',
          displayOrder: n,
          createdByAccountId: actor,
        },
      });
    }
    const signing = vi.spyOn(storage, 'createSignedReadUrl');
    try {
      for (let n = 0; n < 2; n++) {
        const result = await queries.listPublicHalls({ limit: 1, cursor: ordered[21]!.id });
        expect(result.items).toEqual([
          expect.objectContaining({
            id: hall.id,
            media: [
              expect.objectContaining({ resourceType: 'HALL', displayOrder: 1 }),
              expect.objectContaining({ resourceType: 'HALL', displayOrder: 2 }),
            ],
          }),
        ]);
      }
      expect(signing).toHaveBeenCalledTimes(4);
    } finally {
      signing.mockRestore();
    }
  });
});
