import { NotFoundError } from '../../core/errors/app-error.js';
import {
  createStoredObject,
  createStorageObjectReference,
  validatePutObjectCommand,
  validateSignedReadTtl,
  type PutObjectCommand,
  type StorageObjectReference,
  type StorageProvider,
  type StoredObject,
} from './storage-provider.js';

interface StoredRecord {
  readonly bytes: Uint8Array;
  readonly object: StoredObject;
}

export class FakeStorageProvider implements StorageProvider {
  readonly #objects = new Map<string, StoredRecord>();

  put(command: PutObjectCommand): Promise<StoredObject> {
    return Promise.resolve().then(() => {
      const validated = validatePutObjectCommand(command);
      const object = createStoredObject(validated);
      this.#objects.set(object.objectKey, {
        bytes: validated.bytes.slice(),
        object,
      });
      return object;
    });
  }

  createSignedReadUrl(
    reference: StorageObjectReference,
    expiresInSeconds?: number,
  ): Promise<string> {
    return Promise.resolve().then(() => {
      const validated = createStorageObjectReference(reference);
      const expiresIn = validateSignedReadTtl(expiresInSeconds);
      if (!this.#objects.has(validated.objectKey)) {
        throw new NotFoundError();
      }

      const url = new URL(
        `https://fake-storage.invalid/${encodeURIComponent(validated.objectKey)}`,
      );
      url.searchParams.set('expiresIn', String(expiresIn));
      return url.toString();
    });
  }

  delete(reference: StorageObjectReference): Promise<void> {
    return Promise.resolve().then(() => {
      const validated = createStorageObjectReference(reference);
      this.#objects.delete(validated.objectKey);
    });
  }

  read(reference: StorageObjectReference): Promise<Uint8Array> {
    return Promise.resolve().then(() => {
      const validated = createStorageObjectReference(reference);
      const record = this.#objects.get(validated.objectKey);
      if (record === undefined) throw new NotFoundError();
      return record.bytes.slice();
    });
  }
}
