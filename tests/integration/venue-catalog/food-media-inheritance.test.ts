import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { FakeStorageProvider } from '../../../src/integrations/storage/fake-storage-provider.js';
import {
  createStorageObjectReference,
  createStoredObject,
  type StorageProvider,
  type StoredObject,
} from '../../../src/integrations/storage/storage-provider.js';
import { createCatalogMediaService } from '../../../src/modules/venue-catalog/application/catalog-media.service.js';
import { createMenuService } from '../../../src/modules/venue-catalog/application/menu.service.js';
import { CatalogTestDatabase, catalogMigrationDatabaseUrl } from './catalog-test-database.js';

const describeWithDatabase = catalogMigrationDatabaseUrl ? describe : describe.skip;
const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
type FoodMediaType = 'DISH_VERSION' | 'MENU_PACKAGE_VERSION';

describeWithDatabase('Food version media inheritance', () => {
  const database = new CatalogTestDatabase('food_media');
  beforeAll(async () => database.connect(), 60_000);
  afterAll(async () => database.disconnect(), 60_000);

  async function fixture(resourceType: FoodMediaType) {
    const prisma = database.prisma;
    const storage = new FakeStorageProvider();
    const media = createCatalogMediaService(prisma, storage);
    const service = createMenuService(prisma, undefined, storage);
    const context = { actorId: randomUUID(), requestId: randomUUID() };
    const dishId = randomUUID();
    const dishVersionId = randomUUID();
    await service.createDish({
      dishId,
      versionId: dishVersionId,
      displayOrder: 1,
      name: 'Súp nấm',
      description: 'Công thức gốc',
      categoryLabel: 'Khai vị',
      priceVnd: 120_000,
      context,
    });
    const aggregateId = resourceType === 'DISH_VERSION' ? dishId : randomUUID();
    const sourceVersionId = resourceType === 'DISH_VERSION' ? dishVersionId : randomUUID();
    if (resourceType === 'MENU_PACKAGE_VERSION') {
      await service.publishDish({ dishId, versionId: dishVersionId, expectedRevision: 1, context });
      await service.createMenuPackage({
        menuPackageId: aggregateId,
        versionId: sourceVersionId,
        displayOrder: 1,
        name: 'Gói truyền thống',
        description: 'Giá theo bàn',
        priceVndPerTable: 3_000_000,
        items: [{ dishVersionId, displayOrder: 1 }],
        context,
      });
    }
    const upload = (number: number, alternativeText: string) =>
      media.upload({
        assetId: randomUUID(),
        resourceType,
        resourceId: sourceVersionId,
        bytes: Uint8Array.from([...pngBytes, number]),
        contentType: 'image/png',
        alternativeText,
        context,
      });
    const obsolete = await upload(1, 'Ảnh đã thay');
    await upload(2, 'Ảnh thứ hai');
    await media.replace({
      oldAssetId: obsolete.id,
      assetId: randomUUID(),
      resourceType,
      resourceId: sourceVersionId,
      bytes: Uint8Array.from([...pngBytes, 3]),
      contentType: 'image/png',
      alternativeText: 'Ảnh chính',
      context,
    });
    const publish = (versionId: string) =>
      resourceType === 'DISH_VERSION'
        ? service.publishDish({ dishId: aggregateId, versionId, expectedRevision: 1, context })
        : service.publishMenuPackage({
            menuPackageId: aggregateId,
            versionId,
            expectedRevision: 1,
            context,
          });
    await publish(sourceVersionId);
    const clone = (versionId: string) =>
      resourceType === 'DISH_VERSION'
        ? service.cloneDishVersion({ dishId: aggregateId, sourceVersionId, versionId, context })
        : service.cloneMenuPackageVersion({
            menuPackageId: aggregateId,
            sourceVersionId,
            versionId,
            context,
          });
    const rows = (resourceId: string) =>
      prisma.catalogMediaAsset.findMany({
        where: { resourceType, resourceId, detachedAt: null },
        orderBy: { displayOrder: 'asc' },
      });
    const findVersion = (id: string) =>
      resourceType === 'DISH_VERSION'
        ? prisma.dishVersion.findUnique({ where: { id } })
        : prisma.menuPackageVersion.findUnique({ where: { id } });
    return {
      storage,
      media,
      context,
      aggregateId,
      sourceVersionId,
      publish,
      clone,
      rows,
      findVersion,
    };
  }

  it.each<FoodMediaType>(['DISH_VERSION', 'MENU_PACKAGE_VERSION'])(
    '%s inherits attached images with independent ownership and preserves historical source images',
    async (resourceType) => {
      const fixtureData = await fixture(resourceType);
      const { storage, media, context, sourceVersionId, publish, clone, rows } = fixtureData;
      const originalRows = await rows(sourceVersionId);
      expect(originalRows).toHaveLength(2);
      const draftVersionId = randomUUID();
      await clone(draftVersionId);
      const inherited = await rows(draftVersionId);
      expect(inherited).toHaveLength(2);
      for (const [index, asset] of inherited.entries()) {
        const original = originalRows[index]!;
        expect(asset.id).not.toBe(original.id);
        expect(asset.objectKey).not.toBe(original.objectKey);
        expect(asset.objectKey).toContain(`/${draftVersionId}/`);
        expect(asset).toMatchObject({
          resourceType,
          resourceId: draftVersionId,
          checksumSha256: original.checksumSha256,
          contentType: original.contentType,
          sizeBytes: original.sizeBytes,
          alternativeText: original.alternativeText,
          displayOrder: original.displayOrder,
        });
        const reference = (resourceId: string, objectKey: string) =>
          createStorageObjectReference({ objectKey, purpose: 'VENUE_CATALOG_MEDIA', resourceId });
        expect(await storage.read(reference(draftVersionId, asset.objectKey))).toEqual(
          await storage.read(reference(sourceVersionId, original.objectKey)),
        );
      }
      expect(await media.listSigned(resourceType, draftVersionId)).toHaveLength(2);
      await media.replace({
        oldAssetId: inherited[0]!.id,
        assetId: randomUUID(),
        resourceType,
        resourceId: draftVersionId,
        bytes: Uint8Array.from([...pngBytes, 9]),
        contentType: 'image/png',
        alternativeText: 'Ảnh mới của bản nháp',
        context,
      });
      expect(await rows(sourceVersionId)).toEqual(originalRows);
      expect(await media.listSigned(resourceType, sourceVersionId)).toHaveLength(2);

      await publish(draftVersionId);
      const historicalCloneId = randomUUID();
      await clone(historicalCloneId);
      expect((await rows(historicalCloneId)).map(({ checksumSha256 }) => checksumSha256)).toEqual(
        originalRows.map(({ checksumSha256 }) => checksumSha256),
      );
      expect(await rows(sourceVersionId)).toEqual(originalRows);
    },
  );

  it.each<FoodMediaType>(['DISH_VERSION', 'MENU_PACKAGE_VERSION'])(
    '%s rolls back a conflicting clone without changing source media or leaving copied objects',
    async (resourceType) => {
      const { storage, sourceVersionId, clone, rows, findVersion } = await fixture(resourceType);
      const originals = await rows(sourceVersionId);
      await clone(randomUUID());
      const rejectedVersionId = randomUUID();
      await expect(clone(rejectedVersionId)).rejects.toMatchObject({
        code: 'CATALOG_DRAFT_CONFLICT',
      });
      expect(await findVersion(rejectedVersionId)).toBeNull();
      expect(await rows(rejectedVersionId)).toEqual([]);
      for (const number of [2, 3]) {
        await expect(
          storage.read(
            createStoredObject({
              bytes: Uint8Array.from([...pngBytes, number]),
              contentType: 'image/png',
              purpose: 'VENUE_CATALOG_MEDIA',
              resourceId: rejectedVersionId,
            }),
          ),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      }
      expect(await rows(sourceVersionId)).toEqual(originals);
    },
  );

  it.each<FoodMediaType>(['DISH_VERSION', 'MENU_PACKAGE_VERSION'])(
    '%s cleans up a partial storage copy and leaves no draft when reading a source image fails',
    async (resourceType) => {
      const { storage, media, sourceVersionId, clone, rows, findVersion } =
        await fixture(resourceType);
      const originals = await rows(sourceVersionId);
      const originalRead = storage.read.bind(storage);
      const read = vi.spyOn(storage, 'read').mockImplementation(async (reference) => {
        if (reference.objectKey === originals[1]!.objectKey)
          throw new Error('Source read unavailable');
        return originalRead(reference);
      });
      const rejectedVersionId = randomUUID();
      try {
        await expect(clone(rejectedVersionId)).rejects.toThrow('Source read unavailable');
      } finally {
        read.mockRestore();
      }
      expect(await findVersion(rejectedVersionId)).toBeNull();
      expect(await rows(rejectedVersionId)).toEqual([]);
      for (const number of [2, 3]) {
        await expect(
          storage.read(
            createStoredObject({
              bytes: Uint8Array.from([...pngBytes, number]),
              contentType: 'image/png',
              purpose: 'VENUE_CATALOG_MEDIA',
              resourceId: rejectedVersionId,
            }),
          ),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      }
      expect(await rows(sourceVersionId)).toEqual(originals);
      expect(await media.listSigned(resourceType, sourceVersionId)).toHaveLength(2);
    },
  );

  it.each(['unavailable', 'without-read', 'corrupted-bytes', 'write-then-throws'] as const)(
    '%s storage fails closed without a draft or copied objects and preserves source images',
    async (scenario) => {
      const { storage, media, context, aggregateId, sourceVersionId, rows, findVersion } =
        await fixture('DISH_VERSION');
      const originals = await rows(sourceVersionId);
      const originalRead = storage.read.bind(storage);
      const originalPut = storage.put.bind(storage);
      let selectedStorage: StorageProvider | undefined = storage;
      const restore: Array<() => void> = [];
      if (scenario === 'unavailable') selectedStorage = undefined;
      if (scenario === 'without-read') {
        selectedStorage = {
          put: originalPut,
          createSignedReadUrl: storage.createSignedReadUrl.bind(storage),
          delete: storage.delete.bind(storage),
        };
      }
      if (scenario === 'corrupted-bytes') {
        const spy = vi.spyOn(storage, 'read').mockImplementation(async (reference) => {
          const bytes = await originalRead(reference);
          if (reference.objectKey === originals[1]!.objectKey) bytes[bytes.length - 1]! ^= 1;
          return bytes;
        });
        restore.push(() => spy.mockRestore());
      }
      if (scenario === 'write-then-throws') {
        const spy = vi.spyOn(storage, 'put').mockImplementation(async (command) => {
          await originalPut(command);
          throw new Error('Upload response lost');
        });
        restore.push(() => spy.mockRestore());
      }
      const service = createMenuService(database.prisma, undefined, selectedStorage);
      const destination = randomUUID();
      try {
        const operation = service.cloneDishVersion({
          dishId: aggregateId,
          sourceVersionId,
          versionId: destination,
          context,
        });
        if (scenario === 'write-then-throws') {
          await expect(operation).rejects.toThrow('Upload response lost');
        } else {
          await expect(operation).rejects.toMatchObject({
            code: scenario === 'corrupted-bytes' ? 'PROVIDER_ERROR' : 'PROVIDER_UNAVAILABLE',
          });
        }
      } finally {
        for (const cleanup of restore) cleanup();
      }
      expect(await findVersion(destination)).toBeNull();
      expect(await rows(destination)).toEqual([]);
      for (const number of [2, 3]) {
        await expect(
          storage.read(
            createStoredObject({
              bytes: Uint8Array.from([...pngBytes, number]),
              contentType: 'image/png',
              purpose: 'VENUE_CATALOG_MEDIA',
              resourceId: destination,
            }),
          ),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      }
      expect(await rows(sourceVersionId)).toEqual(originals);
      expect(await media.listSigned('DISH_VERSION', sourceVersionId)).toHaveLength(2);
    },
  );

  it.each([
    'objectKey',
    'resourceId',
    'checksumSha256',
    'sizeBytes',
    'contentType',
    'purpose',
  ] as const)(
    'rejects a copied object with incorrect %s and removes its destination bytes',
    async (field) => {
      const { storage, media, sourceVersionId, clone, rows, findVersion } =
        await fixture('DISH_VERSION');
      const originals = await rows(sourceVersionId);
      const originalPut = storage.put.bind(storage);
      const wrongValues: Record<typeof field, Partial<StoredObject>> = {
        objectKey: {
          objectKey: createStorageObjectReference({
            objectKey: originals[0]!.objectKey,
            resourceId: sourceVersionId,
            purpose: 'VENUE_CATALOG_MEDIA',
          }).objectKey,
        },
        resourceId: { resourceId: sourceVersionId },
        checksumSha256: { checksumSha256: '0'.repeat(64) },
        sizeBytes: { sizeBytes: 1 },
        contentType: { contentType: 'image/jpeg' },
        purpose: { purpose: 'PRIVATE_WEDDING_MEDIA' },
      };
      const put = vi.spyOn(storage, 'put').mockImplementation(async (command) => ({
        ...(await originalPut(command)),
        ...wrongValues[field],
      }));
      const destination = randomUUID();
      try {
        await expect(clone(destination)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
      } finally {
        put.mockRestore();
      }
      expect(await findVersion(destination)).toBeNull();
      expect(await rows(destination)).toEqual([]);
      await expect(
        storage.read(
          createStoredObject({
            bytes: Uint8Array.from([...pngBytes, 3]),
            contentType: 'image/png',
            purpose: 'VENUE_CATALOG_MEDIA',
            resourceId: destination,
          }),
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await rows(sourceVersionId)).toEqual(originals);
      expect(await media.listSigned('DISH_VERSION', sourceVersionId)).toHaveLength(2);
    },
  );

  it('preserves the original provider error when orphan cleanup also fails', async () => {
    const { storage, media, sourceVersionId, clone, rows, findVersion } =
      await fixture('DISH_VERSION');
    const originals = await rows(sourceVersionId);
    const originalPut = storage.put.bind(storage);
    const put = vi.spyOn(storage, 'put').mockImplementation(async (command) => {
      await originalPut(command);
      throw new Error('Original upload failure');
    });
    const remove = vi.spyOn(storage, 'delete').mockRejectedValue(new Error('Cleanup unavailable'));
    const destination = randomUUID();
    try {
      await expect(clone(destination)).rejects.toThrow('Original upload failure');
    } finally {
      put.mockRestore();
      remove.mockRestore();
    }
    expect(await findVersion(destination)).toBeNull();
    expect(await rows(destination)).toEqual([]);
    const orphan = createStoredObject({
      bytes: Uint8Array.from([...pngBytes, 3]),
      contentType: 'image/png',
      purpose: 'VENUE_CATALOG_MEDIA',
      resourceId: destination,
    });
    await expect(storage.read(orphan)).resolves.toEqual(Uint8Array.from([...pngBytes, 3]));
    await storage.delete(orphan);
    expect(await rows(sourceVersionId)).toEqual(originals);
    expect(await media.listSigned('DISH_VERSION', sourceVersionId)).toHaveLength(2);
  });

  it('keeps copied objects when a concurrent retry for the same version succeeds', async () => {
    const { storage, sourceVersionId, clone, rows } = await fixture('DISH_VERSION');
    const originals = await rows(sourceVersionId);
    const destination = randomUUID();
    const firstBlocked = deferred();
    const failFirstRead = deferred();
    const finishSecondRead = deferred();
    const originalRead = storage.read.bind(storage);
    let secondImageReads = 0;
    let secondAttemptBlockedInStorage = false;
    const read = vi.spyOn(storage, 'read').mockImplementation(async (reference) => {
      if (reference.objectKey === originals[1]!.objectKey) {
        secondImageReads += 1;
        if (secondImageReads === 1) {
          firstBlocked.resolve();
          await failFirstRead.promise;
          throw new Error('First attempt lost its source read');
        }
        secondAttemptBlockedInStorage = true;
        await finishSecondRead.promise;
      }
      return originalRead(reference);
    });
    const firstAttempt = clone(destination).then(
      () => null,
      (error: unknown) => error,
    );
    let secondAttempt: ReturnType<typeof clone> | undefined;
    try {
      await firstBlocked.promise;
      secondAttempt = clone(destination);
      let secondAttemptWaitingOnDatabase = false;
      await vi.waitFor(
        async () => {
          // Coordinate with either an unserialized copy or a durable lock wait.
          // Only this fresh, disposable test database contributes matching locks.
          const [locks] = await database.prisma.$queryRaw<Array<{ waiting: number }>>`
            SELECT COUNT(*)::integer AS "waiting" FROM pg_locks
             WHERE locktype = 'advisory' AND NOT granted
               AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
          `;
          secondAttemptWaitingOnDatabase = (locks?.waiting ?? 0) > 0;
          expect(secondAttemptBlockedInStorage || secondAttemptWaitingOnDatabase).toBe(true);
        },
        { timeout: 5_000, interval: 20 },
      );
      failFirstRead.resolve();
      if (secondAttemptWaitingOnDatabase) finishSecondRead.resolve();
      expect(await firstAttempt).toMatchObject({ message: 'First attempt lost its source read' });
      finishSecondRead.resolve();
      await secondAttempt;
      const inherited = await rows(destination);
      expect(inherited).toHaveLength(2);
      for (const asset of inherited) {
        await expect(
          originalRead(
            createStorageObjectReference({
              objectKey: asset.objectKey,
              resourceId: destination,
              purpose: 'VENUE_CATALOG_MEDIA',
            }),
          ),
        ).resolves.toBeInstanceOf(Uint8Array);
      }
      expect(await rows(sourceVersionId)).toEqual(originals);
    } finally {
      failFirstRead.resolve();
      finishSecondRead.resolve();
      await Promise.allSettled([firstAttempt, ...(secondAttempt ? [secondAttempt] : [])]);
      read.mockRestore();
    }
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
