import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GridFsFoodMediaStore } from '../../../src/integrations/storage/gridfs-food-media.store.js';
import { MongoFoodStorageProvider } from '../../../src/integrations/storage/mongo-food-storage-provider.js';
import { createStorageObjectReference } from '../../../src/integrations/storage/storage-provider.js';
import { createCatalogMediaService } from '../../../src/modules/venue-catalog/application/catalog-media.service.js';
import { createMenuService } from '../../../src/modules/venue-catalog/application/menu.service.js';
import { CatalogTestDatabase, catalogMigrationDatabaseUrl } from './catalog-test-database.js';

const uri = process.env.TEST_MONGO_URI;
describe.skipIf(!uri || !catalogMigrationDatabaseUrl)(
  'food catalog PostgreSQL/MongoDB ownership',
  () => {
    const database = new CatalogTestDatabase('mongo_food');
    const mongoDatabase = `wedding_food_test_${randomUUID().replaceAll('-', '')}`;
    const client = new MongoClient(uri ?? 'mongodb://127.0.0.1:27128');
    const store = new GridFsFoodMediaStore(client, mongoDatabase);
    let root: string;
    let storage: MongoFoodStorageProvider;
    beforeAll(async () => {
      root = await mkdtemp(join(tmpdir(), 'mongo-food-catalog-'));
      storage = new MongoFoodStorageProvider(
        { root, publicOrigin: 'https://api.example.test', signingKey: 'x'.repeat(32) },
        store,
      );
      await database.connect();
      await store.initialize();
    }, 60_000);
    afterAll(async () => {
      await database.disconnect();
      await client.db(mongoDatabase).dropDatabase();
      await client.close();
      if (root) await rm(root, { recursive: true, force: true });
    }, 60_000);
    it.each(['DISH_VERSION', 'MENU_PACKAGE_VERSION'] as const)(
      'preserves %s original bytes through publish, clone and replacement',
      async (resourceType) => {
        const menu = createMenuService(database.prisma, undefined, storage);
        const media = createCatalogMediaService(database.prisma, storage);
        const context = { actorId: randomUUID(), requestId: randomUUID() };
        const dishId = randomUUID();
        const dishVersionId = randomUUID();
        await menu.createDish({
          dishId,
          versionId: dishVersionId,
          displayOrder: 1,
          name: 'Món thử MongoDB',
          description: 'Ảnh kiểm thử',
          categoryLabel: 'Khai vị',
          priceVnd: 120000,
          context,
        });
        const aggregateId = resourceType === 'DISH_VERSION' ? dishId : randomUUID();
        const versionId = resourceType === 'DISH_VERSION' ? dishVersionId : randomUUID();
        if (resourceType === 'MENU_PACKAGE_VERSION') {
          await menu.publishDish({
            dishId,
            versionId: dishVersionId,
            expectedRevision: 1,
            context,
          });
          await menu.createMenuPackage({
            menuPackageId: aggregateId,
            versionId,
            displayOrder: 1,
            name: 'Gói thử MongoDB',
            description: 'Theo bàn',
            priceVndPerTable: 3000000,
            items: [{ dishVersionId, displayOrder: 1 }],
            context,
          });
        }
        const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
        await media.upload({
          assetId: randomUUID(),
          resourceType,
          resourceId: versionId,
          bytes,
          contentType: 'image/png',
          alternativeText: 'Ảnh gốc',
          context,
        });
        if (resourceType === 'DISH_VERSION')
          await menu.publishDish({ dishId: aggregateId, versionId, expectedRevision: 1, context });
        else
          await menu.publishMenuPackage({
            menuPackageId: aggregateId,
            versionId,
            expectedRevision: 1,
            context,
          });
        const cloneId = randomUUID();
        if (resourceType === 'DISH_VERSION')
          await menu.cloneDishVersion({
            dishId: aggregateId,
            sourceVersionId: versionId,
            versionId: cloneId,
            context,
          });
        else
          await menu.cloneMenuPackageVersion({
            menuPackageId: aggregateId,
            sourceVersionId: versionId,
            versionId: cloneId,
            context,
          });
        const original = await database.prisma.catalogMediaAsset.findFirstOrThrow({
          where: { resourceType, resourceId: versionId, detachedAt: null },
        });
        const cloned = await database.prisma.catalogMediaAsset.findFirstOrThrow({
          where: { resourceType, resourceId: cloneId, detachedAt: null },
        });
        expect(cloned.objectKey).not.toBe(original.objectKey);
        const reference = (row: typeof original) =>
          createStorageObjectReference({ ...row, purpose: 'VENUE_CATALOG_MEDIA' });
        expect(await store.read(reference(cloned))).toEqual(bytes);
        await media.replace({
          oldAssetId: cloned.id,
          assetId: randomUUID(),
          resourceType,
          resourceId: cloneId,
          bytes: Uint8Array.from([...bytes, 2]),
          contentType: 'image/png',
          alternativeText: 'Ảnh mới',
          context,
        });
        expect(await store.read(reference(original))).toEqual(bytes);
        expect((await media.listSigned(resourceType, versionId))[0]?.id).toBe(original.id);
        media.dispose();
      },
      30_000,
    );
  },
);
