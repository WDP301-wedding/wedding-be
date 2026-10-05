import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import type {
  CatalogVersionRepository,
  CompareAndSwapDraftInput,
} from '../infrastructure/catalog-version.repository.js';
import { createMenuService } from './menu.service.js';

const context = { actorId: randomUUID(), requestId: randomUUID() };

function versionRepository(
  overrides: Partial<CatalogVersionRepository> = {},
): CatalogVersionRepository {
  return {
    compareAndSwapDraft: vi.fn(() => Promise.resolve({ revision: 2 })),
    publish: vi.fn(() =>
      Promise.resolve({
        aggregateId: randomUUID(),
        previousVersionId: null,
        versionId: randomUUID(),
        versionNumber: 1,
      }),
    ),
    changeLifecycle: vi.fn(() => Promise.resolve({ lifecycle: 'RETIRED' as const, revision: 2 })),
    registerLayoutTable: vi.fn(() => Promise.resolve()),
    resolveExactVersion: vi.fn(() =>
      Promise.resolve({
        id: randomUUID(),
        aggregateId: randomUUID(),
        versionNumber: 1,
        state: 'PUBLISHED' as const,
        revision: 2,
      }),
    ),
    requireCurrentVersion: vi.fn(() =>
      Promise.resolve({
        id: randomUUID(),
        aggregateId: randomUUID(),
        versionNumber: 1,
        state: 'PUBLISHED' as const,
        revision: 2,
      }),
    ),
    ...overrides,
  };
}

describe('menu service', () => {
  it('validates integer VND prices before creating dish drafts', async () => {
    const runTransaction = vi.fn();
    const prisma = { $transaction: runTransaction } as unknown as PrismaClient;
    const service = createMenuService(prisma, versionRepository());

    await expect(
      service.createDish({
        dishId: randomUUID(),
        versionId: randomUUID(),
        displayOrder: 0,
        name: 'Soup',
        description: '',
        categoryLabel: 'Starter',
        priceVnd: 10.5,
        context,
      }),
    ).rejects.toMatchObject({ code: 'CATALOG_INTEGER_OUT_OF_BOUNDS' });
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('stores deterministic unique exact dish-version references in a package draft', async () => {
    const create = vi.fn(({ data }: { data: object }) => Promise.resolve(data));
    const transaction = {
      menuPackage: { create, update: vi.fn(() => Promise.resolve({})) },
      menuPackageVersion: { create: vi.fn(({ data }: { data: object }) => Promise.resolve(data)) },
      menuPackageItem: { createMany: vi.fn(() => Promise.resolve({ count: 2 })) },
      auditLog: { create: vi.fn(() => Promise.resolve({})) },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (value: object) => Promise<unknown>) =>
        operation(transaction),
      ),
    } as unknown as PrismaClient;
    const service = createMenuService(prisma, versionRepository());
    const firstDish = randomUUID();
    const secondDish = randomUUID();

    await expect(
      service.createMenuPackage({
        menuPackageId: randomUUID(),
        versionId: randomUUID(),
        displayOrder: 0,
        name: 'Classic',
        description: '',
        priceVndPerTable: 5_000_000,
        items: [
          { dishVersionId: secondDish, displayOrder: 2 },
          { dishVersionId: firstDish, displayOrder: 1 },
        ],
        context,
      }),
    ).resolves.toMatchObject({ priceVndPerTable: 5_000_000 });
    expect(transaction.menuPackageItem.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ dishVersionId: firstDish, displayOrder: 1 }),
        expect.objectContaining({ dishVersionId: secondDish, displayOrder: 2 }),
      ],
    });

    await expect(
      service.createMenuPackage({
        menuPackageId: randomUUID(),
        versionId: randomUUID(),
        displayOrder: 1,
        name: 'Invalid',
        description: '',
        priceVndPerTable: 1,
        items: [
          { dishVersionId: firstDish, displayOrder: 1 },
          { dishVersionId: firstDish, displayOrder: 2 },
        ],
        context,
      }),
    ).rejects.toMatchObject({ code: 'CATALOG_DUPLICATE_IDENTITY' });
  });

  it('publishes packages only when every exact dish reference is active and current', async () => {
    const publish = vi.fn(
      async (input: {
        validateDependencies: (transaction: Prisma.TransactionClient) => Promise<void>;
      }) => {
        await input.validateDependencies({
          $queryRaw: vi.fn(() => Promise.resolve([{ total: 2, valid: 1 }])),
        } as unknown as Prisma.TransactionClient);
        return {
          aggregateId: randomUUID(),
          previousVersionId: null,
          versionId: randomUUID(),
          versionNumber: 1,
        };
      },
    );
    const service = createMenuService(
      {} as PrismaClient,
      versionRepository({ publish: publish as CatalogVersionRepository['publish'] }),
    );

    await expect(
      service.publishMenuPackage({
        menuPackageId: randomUUID(),
        versionId: randomUUID(),
        expectedRevision: 1,
        context,
      }),
    ).rejects.toMatchObject({ code: 'CATALOG_DISH_REFERENCE_CONFLICT' });
  });

  it('updates a dish draft without changing package item references', async () => {
    let mutate: ((transaction: Prisma.TransactionClient) => Promise<void>) | undefined;
    const compareAndSwapDraft = vi.fn((input: CompareAndSwapDraftInput) => {
      mutate = input.mutate;
      return Promise.resolve({ revision: 2 });
    });
    const repository = versionRepository({ compareAndSwapDraft });
    const service = createMenuService({} as PrismaClient, repository);

    const versionId = randomUUID();
    await service.updateDishDraft({
      dishId: randomUUID(),
      versionId,
      expectedRevision: 1,
      name: 'Renamed',
      description: '',
      categoryLabel: 'Main',
      priceVnd: 250_000,
      context,
    });
    const update = vi.fn(() => Promise.resolve({}));
    await mutate?.({ dishVersion: { update } } as unknown as Prisma.TransactionClient);
    expect(update).toHaveBeenCalledWith({
      where: { id: versionId },
      data: {
        name: 'Renamed',
        description: '',
        categoryLabel: 'Main',
        priceVnd: 250_000,
      },
    });
  });

  it('resolves exact historical package content even when the aggregate is retired', async () => {
    const versionId = randomUUID();
    const dishVersionId = randomUUID();
    const prisma = {
      menuPackageVersion: {
        findFirst: vi.fn(() =>
          Promise.resolve({
            id: versionId,
            menuPackageId: randomUUID(),
            versionNumber: 1,
            revision: 2,
            state: 'SUPERSEDED',
            name: 'Classic',
            description: '',
            priceVndPerTable: 4_000_000,
            items: [
              {
                displayOrder: 0,
                dishVersion: {
                  id: dishVersionId,
                  dishId: randomUUID(),
                  versionNumber: 2,
                  name: 'Original dish',
                  description: '',
                  categoryLabel: 'Main',
                  priceVnd: 100_000,
                },
              },
            ],
          }),
        ),
      },
    } as unknown as PrismaClient;
    const service = createMenuService(prisma, versionRepository());

    await expect(service.resolveMenuPackageVersion(versionId)).resolves.toMatchObject({
      id: versionId,
      state: 'SUPERSEDED',
      items: [{ dishVersionId, name: 'Original dish' }],
    });
  });

  it('delegates dish publication and lifecycle while resolving current and exact snapshots', async () => {
    const publish = vi.fn(() =>
      Promise.resolve({
        aggregateId: randomUUID(),
        previousVersionId: null,
        versionId: randomUUID(),
        versionNumber: 1,
      }),
    );
    const changeLifecycle = vi.fn(() =>
      Promise.resolve({ lifecycle: 'ACTIVE' as const, revision: 3 }),
    );
    const dishVersion = {
      id: randomUUID(),
      dishId: randomUUID(),
      versionNumber: 2,
      state: 'PUBLISHED',
      revision: 3,
      name: 'Soup',
      description: '',
      categoryLabel: 'Starter',
      priceVnd: { toNumber: () => 150_000 },
    } as const;
    const prisma = {
      dishVersion: { findFirst: vi.fn(() => Promise.resolve(dishVersion)) },
    } as unknown as PrismaClient;
    const service = createMenuService(
      prisma,
      versionRepository({
        publish,
        changeLifecycle,
      }),
    );

    await service.publishDish({
      dishId: dishVersion.dishId,
      versionId: dishVersion.id,
      expectedRevision: 2,
      context,
    });
    await service.changeDishLifecycle({
      aggregateId: dishVersion.dishId,
      expectedRevision: 2,
      transition: 'RESTORE',
      context,
    });
    await expect(service.requireCurrentDishVersion(dishVersion.dishId)).resolves.toMatchObject({
      priceVnd: 150_000,
      versionNumber: 2,
    });
    await expect(service.resolveDishVersion(dishVersion.id)).resolves.toMatchObject({
      id: dishVersion.id,
      state: 'PUBLISHED',
    });
    expect(publish).toHaveBeenCalledOnce();
    expect(changeLifecycle).toHaveBeenCalledOnce();
  });

  it('updates menu draft content and exact item ordering through CAS', async () => {
    let mutate: ((transaction: Prisma.TransactionClient) => Promise<void>) | undefined;
    const compareAndSwapDraft = vi.fn((input: CompareAndSwapDraftInput) => {
      mutate = input.mutate;
      return Promise.resolve({ revision: 2 });
    });
    const service = createMenuService(
      {} as PrismaClient,
      versionRepository({ compareAndSwapDraft }),
    );
    const versionId = randomUUID();
    const dishVersionId = randomUUID();
    await service.updateMenuPackageDraft({
      menuPackageId: randomUUID(),
      versionId,
      expectedRevision: 1,
      name: 'Updated',
      description: '',
      priceVndPerTable: 1,
      items: [{ dishVersionId, displayOrder: 1 }],
      context,
    });
    const update = vi.fn(() => Promise.resolve({}));
    const deleteMany = vi.fn(() => Promise.resolve({ count: 1 }));
    const createMany = vi.fn(() => Promise.resolve({ count: 1 }));
    await mutate?.({
      menuPackageVersion: { update },
      menuPackageItem: { deleteMany, createMany },
    } as unknown as Prisma.TransactionClient);
    expect(update).toHaveBeenCalledWith({
      where: { id: versionId },
      data: { name: 'Updated', description: '', priceVndPerTable: 1 },
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [{ menuPackageVersionId: versionId, dishVersionId, displayOrder: 1 }],
    });
  });

  it('conceals missing or non-published dish and package versions', async () => {
    const missing = createMenuService(
      {
        dishVersion: { findFirst: vi.fn(() => Promise.resolve(null)) },
        menuPackageVersion: { findFirst: vi.fn(() => Promise.resolve(null)) },
      } as unknown as PrismaClient,
      versionRepository(),
    );
    await expect(missing.requireCurrentDishVersion(randomUUID())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(missing.resolveDishVersion(randomUUID())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(missing.requireCurrentMenuPackageVersion(randomUUID())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(missing.resolveMenuPackageVersion(randomUUID())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    const invalidDish = createMenuService(
      {
        dishVersion: {
          findFirst: vi.fn(() =>
            Promise.resolve({
              id: randomUUID(),
              dishId: randomUUID(),
              versionNumber: null,
              state: 'DRAFT',
              revision: 1,
              name: 'Draft',
              description: '',
              categoryLabel: 'Main',
              priceVnd: null,
            }),
          ),
        },
      } as unknown as PrismaClient,
      versionRepository(),
    );
    await expect(invalidDish.resolveDishVersion(randomUUID())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('maps duplicate drafts and rejects invalid aggregate ordering', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const service = createMenuService(
      { $transaction: vi.fn(() => Promise.reject(duplicate)) } as unknown as PrismaClient,
      versionRepository(),
    );
    const base = {
      dishId: randomUUID(),
      versionId: randomUUID(),
      name: 'Soup',
      description: '',
      categoryLabel: 'Starter',
      priceVnd: null,
      context,
    };
    await expect(service.createDish({ ...base, displayOrder: 0 })).rejects.toMatchObject({
      code: 'CATALOG_DRAFT_CONFLICT',
    });
    await expect(service.createDish({ ...base, displayOrder: -1 })).rejects.toBeInstanceOf(
      TypeError,
    );
  });
});
