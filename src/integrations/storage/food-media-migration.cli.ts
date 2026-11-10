import { config } from '../../config/config.js';
import { createPrismaClient } from '../../core/database/prisma.js';
import { MongoClient } from 'mongodb';
import { DiskStorageProvider } from './disk-storage-provider.js';
import { GridFsFoodMediaStore } from './gridfs-food-media.store.js';
import {
  migrateFoodMedia,
  type FoodMediaMigrationAsset,
  type FoodMediaMigrationMode,
} from './food-media-migration.js';

const modes = ['copy-to-mongo', 'verify', 'export-to-disk'] as const;
const args = process.argv.slice(2);
const mode = args[0];
if (
  !modes.includes(mode as FoodMediaMigrationMode) ||
  args.slice(1).some((arg) => arg !== '--apply') ||
  args.length > 2
)
  throw new Error('Usage: npm run media:migrate -- copy-to-mongo|verify|export-to-disk [--apply]');
if (!config.storage.enabled || !config.storage.catalogMongo || !config.database.url)
  throw new Error(
    'Configured PostgreSQL, disk storage and CATALOG_MONGO_URI/DATABASE are required.',
  );
const settings = config.storage;
const mongo = new MongoClient(settings.catalogMongo!.uri, {
  serverSelectionTimeoutMS: 3000,
  timeoutMS: 15000,
  maxPoolSize: 2,
});
const prisma = createPrismaClient(config.database.url);
async function* assets(): AsyncGenerator<FoodMediaMigrationAsset> {
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.catalogMediaAsset.findMany({
      where: {
        resourceType: { in: ['DISH_VERSION', 'MENU_PACKAGE_VERSION'] },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: 100,
    });
    if (rows.length === 0) break;
    for (const row of rows)
      yield { ...row, resourceType: row.resourceType as FoodMediaMigrationAsset['resourceType'] };
    cursor = rows.at(-1)!.id;
  }
}
try {
  const summary = await migrateFoodMedia({
    assets: assets(),
    disk: new DiskStorageProvider(settings),
    mongo: new GridFsFoodMediaStore(mongo, settings.catalogMongo!.database),
    mode: mode as FoodMediaMigrationMode,
    apply: args.includes('--apply'),
  });
  console.info(JSON.stringify({ mode, ...summary }));
} catch {
  // Do not log driver errors or connection URIs with embedded credentials.
  console.error(
    'Food media migration failed; no source data was deleted. Check configuration, connectivity and source checksums.',
  );
  process.exitCode = 1;
} finally {
  await Promise.allSettled([prisma.$disconnect(), mongo.close()]);
}
