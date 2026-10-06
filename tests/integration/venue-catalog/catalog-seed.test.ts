import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CATALOG_SEED_IDS,
  CatalogSeedConflictError,
  seedVenueCatalog,
} from '../../../scripts/catalog-seed.js';
import { catalogMigrationDatabaseUrl, CatalogTestDatabase } from './catalog-test-database.js';

const describeWithDatabase = catalogMigrationDatabaseUrl ? describe : describe.skip;
const database = new CatalogTestDatabase('catalog_seed');

describeWithDatabase('VC-16 deterministic catalog seed', () => {
  beforeAll(() => database.connect(), 60_000);
  afterAll(() => database.disconnect());

  it('creates the approved fixture once and leaves an identical rerun unchanged', async () => {
    await expect(seedVenueCatalog(database.prisma)).resolves.toBe('CREATED');
    await expect(seedVenueCatalog(database.prisma)).resolves.toBe('ALREADY_PRESENT');

    const [halls, menus, layouts, retired] = await Promise.all([
      database.prisma.hall.count(),
      database.prisma.menuPackage.count(),
      database.prisma.layoutTemplate.count({ where: { hallId: CATALOG_SEED_IDS.lotusHall } }),
      database.prisma.dish.findUniqueOrThrow({ where: { id: CATALOG_SEED_IDS.retiredDish } }),
    ]);
    expect({ halls, menus, layouts }).toEqual({ halls: 2, menus: 2, layouts: 2 });
    expect(retired.lifecycle).toBe('RETIRED');
    await expect(
      database.prisma.dishVersion.findUnique({
        where: { id: CATALOG_SEED_IDS.retiredDishVersion },
      }),
    ).resolves.toMatchObject({ state: 'PUBLISHED', versionNumber: 1 });
  });

  it('refuses to overwrite a Manager-edited stable seed record', async () => {
    await database.prisma.restaurantProfile.update({
      where: { id: CATALOG_SEED_IDS.restaurant },
      data: { displayName: 'Manager Edited', revision: { increment: 1 } },
    });

    await expect(seedVenueCatalog(database.prisma)).rejects.toBeInstanceOf(
      CatalogSeedConflictError,
    );
  });
});
