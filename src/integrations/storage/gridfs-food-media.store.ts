import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { GridFSBucket, MongoServerError, type MongoClient, type GridFSFile } from 'mongodb';

import { ProviderError, ValidationError } from '../../core/errors/app-error.js';
import type { FoodMediaObjectStore } from './mongo-food-storage-provider.js';
import { MAX_STORAGE_OBJECT_BYTES } from './storage.schemas.js';
import {
  createStoredObject,
  createStorageObjectReference,
  type PutObjectCommand,
  type StorageObjectReference,
  type StoredObject,
} from './storage-provider.js';

export const FOOD_MEDIA_BUCKET = 'food_images';

/** Immutable content-addressed GridFS objects; works with standalone MongoDB. */
export class GridFsFoodMediaStore implements FoodMediaObjectStore {
  private readonly bucket: GridFSBucket;
  private initialized: Promise<void> | undefined;

  constructor(
    readonly client: MongoClient,
    readonly databaseName: string,
  ) {
    this.bucket = new GridFSBucket(client.db(databaseName), { bucketName: FOOD_MEDIA_BUCKET });
  }

  async initialize(): Promise<void> {
    this.initialized ??= this.client
      .db(this.databaseName)
      .collection(`${FOOD_MEDIA_BUCKET}.files`)
      .createIndex({ filename: 1 }, { unique: true, name: 'food_media_content_key' })
      .then(() => undefined)
      .catch(() => {
        this.initialized = undefined;
        throw new ProviderError('unavailable');
      });
    return this.initialized;
  }

  async put(command: PutObjectCommand): Promise<StoredObject> {
    const object = createStoredObject(command);
    if (!command.catalogResourceType || command.purpose !== 'VENUE_CATALOG_MEDIA')
      throw new TypeError('Only food catalog images may be stored in this bucket.');
    await this.initialize();
    try {
      if ((await this.read(object)) !== null) return object;
      const upload = this.bucket.openUploadStream(object.objectKey, {
        metadata: { ...object, resourceType: command.catalogResourceType, schemaVersion: 1 },
      });
      try {
        await pipeline(Readable.from([command.bytes]), upload);
      } catch (error) {
        // Remove only this failed upload's chunks; never a competing successful file.
        const completed = await this.client
          .db(this.databaseName)
          .collection(`${FOOD_MEDIA_BUCKET}.files`)
          .findOne({ _id: upload.id }, { projection: { _id: 1 } });
        if (!completed)
          await this.client
            .db(this.databaseName)
            .collection(`${FOOD_MEDIA_BUCKET}.chunks`)
            .deleteMany({ files_id: upload.id });
        if (!(error instanceof MongoServerError && error.code === 11000)) throw error;
      }
      if ((await this.read(object)) === null) throw new ProviderError('failure');
      return object;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof ValidationError) throw new ProviderError('failure');
      throw new ProviderError('unavailable');
    }
  }

  async read(reference: StorageObjectReference): Promise<Uint8Array | null> {
    const validated = createStorageObjectReference(reference);
    if (validated.purpose !== 'VENUE_CATALOG_MEDIA')
      throw new TypeError('Invalid food media purpose.');
    try {
      const file = await this.bucket.find({ filename: validated.objectKey }).limit(1).next();
      if (!file) return null;
      const metadata: unknown = file.metadata;
      if (!validMetadata(file, metadata, validated)) throw new ProviderError('failure');
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of this.bucket.openDownloadStream(file._id)) {
        const bytes = Buffer.from(chunk as Uint8Array);
        length += bytes.length;
        if (length > MAX_STORAGE_OBJECT_BYTES || length > file.length)
          throw new ProviderError('failure');
        chunks.push(bytes);
      }
      const bytes = Buffer.concat(chunks);
      const actual = createStoredObject({
        bytes,
        purpose: validated.purpose,
        resourceId: validated.resourceId,
        contentType: validated.objectKey.endsWith('.png')
          ? 'image/png'
          : validated.objectKey.endsWith('.jpg')
            ? 'image/jpeg'
            : 'image/webp',
      });
      if (actual.objectKey !== validated.objectKey || length !== file.length)
        throw new ProviderError('failure');
      return new Uint8Array(bytes);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof ValidationError) throw new ProviderError('failure');
      throw new ProviderError('unavailable');
    }
  }

  async delete(reference: StorageObjectReference): Promise<void> {
    const validated = createStorageObjectReference(reference);
    try {
      const file = await this.bucket.find({ filename: validated.objectKey }).limit(1).next();
      if (file) await this.bucket.delete(file._id);
    } catch {
      throw new ProviderError('unavailable');
    }
  }
}

function validMetadata(
  file: GridFSFile,
  value: unknown,
  reference: StorageObjectReference,
): boolean {
  if (!value || typeof value !== 'object') return false;
  const metadata = value as Record<string, unknown>;
  const extension = reference.objectKey.split('.').at(-1);
  const mime =
    extension === 'png' ? 'image/png' : extension === 'jpg' ? 'image/jpeg' : 'image/webp';
  return (
    metadata.schemaVersion === 1 &&
    ['DISH_VERSION', 'MENU_PACKAGE_VERSION'].includes(String(metadata.resourceType)) &&
    metadata.objectKey === reference.objectKey &&
    metadata.resourceId === reference.resourceId &&
    metadata.purpose === reference.purpose &&
    metadata.sizeBytes === file.length &&
    metadata.contentType === mime &&
    metadata.checksumSha256 === reference.objectKey.split('/').at(-1)?.split('.')[0] &&
    file.length > 0 &&
    file.length <= MAX_STORAGE_OBJECT_BYTES
  );
}
