import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { NotFoundError } from '../../../core/errors/app-error.js';

import { createCatalogQueryService } from './catalog-query.service.js';

describe('CatalogQueryService', () => {
  it('serializes public dish prices as integer VND and omits revisions and actor data', async () => {
    const dishId = randomUUID();
    const versionId = randomUUID();
    const prisma = {
      dish: {
        findMany: vi.fn((query: unknown) => {
          void query;
          return Promise.resolve([
            {
              id: dishId,
              currentPublishedVersion: {
                id: versionId,
                versionNumber: 2,
                revision: 9,
                name: 'Gỏi ngó sen',
                description: 'Khai vị',
                categoryLabel: 'APPETIZER',
                priceVnd: { toNumber: () => 120_000 },
                createdByAccountId: randomUUID(),
              },
            },
          ]);
        }),
      },
    };
    const media = {
      listSigned: vi.fn(() => Promise.resolve([])),
      listSignedBatch: vi.fn(() => Promise.resolve(new Map())),
    };
    const service = createCatalogQueryService(prisma as never, media);

    const page = await service.listPublicDishes({ limit: 20 });
    await service.listPublicDishes({
      limit: 20,
      cursor: randomUUID(),
      categoryLabel: 'APPETIZER',
      search: 'sen',
    });

    expect(page.items).toEqual([
      {
        id: dishId,
        versionId,
        versionNumber: 2,
        name: 'Gỏi ngó sen',
        description: 'Khai vị',
        categoryLabel: 'APPETIZER',
        priceVnd: 120_000,
        media: [],
      },
    ]);
    expect(JSON.stringify(page)).not.toMatch(/revision|createdBy|actor|objectKey/u);
  });

  it('resolves a version owner without accepting a caller-supplied aggregate identity', async () => {
    const dishId = randomUUID();
    const versionId = randomUUID();
    const prisma = {
      dishVersion: { findUnique: vi.fn(() => Promise.resolve({ dishId })) },
    };
    const service = createCatalogQueryService(prisma as never, {} as never);

    await expect(service.findAggregateIdForVersion('DISH', versionId)).resolves.toBe(dishId);
    expect(prisma.dishVersion.findUnique).toHaveBeenCalledWith({
      where: { id: versionId },
      select: { dishId: true },
    });
  });

  it('serializes every Manager aggregate view and cursor page', async () => {
    const aggregateId = randomUUID();
    const versionId = randomUUID();
    const tableId = randomUUID();
    const now = new Date('2026-10-05T00:00:00.000Z');
    const version = {
      id: versionId,
      versionNumber: 1,
      revision: 2,
      state: 'PUBLISHED',
      name: 'Published catalog record',
      description: 'Description',
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    const aggregate = {
      id: aggregateId,
      lifecycle: 'ACTIVE',
      displayOrder: 1,
      revision: 3,
      retiredAt: null,
      currentPublishedVersionId: versionId,
      draftVersionId: null,
    };
    const dish = {
      ...aggregate,
      versions: [{ ...version, categoryLabel: 'MAIN', priceVnd: 250_000 }],
    };
    const menu = {
      ...aggregate,
      versions: [
        {
          ...version,
          priceVndPerTable: { toNumber: () => 4_000_000 },
          items: [
            {
              displayOrder: 1,
              dishVersion: {
                id: randomUUID(),
                dishId: randomUUID(),
                versionNumber: 2,
                name: 'Dish',
                description: 'Dish description',
                categoryLabel: 'MAIN',
                priceVnd: null,
              },
            },
          ],
        },
      ],
    };
    const timeline = {
      ...aggregate,
      versions: [{ ...version, items: [{ id: randomUUID(), displayOrder: 1 }] }],
    };
    const layout = {
      ...aggregate,
      hallId: randomUUID(),
      tableIdentities: [{ id: tableId, retiredAt: now }],
      versions: [
        {
          ...version,
          minGuests: 1,
          maxGuests: 10,
          geometry: [{ tableId, seatCapacity: 10, displayOrder: 1 }],
        },
      ],
    };
    const prisma = {
      dish: {
        findMany: vi.fn(() => Promise.resolve([dish, { ...dish, id: randomUUID() }])),
        findUnique: vi.fn(() => Promise.resolve(dish)),
      },
      menuPackage: {
        findMany: vi.fn(() => Promise.resolve([menu, { ...menu, id: randomUUID() }])),
        findUnique: vi.fn(() => Promise.resolve(menu)),
      },
      timelineTemplate: {
        findMany: vi.fn(() => Promise.resolve([timeline, { ...timeline, id: randomUUID() }])),
        findUnique: vi.fn(() => Promise.resolve(timeline)),
      },
      layoutTemplate: {
        findMany: vi.fn(() => Promise.resolve([layout, { ...layout, id: randomUUID() }])),
        findUnique: vi.fn(() => Promise.resolve(layout)),
      },
    };
    const service = createCatalogQueryService(prisma as never, {} as never);

    const [
      dishes,
      dishDetail,
      menus,
      menuDetail,
      timelines,
      timelineDetail,
      layouts,
      layoutDetail,
    ] = await Promise.all([
      service.listDishes({ limit: 1, cursor: randomUUID() }),
      service.getDish(aggregateId),
      service.listMenuPackages({ limit: 1 }),
      service.getMenuPackage(aggregateId),
      service.listTimelineTemplates({ limit: 1, cursor: randomUUID() }),
      service.getTimelineTemplate(aggregateId),
      service.listLayoutTemplates({ limit: 1 }),
      service.getLayoutTemplate(aggregateId),
    ]);

    expect(dishes).toMatchObject({
      nextCursor: aggregateId,
      items: [{ versions: [{ priceVnd: 250_000 }] }],
    });
    expect(dishDetail).toMatchObject({ id: aggregateId, retiredAt: null });
    expect(menus).toMatchObject({
      nextCursor: aggregateId,
      items: [{ versions: [{ priceVndPerTable: 4_000_000 }] }],
    });
    expect(menuDetail).toMatchObject({ id: aggregateId });
    expect(timelines).toMatchObject({ nextCursor: aggregateId, items: [{ id: aggregateId }] });
    expect(timelineDetail).toMatchObject({ id: aggregateId });
    expect(layouts).toMatchObject({
      nextCursor: aggregateId,
      items: [{ versions: [{ totalSeatCapacity: 10 }] }],
    });
    expect(layoutDetail).toMatchObject({
      id: aggregateId,
      tables: [{ id: tableId, retiredAt: now.toISOString() }],
    });
    await Promise.all([
      service.listDishes({ limit: 1 }),
      service.listMenuPackages({ limit: 1, cursor: randomUUID() }),
      service.listTimelineTemplates({ limit: 1 }),
      service.listLayoutTemplates({ limit: 1, cursor: randomUUID() }),
    ]);
  });

  it('serializes public menu packages and applies public pagination inputs', async () => {
    const aggregateId = randomUUID();
    const versionId = randomUUID();
    const nextId = randomUUID();
    const prisma = {
      menuPackage: {
        findMany: vi.fn((query: unknown) => {
          void query;
          return Promise.resolve([
            {
              id: aggregateId,
              currentPublishedVersion: {
                id: versionId,
                versionNumber: 1,
                name: 'Classic',
                description: 'Menu',
                priceVndPerTable: 3_500_000,
                items: [
                  {
                    displayOrder: 1,
                    dishVersion: {
                      id: randomUUID(),
                      dishId: randomUUID(),
                      versionNumber: 3,
                      name: 'Dish',
                      description: 'Dish',
                      categoryLabel: 'MAIN',
                      priceVnd: { toNumber: () => 200_000 },
                    },
                  },
                ],
              },
            },
            { id: nextId, currentPublishedVersion: null },
          ]);
        }),
      },
    };
    const media = {
      listSigned: vi.fn(),
      listSignedBatch: vi.fn(() => Promise.resolve(new Map([[versionId, [{ url: 'signed' }]]]))),
    };
    const service = createCatalogQueryService(prisma as never, media as never);

    const page = await service.listPublicMenuPackages({ limit: 1, cursor: randomUUID() });

    expect(page).toMatchObject({
      nextCursor: aggregateId,
      items: [{ id: aggregateId, priceVndPerTable: 3_500_000, media: [{ url: 'signed' }] }],
    });
    expect(prisma.menuPackage.findMany.mock.calls[0]?.[0]).toMatchObject({ skip: 1, take: 2 });
    await service.listPublicMenuPackages({ limit: 1 });
  });

  it('resolves every version kind and rejects missing owners and unsafe money', async () => {
    const owners = {
      dishId: randomUUID(),
      menuPackageId: randomUUID(),
      timelineTemplateId: randomUUID(),
      layoutTemplateId: randomUUID(),
    };
    const prisma = {
      dishVersion: { findUnique: vi.fn(() => Promise.resolve({ dishId: owners.dishId })) },
      menuPackageVersion: {
        findUnique: vi.fn(() => Promise.resolve({ menuPackageId: owners.menuPackageId })),
      },
      timelineTemplateVersion: {
        findUnique: vi.fn(() => Promise.resolve({ timelineTemplateId: owners.timelineTemplateId })),
      },
      layoutTemplateVersion: {
        findUnique: vi.fn(() => Promise.resolve({ layoutTemplateId: owners.layoutTemplateId })),
      },
    };
    const service = createCatalogQueryService(prisma as never, {} as never);

    await expect(service.findAggregateIdForVersion('MENU_PACKAGE', randomUUID())).resolves.toBe(
      owners.menuPackageId,
    );
    await expect(
      service.findAggregateIdForVersion('TIMELINE_TEMPLATE', randomUUID()),
    ).resolves.toBe(owners.timelineTemplateId);
    await expect(service.findAggregateIdForVersion('LAYOUT_TEMPLATE', randomUUID())).resolves.toBe(
      owners.layoutTemplateId,
    );
    prisma.dishVersion.findUnique.mockResolvedValueOnce(null as never);
    await expect(service.findAggregateIdForVersion('DISH', randomUUID())).rejects.toBeInstanceOf(
      NotFoundError,
    );
    prisma.menuPackageVersion.findUnique.mockResolvedValueOnce(null as never);
    prisma.timelineTemplateVersion.findUnique.mockResolvedValueOnce(null as never);
    prisma.layoutTemplateVersion.findUnique.mockResolvedValueOnce(null as never);
    await expect(
      service.findAggregateIdForVersion('MENU_PACKAGE', randomUUID()),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      service.findAggregateIdForVersion('TIMELINE_TEMPLATE', randomUUID()),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      service.findAggregateIdForVersion('LAYOUT_TEMPLATE', randomUUID()),
    ).rejects.toBeInstanceOf(NotFoundError);

    const unsafe = createCatalogQueryService(
      {
        dish: {
          findMany: vi.fn(() =>
            Promise.resolve([
              {
                id: randomUUID(),
                currentPublishedVersion: {
                  id: randomUUID(),
                  versionNumber: 1,
                  name: 'Unsafe',
                  description: '',
                  categoryLabel: 'MAIN',
                  priceVnd: Number.MAX_SAFE_INTEGER + 1,
                },
              },
            ]),
          ),
        },
      } as never,
      { listSigned: vi.fn(), listSignedBatch: vi.fn(() => Promise.resolve(new Map())) },
    );
    await expect(unsafe.listPublicDishes({ limit: 1 })).rejects.toBeInstanceOf(RangeError);
  });

  it('returns stable not-found errors for missing details and invalid published pointers', async () => {
    const prisma = {
      dish: {
        findUnique: vi.fn(() => Promise.resolve(null)),
        findMany: vi.fn(() =>
          Promise.resolve([{ id: randomUUID(), currentPublishedVersion: null }]),
        ),
      },
      menuPackage: {
        findUnique: vi.fn(() => Promise.resolve(null)),
        findMany: vi.fn(() =>
          Promise.resolve([{ id: randomUUID(), currentPublishedVersion: null }]),
        ),
      },
      timelineTemplate: { findUnique: vi.fn(() => Promise.resolve(null)) },
      layoutTemplate: { findUnique: vi.fn(() => Promise.resolve(null)) },
    };
    const service = createCatalogQueryService(prisma as never, {
      listSigned: vi.fn(),
      listSignedBatch: vi.fn(() => Promise.resolve(new Map())),
    });

    await expect(service.getDish(randomUUID())).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.getMenuPackage(randomUUID())).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.getTimelineTemplate(randomUUID())).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.getLayoutTemplate(randomUUID())).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.listPublicDishes({ limit: 1 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.listPublicMenuPackages({ limit: 1 })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
