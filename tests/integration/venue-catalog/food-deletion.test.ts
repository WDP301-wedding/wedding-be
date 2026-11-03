import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMenuService } from '../../../src/modules/venue-catalog/application/menu.service.js';
import { createCatalogQueryService } from '../../../src/modules/venue-catalog/application/catalog-query.service.js';
import { CatalogTestDatabase, catalogMigrationDatabaseUrl } from './catalog-test-database.js';

const describeWithDatabase = catalogMigrationDatabaseUrl ? describe : describe.skip;
describeWithDatabase('Food catalog soft deletion', () => {
  const database = new CatalogTestDatabase('food_delete');
  beforeAll(async () => database.connect(), 60_000);
  afterAll(async () => database.disconnect());

  it('hides deleted records, rejects stale deletion/restoration/editing, and retains exact menu snapshots', async () => {
    const prisma = database.prisma;
    const service = createMenuService(prisma);
    const queries = createCatalogQueryService(prisma, {
      listSigned: () => Promise.resolve([]),
      listSignedBatch: () => Promise.resolve(new Map()),
      listSignedHallPage: () => Promise.resolve({ items: [], nextCursor: null }),
    });
    const context = { actorId: randomUUID(), requestId: randomUUID() };
    const dishId = randomUUID(),
      versionId = randomUUID();
    await service.createDish({
      dishId,
      versionId,
      displayOrder: 1,
      name: 'Súp nấm',
      description: 'Ăn nóng',
      categoryLabel: 'Khai vị',
      priceVnd: 120000,
      context,
    });
    await service.publishDish({ dishId, versionId, expectedRevision: 1, context });
    const menuPackageId = randomUUID(),
      menuVersionId = randomUUID();
    await service.createMenuPackage({
      menuPackageId,
      versionId: menuVersionId,
      displayOrder: 1,
      name: 'Gói tiệc',
      description: '',
      priceVndPerTable: 3500000,
      items: [{ dishVersionId: versionId, displayOrder: 1 }],
      context,
    });
    await service.publishMenuPackage({
      menuPackageId,
      versionId: menuVersionId,
      expectedRevision: 1,
      context,
    });
    const original = await service.resolveMenuPackageVersion(menuVersionId);
    const dish = await prisma.dish.findUniqueOrThrow({ where: { id: dishId } });
    const draftId = randomUUID();
    await service.cloneDishVersion({
      dishId,
      sourceVersionId: versionId,
      versionId: draftId,
      context,
    });
    const current = await prisma.dish.findUniqueOrThrow({ where: { id: dishId } });
    await expect(
      service.archiveDish({ aggregateId: dishId, expectedRevision: dish.revision - 1, context }),
    ).rejects.toMatchObject({ status: 409 });
    const deletion = await service.archiveDish({
      aggregateId: dishId,
      expectedRevision: current.revision,
      context,
    });
    expect((await queries.listDishes({ limit: 100 })).items).toHaveLength(0);
    expect((await queries.listPublicDishes({ limit: 100 })).items).toHaveLength(0);
    await expect(queries.getDish(dishId)).rejects.toMatchObject({ status: 404 });
    await expect(
      service.changeDishLifecycle({
        aggregateId: dishId,
        expectedRevision: deletion.revision,
        transition: 'RESTORE',
        context,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.updateDishDraft({
        dishId,
        versionId: draftId,
        expectedRevision: 1,
        name: 'Changed',
        description: '',
        categoryLabel: 'Khai vị',
        priceVnd: null,
        context,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.publishDish({ dishId, versionId: draftId, expectedRevision: 1, context }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(service.requireCurrentDishVersion(dishId)).rejects.toMatchObject({ status: 404 });
    expect(await service.resolveMenuPackageVersion(menuVersionId)).toEqual(original);
    const menu = await prisma.menuPackage.findUniqueOrThrow({ where: { id: menuPackageId } });
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        service.archiveMenuPackage({
          aggregateId: menuPackageId,
          expectedRevision: menu.revision,
          context,
        }),
      ),
    );
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect((await queries.listMenuPackages({ limit: 100 })).items).toHaveLength(0);
    expect((await queries.listPublicMenuPackages({ limit: 100 })).items).toHaveLength(0);
    expect(await service.resolveMenuPackageVersion(menuVersionId)).toEqual(original);
    expect(await prisma.auditLog.count({ where: { action: 'catalog.archived' } })).toBe(2);
  });
});
