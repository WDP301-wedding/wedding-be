import { NotFoundError, ProviderError } from '../../core/errors/app-error.js';
import { storageContentTypeSchema } from './storage.schemas.js';
import {
  createStoredObject,
  createStorageObjectReference,
  type StorageProvider,
} from './storage-provider.js';
import type { FoodMediaObjectStore } from './mongo-food-storage-provider.js';

export interface FoodMediaMigrationAsset {
  readonly resourceType: 'DISH_VERSION' | 'MENU_PACKAGE_VERSION';
  readonly resourceId: string;
  readonly objectKey: string;
  readonly checksumSha256: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly detachedAt: Date | null;
}
export type FoodMediaMigrationMode = 'copy-to-mongo' | 'verify' | 'export-to-disk';

/** No relational writes, source deletes or automatic backend switches. */
export async function migrateFoodMedia(input: {
  assets: AsyncIterable<FoodMediaMigrationAsset>;
  disk: StorageProvider;
  mongo: FoodMediaObjectStore;
  mode: FoodMediaMigrationMode;
  apply: boolean;
}) {
  const summary = {
    examined: 0,
    verified: 0,
    written: 0,
    missingDetached: 0,
    dryRun: !input.apply,
  };
  for await (const asset of input.assets) {
    summary.examined++;
    const reference = createStorageObjectReference({ ...asset, purpose: 'VENUE_CATALOG_MEDIA' });
    let bytes: Uint8Array | null;
    try {
      bytes =
        input.mode === 'copy-to-mongo'
          ? await input.disk.read!(reference)
          : await input.mongo.read(reference);
      if (bytes === null) throw new NotFoundError();
    } catch (error) {
      if (error instanceof NotFoundError && asset.detachedAt !== null) {
        summary.missingDetached++;
        continue;
      }
      throw error;
    }
    const command = {
      bytes,
      contentType: storageContentTypeSchema.parse(asset.contentType),
      resourceId: asset.resourceId,
      purpose: 'VENUE_CATALOG_MEDIA' as const,
      catalogResourceType: asset.resourceType,
    };
    const expected = createStoredObject(command);
    if (
      expected.objectKey !== asset.objectKey ||
      expected.checksumSha256 !== asset.checksumSha256 ||
      expected.sizeBytes !== asset.sizeBytes
    )
      throw new ProviderError('failure');
    if (input.apply && input.mode !== 'verify') {
      const destination = input.mode === 'copy-to-mongo' ? input.mongo : input.disk;
      await destination.put(command);
      const restored = await destination.read!(reference);
      if (restored === null || !Buffer.from(restored).equals(Buffer.from(bytes)))
        throw new ProviderError('failure');
      summary.written++;
    }
    summary.verified++;
  }
  return summary;
}
