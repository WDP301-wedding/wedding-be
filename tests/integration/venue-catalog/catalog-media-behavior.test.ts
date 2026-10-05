import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { NotFoundError } from '../../../src/core/errors/app-error.js';
import { FakeStorageProvider } from '../../../src/integrations/storage/fake-storage-provider.js';
import { createStoredObject } from '../../../src/integrations/storage/storage-provider.js';
import { createCatalogMediaService } from '../../../src/modules/venue-catalog/application/catalog-media.service.js';
import { CatalogTestDatabase, catalogMigrationDatabaseUrl } from './catalog-test-database.js';

const describeWithDatabase = catalogMigrationDatabaseUrl ? describe : describe.skip;
const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describeWithDatabase('VC-09 catalog media behavior', () => {
  const database = new CatalogTestDatabase('catalog_media');
  const storage = new FakeStorageProvider();
  const actorId = randomUUID();
  const hallId = randomUUID();
  const context = { actorId, requestId: randomUUID() };

  beforeAll(async () => {
    await database.connect();
    await database.prisma.hall.create({
      data: {
        id: hallId,
        name: 'Media Hall',
        nameNormalized: 'media hall',
        description: '',
        maxGuests: 100,
        displayOrder: 0,
        updatedByAccountId: actorId,
      },
    });
  }, 60_000);

  afterAll(async () => database.disconnect());

  it('attaches, signs, reorders, and atomically replaces private catalog media', async () => {
    const service = createCatalogMediaService(database.prisma, storage);
    const firstId = randomUUID();
    const secondId = randomUUID();
    const first = await service.upload({
      assetId: firstId,
      resourceType: 'HALL',
      resourceId: hallId,
      bytes: Uint8Array.from([...pngBytes, 1]),
      contentType: 'image/png',
      alternativeText: 'First image',
      context,
    });
    const second = await service.upload({
      assetId: secondId,
      resourceType: 'HALL',
      resourceId: hallId,
      bytes: Uint8Array.from([...pngBytes, 2]),
      contentType: 'image/png',
      alternativeText: 'Second image',
      context,
    });
    expect(first).not.toHaveProperty('objectKey');
    expect(second.displayOrder).toBe(2);

    await service.reorder({
      resourceType: 'HALL',
      resourceId: hallId,
      assetIds: [secondId, firstId],
      context,
    });
    await expect(service.listSigned('HALL', hallId)).resolves.toMatchObject([
      { id: secondId, displayOrder: 1 },
      { id: firstId, displayOrder: 2 },
    ]);

    const oldRow = await database.prisma.catalogMediaAsset.findUniqueOrThrow({
      where: { id: firstId },
    });
    const replacementId = randomUUID();
    await expect(
      service.replace({
        oldAssetId: firstId,
        assetId: replacementId,
        resourceType: 'HALL',
        resourceId: hallId,
        bytes: Uint8Array.from([...pngBytes, 3]),
        contentType: 'image/png',
        alternativeText: 'Replacement image',
        context,
      }),
    ).resolves.toMatchObject({ id: replacementId, displayOrder: 2 });
    await expect(
      storage.createSignedReadUrl({
        objectKey: oldRow.objectKey as never,
        purpose: 'VENUE_CATALOG_MEDIA',
        resourceId: hallId,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  }, 20_000);

  it('removes a newly uploaded object when the database attachment rolls back', async () => {
    const service = createCatalogMediaService(database.prisma, storage);
    const duplicateAssetId = randomUUID();
    await service.upload({
      assetId: duplicateAssetId,
      resourceType: 'HALL',
      resourceId: hallId,
      bytes: Uint8Array.from([...pngBytes, 4]),
      contentType: 'image/png',
      alternativeText: 'Existing image',
      context,
    });
    const rollbackBytes = Uint8Array.from([...pngBytes, 5]);
    const orphan = createStoredObject({
      bytes: rollbackBytes,
      contentType: 'image/png',
      purpose: 'VENUE_CATALOG_MEDIA',
      resourceId: hallId,
    });

    await expect(
      service.upload({
        assetId: duplicateAssetId,
        resourceType: 'HALL',
        resourceId: hallId,
        bytes: rollbackBytes,
        contentType: 'image/png',
        alternativeText: 'Must roll back',
        context,
      }),
    ).rejects.toMatchObject({ code: 'CATALOG_MEDIA_OWNERSHIP_CONFLICT' });
    await expect(storage.createSignedReadUrl(orphan)).rejects.toBeInstanceOf(NotFoundError);
  }, 15_000);
});
