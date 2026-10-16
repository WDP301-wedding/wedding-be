import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { NotFoundError, ProviderError, ValidationError } from '../../../core/errors/app-error.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { FakeStorageProvider } from '../../../integrations/storage/fake-storage-provider.js';
import type { StorageProvider } from '../../../integrations/storage/storage-provider.js';
import { createCatalogMediaService } from './catalog-media.service.js';

const context = { actorId: randomUUID(), requestId: randomUUID() };
const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function uploadInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    assetId: randomUUID(),
    resourceType: 'HALL' as const,
    resourceId: randomUUID(),
    bytes: pngBytes,
    contentType: 'image/png' as const,
    alternativeText: 'Grand Hall',
    context,
    ...overrides,
  };
}

function mediaRow(input: ReturnType<typeof uploadInput>, objectKey: string) {
  return {
    id: input.assetId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    objectKey,
    checksumSha256: 'a'.repeat(64),
    contentType: input.contentType,
    sizeBytes: input.bytes.byteLength,
    alternativeText: input.alternativeText,
    displayOrder: 1,
    createdByAccountId: context.actorId,
    createdAt: new Date(),
    detachedAt: null,
  };
}

function uploadPrisma(input: ReturnType<typeof uploadInput>, provider: FakeStorageProvider) {
  const rows: ReturnType<typeof mediaRow>[] = [];
  const transaction = {
    hall: { count: vi.fn(() => Promise.resolve(1)) },
    catalogMediaAsset: {
      count: vi.fn((query?: { where?: { objectKey?: string; detachedAt?: null } }) =>
        Promise.resolve(
          query?.where?.objectKey === undefined
            ? rows.filter(({ detachedAt }) => detachedAt === null).length
            : rows.filter(
                (row) => row.objectKey === query.where?.objectKey && row.detachedAt === null,
              ).length,
        ),
      ),
      create: vi.fn(({ data }: { data: Omit<ReturnType<typeof mediaRow>, 'createdAt'> }) => {
        const row = { ...data, createdAt: new Date() } as ReturnType<typeof mediaRow>;
        rows.push(row);
        return Promise.resolve(row);
      }),
      findMany: vi.fn(() => Promise.resolve(rows.filter(({ detachedAt }) => detachedAt === null))),
    },
    auditLog: { create: vi.fn(() => Promise.resolve({})) },
  };
  const prisma = {
    hall: transaction.hall,
    catalogMediaAsset: transaction.catalogMediaAsset,
    $transaction: vi.fn(async (operation: (value: object) => Promise<unknown>) =>
      operation(transaction),
    ),
  } as unknown as PrismaClient;
  return { prisma, rows, transaction, provider, input };
}

describe('catalog media service', () => {
  it('batches resource existence and empty asset facts', async () => {
    const ids = [randomUUID(), randomUUID()];
    const prisma = {
      hall: { count: vi.fn(() => Promise.resolve(ids.length)) },
      catalogMediaAsset: { findMany: vi.fn(() => Promise.resolve([])) },
    };
    const service = createCatalogMediaService(prisma as never, new FakeStorageProvider());
    expect(await service.listSignedBatch('HALL', ids)).toEqual(new Map(ids.map((id) => [id, []])));
    expect(prisma.hall.count).toHaveBeenCalledTimes(1);
    expect(prisma.catalogMediaAsset.findMany).toHaveBeenCalledTimes(1);
    prisma.hall.count.mockResolvedValueOnce(1);
    await expect(service.listSignedBatch('HALL', ids)).rejects.toBeInstanceOf(NotFoundError);
  });
  it('uploads only purpose-bound validated media and exposes a redacted signed view', async () => {
    const input = uploadInput();
    const provider = new FakeStorageProvider();
    const fixture = uploadPrisma(input, provider);
    const service = createCatalogMediaService(fixture.prisma, provider);

    const result = await service.upload(input);

    expect(result).toMatchObject({
      id: input.assetId,
      resourceType: 'HALL',
      resourceId: input.resourceId,
      contentType: 'image/png',
      sizeBytes: pngBytes.byteLength,
      alternativeText: 'Grand Hall',
      displayOrder: 1,
      signedUrlExpiresInSeconds: 900,
    });
    expect(result.signedUrl).toContain('expiresIn=900');
    expect(result).not.toHaveProperty('objectKey');
    expect(result).not.toHaveProperty('checksumSha256');
    expect(JSON.stringify(result)).not.toContain('bucket');
    expect(fixture.rows[0]?.objectKey).toMatch(
      new RegExp(`^venue-catalog-media/${input.resourceId}/[a-f\\d]{64}\\.png$`, 'u'),
    );
  });

  it('rejects mismatched magic bytes, unsupported resource types, and missing ownership', async () => {
    const input = uploadInput();
    const provider = new FakeStorageProvider();
    const fixture = uploadPrisma(input, provider);
    const service = createCatalogMediaService(fixture.prisma, provider);

    await expect(service.upload({ ...input, contentType: 'image/jpeg' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      service.upload({ ...input, resourceType: 'BOOKING' as never }),
    ).rejects.toBeInstanceOf(ValidationError);

    fixture.transaction.hall.count.mockResolvedValue(0);
    await expect(service.upload(input)).rejects.toBeInstanceOf(NotFoundError);
    expect(fixture.rows).toHaveLength(0);
  });

  it('allowlists and verifies every approved catalog resource type', async () => {
    const resourceId = randomUUID();
    const count = vi.fn(() => Promise.resolve(1));
    const prisma = {
      restaurantProfile: { count },
      hall: { count },
      dishVersion: { count },
      menuPackageVersion: { count },
      timelineTemplateVersion: { count },
      layoutTemplateVersion: { count },
      catalogMediaAsset: { findMany: vi.fn(() => Promise.resolve([])) },
    } as unknown as PrismaClient;
    const service = createCatalogMediaService(prisma, new FakeStorageProvider());
    const resourceTypes = [
      'RESTAURANT_PROFILE',
      'HALL',
      'DISH_VERSION',
      'MENU_PACKAGE_VERSION',
      'TIMELINE_TEMPLATE_VERSION',
      'LAYOUT_TEMPLATE_VERSION',
    ] as const;

    for (const resourceType of resourceTypes) {
      await expect(service.listSigned(resourceType, resourceId)).resolves.toEqual([]);
    }
    expect(count).toHaveBeenCalledTimes(resourceTypes.length);
  });

  it('does not touch the database when Storage fails', async () => {
    const input = uploadInput();
    const provider: StorageProvider = {
      put: vi.fn(() => Promise.reject(new ProviderError('unavailable'))),
      createSignedReadUrl: vi.fn(),
      delete: vi.fn(),
    };
    const fixture = uploadPrisma(input, new FakeStorageProvider());
    const service = createCatalogMediaService(fixture.prisma, provider);

    await expect(service.upload(input)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(fixture.transaction.catalogMediaAsset.create).not.toHaveBeenCalled();
  });

  it('cleans an uploaded orphan after a database rollback without deleting referenced objects', async () => {
    const input = uploadInput();
    const provider = new FakeStorageProvider();
    const fixture = uploadPrisma(input, provider);
    fixture.prisma.$transaction = vi.fn(() => Promise.reject(new Error('rollback')));
    const service = createCatalogMediaService(fixture.prisma, provider);

    await expect(service.upload(input)).rejects.toThrow('rollback');
    const checksum = 'c7ad28f77ad659abf196c54bf9b9510cd9b7d2cf4548cc9a163e23ba66465f33';
    await expect(
      provider.createSignedReadUrl({
        objectKey: `venue-catalog-media/${input.resourceId}/${checksum}.png` as never,
        purpose: 'VENUE_CATALOG_MEDIA',
        resourceId: input.resourceId,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('enforces the 20-asset limit before attachment', async () => {
    const input = uploadInput();
    const provider = new FakeStorageProvider();
    const fixture = uploadPrisma(input, provider);
    fixture.transaction.catalogMediaAsset.count.mockResolvedValue(20);
    const service = createCatalogMediaService(fixture.prisma, provider);

    await expect(service.upload(input)).rejects.toMatchObject({
      code: 'CATALOG_MEDIA_LIMIT_REACHED',
    });
  });

  it('replaces atomically, keeps the prior asset on rollback, then deletes only the detached object', async () => {
    const resourceId = randomUUID();
    const oldInput = uploadInput({ resourceId, bytes: Uint8Array.from([...pngBytes, 1]) });
    const newInput = uploadInput({ resourceId, bytes: Uint8Array.from([...pngBytes, 2]) });
    const provider = new FakeStorageProvider();
    const oldStored = await provider.put({
      bytes: oldInput.bytes,
      contentType: oldInput.contentType,
      purpose: 'VENUE_CATALOG_MEDIA',
      resourceId,
    });
    const oldRow = mediaRow(oldInput, oldStored.objectKey);
    const rows = [oldRow];
    const update = vi.fn(
      ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.find(({ id }) => id === where.id);
        if (row !== undefined) Object.assign(row, data);
        return Promise.resolve(row);
      },
    );
    const transaction = {
      hall: { count: vi.fn(() => Promise.resolve(1)) },
      catalogMediaAsset: {
        count: vi.fn(({ where }: { where: { objectKey?: string; detachedAt?: null } }) =>
          Promise.resolve(
            where.objectKey === undefined
              ? rows.filter(({ detachedAt }) => detachedAt === null).length
              : rows.filter((row) => row.objectKey === where.objectKey && row.detachedAt === null)
                  .length,
          ),
        ),
        findFirst: vi.fn(() => Promise.resolve(oldRow)),
        create: vi.fn(({ data }: { data: Omit<ReturnType<typeof mediaRow>, 'createdAt'> }) => {
          const row = { ...data, createdAt: new Date() } as ReturnType<typeof mediaRow>;
          rows.push(row);
          return Promise.resolve(row);
        }),
        update,
        findMany: vi.fn(() =>
          Promise.resolve(rows.filter(({ detachedAt }) => detachedAt === null)),
        ),
      },
      auditLog: { create: vi.fn(() => Promise.resolve({})) },
    };
    const prisma = {
      hall: transaction.hall,
      catalogMediaAsset: transaction.catalogMediaAsset,
      $transaction: vi.fn(async (operation: (value: object) => Promise<unknown>) =>
        operation(transaction),
      ),
    } as unknown as PrismaClient;
    const service = createCatalogMediaService(prisma, provider);

    const replacement = await service.replace({ oldAssetId: oldRow.id, ...newInput });
    expect(replacement.id).toBe(newInput.assetId);
    expect(rows.find(({ id }) => id === oldRow.id)?.detachedAt).toBeInstanceOf(Date);
    await expect(provider.createSignedReadUrl(oldStored)).rejects.toBeInstanceOf(NotFoundError);

    const rollbackInput = uploadInput({ resourceId, bytes: Uint8Array.from([...pngBytes, 3]) });
    prisma.$transaction = vi.fn(() => Promise.reject(new Error('rollback')));
    await expect(
      service.replace({ oldAssetId: newInput.assetId, ...rollbackInput }),
    ).rejects.toThrow('rollback');
    await expect(
      provider.createSignedReadUrl({
        objectKey: rows.find(({ id }) => id === newInput.assetId)!.objectKey as never,
        purpose: 'VENUE_CATALOG_MEDIA',
        resourceId,
      }),
    ).resolves.toContain('expiresIn=900');
  });

  it('reorders only the complete attached set owned by one resource', async () => {
    const resourceId = randomUUID();
    const first = mediaRow(
      uploadInput({ resourceId }),
      `venue-catalog-media/${resourceId}/${'a'.repeat(64)}.png`,
    );
    const second = {
      ...mediaRow(
        uploadInput({ resourceId }),
        `venue-catalog-media/${resourceId}/${'b'.repeat(64)}.png`,
      ),
      displayOrder: 2,
    };
    const rows = [first, second];
    const transaction = {
      hall: { count: vi.fn(() => Promise.resolve(1)) },
      catalogMediaAsset: {
        findMany: vi.fn(() => Promise.resolve(rows)),
        updateMany: vi.fn(() => Promise.resolve({ count: 2 })),
        update: vi.fn(
          ({ where, data }: { where: { id: string }; data: { displayOrder: number } }) => {
            Object.assign(
              rows.find(({ id }) => id === where.id)!,
              data,
            );
            return Promise.resolve({});
          },
        ),
      },
      auditLog: { create: vi.fn(() => Promise.resolve({})) },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (value: object) => Promise<unknown>) =>
        operation(transaction),
      ),
    } as unknown as PrismaClient;
    const service = createCatalogMediaService(prisma, new FakeStorageProvider());

    await service.reorder({
      resourceType: 'HALL',
      resourceId,
      assetIds: [second.id, first.id],
      context,
    });
    expect(transaction.catalogMediaAsset.update).toHaveBeenNthCalledWith(1, {
      where: { id: second.id },
      data: { displayOrder: 1 },
    });
    await expect(
      service.reorder({
        resourceType: 'HALL',
        resourceId,
        assetIds: [first.id],
        context,
      }),
    ).rejects.toMatchObject({ code: 'CATALOG_MEDIA_OWNERSHIP_CONFLICT' });
  });

  it('claims the owning resource revision before an ordered media write', async () => {
    const resourceId = randomUUID();
    const revisionModel = () => ({
      count: vi.fn(() => Promise.resolve(1)),
      updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
    });
    const transaction = {
      restaurantProfile: revisionModel(),
      hall: revisionModel(),
      dishVersion: revisionModel(),
      menuPackageVersion: revisionModel(),
      timelineTemplateVersion: revisionModel(),
      layoutTemplateVersion: revisionModel(),
      catalogMediaAsset: {
        findMany: vi.fn(() => Promise.resolve([])),
        updateMany: vi.fn(() => Promise.resolve({ count: 0 })),
        update: vi.fn(),
      },
      auditLog: { create: vi.fn(() => Promise.resolve({})) },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (value: object) => Promise<unknown>) =>
        operation(transaction),
      ),
    } as unknown as PrismaClient;
    const service = createCatalogMediaService(prisma, new FakeStorageProvider());
    const resourceTypes = [
      'RESTAURANT_PROFILE',
      'HALL',
      'DISH_VERSION',
      'MENU_PACKAGE_VERSION',
      'TIMELINE_TEMPLATE_VERSION',
      'LAYOUT_TEMPLATE_VERSION',
    ] as const;

    for (const resourceType of resourceTypes) {
      await service.reorder({
        resourceType,
        resourceId,
        assetIds: [],
        expectedRevision: 4,
        context,
      });
    }

    expect(transaction.restaurantProfile.updateMany).toHaveBeenCalledWith({
      where: { id: resourceId, revision: 4 },
      data: { revision: { increment: 1 }, updatedByAccountId: context.actorId },
    });
    expect(transaction.layoutTemplateVersion.updateMany).toHaveBeenCalledWith({
      where: { id: resourceId, revision: 4, state: 'DRAFT' },
      data: { revision: { increment: 1 } },
    });

    transaction.hall.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      service.reorder({
        resourceType: 'HALL',
        resourceId,
        assetIds: [],
        expectedRevision: 4,
        context,
      }),
    ).rejects.toMatchObject({ code: 'CATALOG_REVISION_CONFLICT' });
  });
});
