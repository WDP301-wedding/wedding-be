import { DiskStorageProvider, type DiskStorageOptions } from './disk-storage-provider.js';
import {
  createStorageObjectReference,
  createStoredObject,
  type PutObjectCommand,
  type StorageObjectReference,
  type StoredObject,
} from './storage-provider.js';

export interface FoodMediaObjectStore {
  put(command: PutObjectCommand): Promise<StoredObject>;
  /** Null means genuinely absent; errors must not trigger disk fallback. */
  read(reference: StorageObjectReference): Promise<Uint8Array | null>;
  delete(reference: StorageObjectReference): Promise<void>;
}

/** Inherits signed URL verification and response behavior without exposing MongoDB. */
export class MongoFoodStorageProvider extends DiskStorageProvider {
  constructor(
    options: DiskStorageOptions,
    private readonly mongo: FoodMediaObjectStore,
  ) {
    super(options);
  }

  override async put(command: PutObjectCommand): Promise<StoredObject> {
    createStoredObject(command);
    return command.catalogResourceType ? this.mongo.put(command) : super.put(command);
  }

  override async read(reference: StorageObjectReference): Promise<Uint8Array> {
    const validated = createStorageObjectReference(reference);
    if (validated.purpose === 'VENUE_CATALOG_MEDIA') {
      const bytes = await this.mongo.read(validated);
      if (bytes !== null) return bytes;
    }
    return super.read(validated);
  }

  override async delete(reference: StorageObjectReference): Promise<void> {
    const validated = createStorageObjectReference(reference);
    if (validated.purpose === 'VENUE_CATALOG_MEDIA') await this.mongo.delete(validated);
    await super.delete(validated);
  }
}
