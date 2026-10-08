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

  it('reuses the complete demo catalog after Manager edits without changing existing data', async () => {
    const profileBefore = await database.prisma.restaurantProfile.findUniqueOrThrow({
      where: { id: CATALOG_SEED_IDS.restaurant },
    });
    const hallBefore = await database.prisma.hall.update({
      where: { id: CATALOG_SEED_IDS.lotusHall },
      data: { name: 'Manager Hall', nameNormalized: 'manager hall', revision: { increment: 1 } },
    });

    await expect(seedVenueCatalog(database.prisma, { preserveExistingEdits: true })).resolves.toBe(
      'ALREADY_PRESENT',
    );
    await expect(
      database.prisma.restaurantProfile.findUniqueOrThrow({
        where: { id: CATALOG_SEED_IDS.restaurant },
      }),
    ).resolves.toEqual(profileBefore);
    await expect(
      database.prisma.hall.findUniqueOrThrow({ where: { id: CATALOG_SEED_IDS.lotusHall } }),
    ).resolves.toEqual(hallBefore);
  });

  it('still rejects a different restaurant identity when preserving demo edits', async () => {
    const otherId = '10000000-0000-4000-8000-000000000099';
    await database.prisma.restaurantProfile.update({
      where: { id: CATALOG_SEED_IDS.restaurant },
      data: { id: otherId },
    });
    try {
      await expect(
        seedVenueCatalog(database.prisma, { preserveExistingEdits: true }),
      ).rejects.toBeInstanceOf(CatalogSeedConflictError);
    } finally {
      await database.prisma.restaurantProfile.update({
        where: { id: otherId },
        data: { id: CATALOG_SEED_IDS.restaurant },
      });
    }
  });

  it('still rejects missing seed records when preserving demo edits', async () => {
    const hall = await database.prisma.hall.delete({ where: { id: CATALOG_SEED_IDS.orchidHall } });
    try {
      await expect(
        seedVenueCatalog(database.prisma, { preserveExistingEdits: true }),
      ).rejects.toBeInstanceOf(CatalogSeedConflictError);
    } finally {
      await database.prisma.hall.create({ data: hall });
    }
  });
});
