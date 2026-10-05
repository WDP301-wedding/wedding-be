import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMenuService } from '../../../src/modules/venue-catalog/application/menu.service.js';
import { CatalogTestDatabase, catalogMigrationDatabaseUrl } from './catalog-test-database.js';

const describeWithDatabase = catalogMigrationDatabaseUrl ? describe : describe.skip;

describeWithDatabase('VC-06 dish and menu-package behavior', () => {
  const database = new CatalogTestDatabase('vc06');
  const actorId = randomUUID();

  beforeAll(async () => database.connect(), 60_000);
  afterAll(async () => database.disconnect());

  it('keeps exact dish versions and prices stable through republish, races, and retirement', async () => {
    const prisma = database.prisma;
    const service = createMenuService(prisma);
    const context = { actorId, requestId: randomUUID() };
    const firstDishId = randomUUID();
    const firstDishVersionId = randomUUID();
    const secondDishId = randomUUID();
    const secondDishVersionId = randomUUID();

    await service.createDish({
      dishId: firstDishId,
      versionId: firstDishVersionId,
      displayOrder: 1,
      name: 'Original soup',
      description: '',
      categoryLabel: 'Starter',
      priceVnd: 100_000,
      context,
    });
    await service.publishDish({
      dishId: firstDishId,
      versionId: firstDishVersionId,
      expectedRevision: 1,
      context: { ...context, requestId: randomUUID() },
    });
    await service.createDish({
      dishId: secondDishId,
      versionId: secondDishVersionId,
      displayOrder: 2,
      name: 'Original main',
      description: '',
      categoryLabel: 'Main',
      priceVnd: null,
      context: { ...context, requestId: randomUUID() },
    });
    await service.publishDish({
      dishId: secondDishId,
      versionId: secondDishVersionId,
      expectedRevision: 1,
      context: { ...context, requestId: randomUUID() },
    });

    const menuPackageId = randomUUID();
    const firstMenuVersionId = randomUUID();
    await service.createMenuPackage({
      menuPackageId,
      versionId: firstMenuVersionId,
      displayOrder: 1,
      name: 'Classic package',
      description: '',
      priceVndPerTable: 5_000_000,
      items: [
        { dishVersionId: firstDishVersionId, displayOrder: 1 },
        { dishVersionId: secondDishVersionId, displayOrder: 2 },
      ],
      context: { ...context, requestId: randomUUID() },
    });
    await service.publishMenuPackage({
      menuPackageId,
      versionId: firstMenuVersionId,
      expectedRevision: 1,
      context: { ...context, requestId: randomUUID() },
    });

    const repricedDishVersionId = randomUUID();
    await service.cloneDishVersion({
      dishId: firstDishId,
      sourceVersionId: firstDishVersionId,
      versionId: repricedDishVersionId,
      context: { ...context, requestId: randomUUID() },
    });
    await service.updateDishDraft({
      dishId: firstDishId,
      versionId: repricedDishVersionId,
      expectedRevision: 1,
      name: 'Renamed soup',
      description: '',
      categoryLabel: 'Starter',
      priceVnd: 250_000,
      context: { ...context, requestId: randomUUID() },
    });
    await service.publishDish({
      dishId: firstDishId,
      versionId: repricedDishVersionId,
      expectedRevision: 2,
      context: { ...context, requestId: randomUUID() },
    });

    await expect(service.resolveMenuPackageVersion(firstMenuVersionId)).resolves.toMatchObject({
      priceVndPerTable: 5_000_000,
      items: [
        {
          dishVersionId: firstDishVersionId,
          name: 'Original soup',
          priceVnd: 100_000,
        },
        { dishVersionId: secondDishVersionId, name: 'Original main' },
      ],
    });

    const secondMenuVersionId = randomUUID();
    await service.cloneMenuPackageVersion({
      menuPackageId,
      sourceVersionId: firstMenuVersionId,
      versionId: secondMenuVersionId,
      context: { ...context, requestId: randomUUID() },
    });
    await service.updateMenuPackageDraft({
      menuPackageId,
      versionId: secondMenuVersionId,
      expectedRevision: 1,
      name: 'Classic package',
      description: '',
      priceVndPerTable: 5_500_000,
      items: [
        { dishVersionId: repricedDishVersionId, displayOrder: 1 },
        { dishVersionId: secondDishVersionId, displayOrder: 2 },
      ],
      context: { ...context, requestId: randomUUID() },
    });
    const publishRace = await Promise.allSettled([
      service.publishMenuPackage({
        menuPackageId,
        versionId: secondMenuVersionId,
        expectedRevision: 2,
        context: { ...context, requestId: randomUUID() },
      }),
      service.publishMenuPackage({
        menuPackageId,
        versionId: secondMenuVersionId,
        expectedRevision: 2,
        context: { ...context, requestId: randomUUID() },
      }),
    ]);
    expect(publishRace.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(publishRace.filter(({ status }) => status === 'rejected')).toHaveLength(1);

    const aggregate = await prisma.menuPackage.findUniqueOrThrow({ where: { id: menuPackageId } });
    await service.changeMenuPackageLifecycle({
      aggregateId: menuPackageId,
      expectedRevision: aggregate.revision,
      transition: 'RETIRE',
      context: { ...context, requestId: randomUUID() },
    });
    await expect(service.requireCurrentMenuPackageVersion(menuPackageId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(service.resolveMenuPackageVersion(firstMenuVersionId)).resolves.toMatchObject({
      state: 'SUPERSEDED',
      priceVndPerTable: 5_000_000,
    });
  }, 120_000);
});
