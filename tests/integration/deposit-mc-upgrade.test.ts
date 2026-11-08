import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../src/core/database/prisma.js';
import { seedVenueCatalog, CATALOG_SEED_IDS } from '../../scripts/catalog-seed.js';
import { createRestaurantServiceService } from '../../src/modules/venue-catalog/application/restaurant-service.service.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)('duplicate MC forward archive', () => {
  const db = new CatalogTestDatabase('mc_upgrade');
  let duplicateId: string, revisionId: string, retainedId: string;
  beforeAll(
    () =>
      db.connect(async (migration, url) => {
        if (migration !== '20261108041000_archive_duplicate_mc_service') return;
        const prisma = createPrismaClient(url);
        try {
          await seedVenueCatalog(prisma);
          const services = createRestaurantServiceService(prisma);
          const fields = {
            description: 'Lịch sử phải giữ',
            unit: 'buổi',
            unitPriceVnd: 2000000,
            active: true,
          };
          const duplicate = await services.create(
            { ...fields, name: 'Dịch vụ MC' },
            { actorId: CATALOG_SEED_IDS.actor, requestId: randomUUID() },
          );
          const retained = await services.create(
            { ...fields, name: 'MC tiệc cưới' },
            { actorId: CATALOG_SEED_IDS.actor, requestId: randomUUID() },
          );
          duplicateId = duplicate.serviceId;
          revisionId = duplicate.sourceRevisionId;
          retainedId = retained.serviceId;
        } finally {
          await prisma.$disconnect();
        }
      }),
    60000,
  );
  afterAll(() => db.disconnect());
  it('archives only the duplicate using a new revision and system audit', async () => {
    const prisma = db.prisma;
    expect(
      await prisma.restaurantService.findUniqueOrThrow({ where: { id: duplicateId } }),
    ).toMatchObject({ active: false, revision: 2 });
    expect(
      await prisma.restaurantServiceRevision.findUniqueOrThrow({ where: { id: revisionId } }),
    ).toMatchObject({ active: true, revision: 1, name: 'Dịch vụ MC' });
    expect(
      await prisma.restaurantService.findUniqueOrThrow({ where: { id: retainedId } }),
    ).toMatchObject({ active: true, revision: 1 });
    expect(
      await prisma.auditLog.count({
        where: { entityId: duplicateId, action: 'venue.service-archived', actorType: 'SYSTEM' },
      }),
    ).toBe(1);
    expect(
      (await createRestaurantServiceService(prisma).list()).items.map((item) => item.name),
    ).toEqual(['MC tiệc cưới']);
  });
});
