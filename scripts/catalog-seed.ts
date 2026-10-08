import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { config } from '../src/config/config.js';
import { createPrismaClient } from '../src/core/database/prisma.js';
import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';

export const CATALOG_SEED_IDS = Object.freeze({
  actor: '10000000-0000-4000-8000-000000000001',
  restaurant: '10000000-0000-4000-8000-000000000002',
  lotusHall: '10000000-0000-4000-8000-000000000010',
  orchidHall: '10000000-0000-4000-8000-000000000011',
  appetizerDish: '10000000-0000-4000-8000-000000000020',
  appetizerDishVersion: '10000000-0000-4000-8000-000000000021',
  mainDish: '10000000-0000-4000-8000-000000000022',
  mainDishVersion: '10000000-0000-4000-8000-000000000023',
  dessertDish: '10000000-0000-4000-8000-000000000024',
  dessertDishVersion: '10000000-0000-4000-8000-000000000025',
  retiredDish: '10000000-0000-4000-8000-000000000026',
  retiredDishVersion: '10000000-0000-4000-8000-000000000027',
  classicMenu: '10000000-0000-4000-8000-000000000030',
  classicMenuVersion: '10000000-0000-4000-8000-000000000031',
  premiumMenu: '10000000-0000-4000-8000-000000000032',
  premiumMenuVersion: '10000000-0000-4000-8000-000000000033',
  timeline: '10000000-0000-4000-8000-000000000040',
  timelineVersion: '10000000-0000-4000-8000-000000000041',
  timelineWelcome: '10000000-0000-4000-8000-000000000042',
  timelineCeremony: '10000000-0000-4000-8000-000000000043',
  compactLayout: '10000000-0000-4000-8000-000000000050',
  compactLayoutVersion: '10000000-0000-4000-8000-000000000051',
  compactTableOne: '10000000-0000-4000-8000-000000000052',
  compactTableTwo: '10000000-0000-4000-8000-000000000053',
  grandLayout: '10000000-0000-4000-8000-000000000054',
  grandLayoutVersion: '10000000-0000-4000-8000-000000000055',
  grandTableOne: '10000000-0000-4000-8000-000000000056',
  grandTableTwo: '10000000-0000-4000-8000-000000000057',
  grandTableThree: '10000000-0000-4000-8000-000000000058',
});

export class CatalogSeedConflictError extends Error {
  override readonly name = 'CatalogSeedConflictError';

  constructor(cause?: unknown) {
    super('The deterministic catalog seed conflicts with existing or Manager-edited records.', {
      cause,
    });
  }
}

export async function seedVenueCatalog(
  prisma: PrismaClient,
  options: { readonly preserveExistingEdits?: boolean } = {},
): Promise<'CREATED' | 'ALREADY_PRESENT'> {
  const existing = await prisma.restaurantProfile.findUnique({
    where: { singletonKey: 'RESTAURANT' },
  });
  if (existing !== null) {
    if (
      existing.id !== CATALOG_SEED_IDS.restaurant ||
      (!options.preserveExistingEdits &&
        (existing.displayName !== 'Wedding Estate Demo' || existing.revision !== 1))
    ) {
      throw new CatalogSeedConflictError();
    }
    await verifyCompleteSeed(prisma);
    return 'ALREADY_PRESENT';
  }

  try {
    await prisma.$transaction(async (transaction) => createSeed(transaction), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new CatalogSeedConflictError(error);
    }
    throw error;
  }
  return 'CREATED';
}

async function verifyCompleteSeed(prisma: PrismaClient): Promise<void> {
  const [halls, dishes, menus, timelines, layouts] = await Promise.all([
    prisma.hall.count({
      where: { id: { in: [CATALOG_SEED_IDS.lotusHall, CATALOG_SEED_IDS.orchidHall] } },
    }),
    prisma.dish.count({
      where: {
        id: {
          in: [
            CATALOG_SEED_IDS.appetizerDish,
            CATALOG_SEED_IDS.mainDish,
            CATALOG_SEED_IDS.dessertDish,
            CATALOG_SEED_IDS.retiredDish,
          ],
        },
      },
    }),
    prisma.menuPackage.count({
      where: { id: { in: [CATALOG_SEED_IDS.classicMenu, CATALOG_SEED_IDS.premiumMenu] } },
    }),
    prisma.timelineTemplate.count({ where: { id: CATALOG_SEED_IDS.timeline } }),
    prisma.layoutTemplate.count({
      where: { id: { in: [CATALOG_SEED_IDS.compactLayout, CATALOG_SEED_IDS.grandLayout] } },
    }),
  ]);
  if (halls !== 2 || dishes !== 4 || menus !== 2 || timelines !== 1 || layouts !== 2) {
    throw new CatalogSeedConflictError();
  }
}

async function createSeed(transaction: Prisma.TransactionClient): Promise<void> {
  const ids = CATALOG_SEED_IDS;
  const now = new Date('2026-10-05T00:00:00.000Z');
  await transaction.restaurantProfile.create({
    data: {
      id: ids.restaurant,
      displayName: 'Wedding Estate Demo',
      description: 'Deterministic development and demonstration catalog.',
      address: 'Ho Chi Minh City, Vietnam',
      publicPhone: '+84 28 0000 0000',
      publicEmail: 'hello@example.invalid',
      updatedByAccountId: ids.actor,
    },
  });
  await transaction.restaurantShift.createMany({
    data: [
      {
        code: 'LUNCH',
        startTime: new Date('1970-01-01T10:00:00.000Z'),
        endTime: new Date('1970-01-01T14:00:00.000Z'),
        updatedByAccountId: ids.actor,
      },
      {
        code: 'DINNER',
        startTime: new Date('1970-01-01T17:00:00.000Z'),
        endTime: new Date('1970-01-01T22:00:00.000Z'),
        updatedByAccountId: ids.actor,
      },
    ],
  });
  await transaction.hall.createMany({
    data: [
      {
        id: ids.lotusHall,
        name: 'Lotus Hall',
        nameNormalized: 'lotus hall',
        description: 'Flexible main celebration hall.',
        maxGuests: 300,
        displayOrder: 1,
        updatedByAccountId: ids.actor,
      },
      {
        id: ids.orchidHall,
        name: 'Orchid Hall',
        nameNormalized: 'orchid hall',
        description: 'Intimate wedding hall.',
        maxGuests: 120,
        displayOrder: 2,
        updatedByAccountId: ids.actor,
      },
    ],
  });

  await createPublishedDish(
    transaction,
    ids.appetizerDish,
    ids.appetizerDishVersion,
    1,
    'Lotus Salad',
    'APPETIZER',
    120_000,
    ids.actor,
    now,
  );
  await createPublishedDish(
    transaction,
    ids.mainDish,
    ids.mainDishVersion,
    2,
    'Roasted Chicken',
    'MAIN',
    280_000,
    ids.actor,
    now,
  );
  await createPublishedDish(
    transaction,
    ids.dessertDish,
    ids.dessertDishVersion,
    3,
    'Coconut Panna Cotta',
    'DESSERT',
    90_000,
    ids.actor,
    now,
  );
  await createPublishedDish(
    transaction,
    ids.retiredDish,
    ids.retiredDishVersion,
    4,
    'Archived Seasonal Soup',
    'APPETIZER',
    100_000,
    ids.actor,
    now,
    true,
  );

  await createPublishedMenu(
    transaction,
    ids.classicMenu,
    ids.classicMenuVersion,
    1,
    'Classic Celebration',
    3_500_000,
    [ids.appetizerDishVersion, ids.mainDishVersion],
    ids.actor,
    now,
  );
  await createPublishedMenu(
    transaction,
    ids.premiumMenu,
    ids.premiumMenuVersion,
    2,
    'Premium Celebration',
    4_500_000,
    [ids.appetizerDishVersion, ids.mainDishVersion, ids.dessertDishVersion],
    ids.actor,
    now,
  );

  await transaction.timelineTemplate.create({
    data: {
      id: ids.timeline,
      displayOrder: 1,
      createdByAccountId: ids.actor,
      updatedByAccountId: ids.actor,
    },
  });
  await transaction.timelineTemplateVersion.create({
    data: {
      id: ids.timelineVersion,
      timelineTemplateId: ids.timeline,
      name: 'Wedding Reception',
      description: 'A reusable reception timeline.',
      createdByAccountId: ids.actor,
    },
  });
  await transaction.timelineTemplate.update({
    where: { id: ids.timeline },
    data: { draftVersionId: ids.timelineVersion },
  });
  await flushDeferredConstraints(transaction);
  await transaction.timelineTemplateItem.createMany({
    data: [
      {
        id: ids.timelineWelcome,
        timelineTemplateVersionId: ids.timelineVersion,
        title: 'Guest welcome',
        description: null,
        offsetMinutes: 0,
        durationMinutes: 30,
        displayOrder: 1,
      },
      {
        id: ids.timelineCeremony,
        timelineTemplateVersionId: ids.timelineVersion,
        title: 'Ceremony',
        description: null,
        offsetMinutes: 30,
        durationMinutes: 45,
        displayOrder: 2,
      },
    ],
  });
  await transaction.timelineTemplate.update({
    where: { id: ids.timeline },
    data: { currentPublishedVersionId: ids.timelineVersion, draftVersionId: null },
  });
  await transaction.timelineTemplateVersion.update({
    where: { id: ids.timelineVersion },
    data: { versionNumber: 1, state: 'PUBLISHED', publishedAt: now },
  });

  await createPublishedLayout(transaction, {
    templateId: ids.compactLayout,
    versionId: ids.compactLayoutVersion,
    hallId: ids.lotusHall,
    displayOrder: 1,
    name: 'Lotus Compact',
    minGuests: 80,
    maxGuests: 120,
    tables: [
      { id: ids.compactTableOne, label: 'C1', seats: 60, x: 500, y: 500 },
      { id: ids.compactTableTwo, label: 'C2', seats: 60, x: 2500, y: 500 },
    ],
    actorId: ids.actor,
    now,
  });
  await createPublishedLayout(transaction, {
    templateId: ids.grandLayout,
    versionId: ids.grandLayoutVersion,
    hallId: ids.lotusHall,
    displayOrder: 2,
    name: 'Lotus Grand',
    minGuests: 150,
    maxGuests: 240,
    tables: [
      { id: ids.grandTableOne, label: 'G1', seats: 80, x: 500, y: 2500 },
      { id: ids.grandTableTwo, label: 'G2', seats: 80, x: 2500, y: 2500 },
      { id: ids.grandTableThree, label: 'G3', seats: 80, x: 4500, y: 2500 },
    ],
    actorId: ids.actor,
    now,
  });
}

async function createPublishedDish(
  transaction: Prisma.TransactionClient,
  dishId: string,
  versionId: string,
  displayOrder: number,
  name: string,
  categoryLabel: string,
  priceVnd: number,
  actorId: string,
  now: Date,
  retired = false,
): Promise<void> {
  await transaction.dish.create({
    data: {
      id: dishId,
      lifecycle: retired ? 'RETIRED' : 'ACTIVE',
      displayOrder,
      retiredAt: retired ? now : null,
      createdByAccountId: actorId,
      updatedByAccountId: actorId,
    },
  });
  await transaction.dishVersion.create({
    data: {
      id: versionId,
      dishId,
      versionNumber: 1,
      state: 'PUBLISHED',
      name,
      description: `${name} demo dish.`,
      categoryLabel,
      priceVnd,
      createdByAccountId: actorId,
      publishedAt: now,
    },
  });
  await transaction.dish.update({
    where: { id: dishId },
    data: { currentPublishedVersionId: versionId },
  });
}

async function createPublishedMenu(
  transaction: Prisma.TransactionClient,
  menuPackageId: string,
  versionId: string,
  displayOrder: number,
  name: string,
  priceVndPerTable: number,
  dishVersionIds: readonly string[],
  actorId: string,
  now: Date,
): Promise<void> {
  await transaction.menuPackage.create({
    data: {
      id: menuPackageId,
      displayOrder,
      createdByAccountId: actorId,
      updatedByAccountId: actorId,
    },
  });
  await transaction.menuPackageVersion.create({
    data: {
      id: versionId,
      menuPackageId,
      name,
      description: `${name} demo menu.`,
      priceVndPerTable,
      createdByAccountId: actorId,
    },
  });
  await transaction.menuPackage.update({
    where: { id: menuPackageId },
    data: { draftVersionId: versionId },
  });
  await flushDeferredConstraints(transaction);
  await transaction.menuPackageItem.createMany({
    data: dishVersionIds.map((dishVersionId, index) => ({
      menuPackageVersionId: versionId,
      dishVersionId,
      displayOrder: index + 1,
    })),
  });
  await transaction.menuPackage.update({
    where: { id: menuPackageId },
    data: { currentPublishedVersionId: versionId, draftVersionId: null },
  });
  await transaction.menuPackageVersion.update({
    where: { id: versionId },
    data: { versionNumber: 1, state: 'PUBLISHED', publishedAt: now },
  });
}

interface SeedLayoutInput {
  readonly templateId: string;
  readonly versionId: string;
  readonly hallId: string;
  readonly displayOrder: number;
  readonly name: string;
  readonly minGuests: number;
  readonly maxGuests: number;
  readonly tables: readonly {
    readonly id: string;
    readonly label: string;
    readonly seats: number;
    readonly x: number;
    readonly y: number;
  }[];
  readonly actorId: string;
  readonly now: Date;
}

async function createPublishedLayout(
  transaction: Prisma.TransactionClient,
  input: SeedLayoutInput,
): Promise<void> {
  await transaction.layoutTemplate.create({
    data: {
      id: input.templateId,
      hallId: input.hallId,
      displayOrder: input.displayOrder,
      createdByAccountId: input.actorId,
      updatedByAccountId: input.actorId,
    },
  });
  await transaction.layoutTemplateVersion.create({
    data: {
      id: input.versionId,
      layoutTemplateId: input.templateId,
      name: input.name,
      description: `${input.name} fixed geometry.`,
      minGuests: input.minGuests,
      maxGuests: input.maxGuests,
      createdByAccountId: input.actorId,
    },
  });
  await transaction.layoutTemplate.update({
    where: { id: input.templateId },
    data: { draftVersionId: input.versionId },
  });
  await flushDeferredConstraints(transaction);
  await transaction.layoutTableIdentity.createMany({
    data: input.tables.map((table) => ({
      id: table.id,
      layoutTemplateId: input.templateId,
      createdByAccountId: input.actorId,
    })),
  });
  await transaction.layoutTableGeometry.createMany({
    data: input.tables.map((table, index) => ({
      layoutTemplateVersionId: input.versionId,
      layoutTemplateId: input.templateId,
      tableId: table.id,
      label: table.label,
      shape: 'ROUND',
      seatCapacity: table.seats,
      x: table.x,
      y: table.y,
      width: 1000,
      height: 1000,
      rotationDegrees: 0,
      displayOrder: index + 1,
    })),
  });
  await transaction.layoutTemplate.update({
    where: { id: input.templateId },
    data: { currentPublishedVersionId: input.versionId, draftVersionId: null },
  });
  await transaction.layoutTemplateVersion.update({
    where: { id: input.versionId },
    data: { versionNumber: 1, state: 'PUBLISHED', publishedAt: input.now },
  });
}

async function flushDeferredConstraints(transaction: Prisma.TransactionClient): Promise<void> {
  await transaction.$executeRaw(Prisma.sql`SET CONSTRAINTS ALL IMMEDIATE`);
  await transaction.$executeRaw(Prisma.sql`SET CONSTRAINTS ALL DEFERRED`);
}

async function run(): Promise<void> {
  if (config.runtime.environment === 'production') {
    throw new Error('The catalog seed command is disabled in production.');
  }
  const prisma = createPrismaClient(config.database.url);
  try {
    await prisma.$connect();
    const result = await seedVenueCatalog(prisma);
    process.stdout.write(`Catalog seed: ${result}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  void run();
}
