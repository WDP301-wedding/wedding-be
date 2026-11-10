import type { BackendConfig } from '../../config/env.js';
import { DiskStorageProvider } from './disk-storage-provider.js';
import { MongoClient } from 'mongodb';
import { GridFsFoodMediaStore } from './gridfs-food-media.store.js';
import { MongoFoodStorageProvider } from './mongo-food-storage-provider.js';
import type { StorageProvider } from './storage-provider.js';

type StorageConfig = Extract<BackendConfig['storage'], { enabled: true }>;
const providers = new WeakMap<
  StorageConfig,
  { provider: DiskStorageProvider; client?: MongoClient }
>();

export function createStorageProvider(config: StorageConfig): StorageProvider {
  return createSignedStorageProvider(config);
}

export function createSignedStorageProvider(config: StorageConfig): DiskStorageProvider {
  const existing = providers.get(config);
  if (existing) return existing.provider;
  if (config.catalogMongo) {
    const client = new MongoClient(config.catalogMongo.uri, {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 3000,
      connectTimeoutMS: 3000,
      socketTimeoutMS: 10000,
      timeoutMS: 15000,
    });
    const provider = new MongoFoodStorageProvider(
      config,
      new GridFsFoodMediaStore(client, config.catalogMongo.database),
    );
    providers.set(config, { provider, client });
    return provider;
  }
  const provider = new DiskStorageProvider(config);
  providers.set(config, { provider });
  return provider;
}

export async function closeStorageProvider(config: StorageConfig): Promise<void> {
  const existing = providers.get(config);
  providers.delete(config);
  await existing?.client?.close();
}

export async function checkStorageProvider(config: StorageConfig): Promise<void> {
  createSignedStorageProvider(config);
  const client = providers.get(config)?.client;
  if (client)
    await client.db(config.catalogMongo!.database).command({ ping: 1 }, { timeoutMS: 2000 });
}
