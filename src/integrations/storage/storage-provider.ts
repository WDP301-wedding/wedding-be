import { createHash } from 'node:crypto';

import {
  extensionForContentType,
  parseStorageInput,
  purposePrefix,
  putObjectCommandSchema,
  signedReadTtlSchema,
  storageObjectReferenceSchema,
  type StorageContentType,
  type StorageObjectKey,
  type StoragePurpose,
} from './storage.schemas.js';

export const DEFAULT_SIGNED_READ_TTL_SECONDS = 15 * 60;

export interface PutObjectCommand {
  readonly bytes: Uint8Array;
  readonly contentType: StorageContentType;
  readonly purpose: StoragePurpose;
  readonly resourceId: string;
}

export interface StorageObjectReference {
  readonly objectKey: StorageObjectKey;
  readonly purpose: StoragePurpose;
  readonly resourceId: string;
}

export interface StoredObject extends StorageObjectReference {
  readonly checksumSha256: string;
  readonly contentType: StorageContentType;
  readonly sizeBytes: number;
}

export interface StorageProvider {
  /** Additive server-only original read; older providers fail closed at consumers. */
  read?(reference: StorageObjectReference): Promise<Uint8Array>;
  put(command: PutObjectCommand): Promise<StoredObject>;
  createSignedReadUrl(
    reference: StorageObjectReference,
    expiresInSeconds?: number,
  ): Promise<string>;
  delete(reference: StorageObjectReference): Promise<void>;
}

export function createStoredObject(command: PutObjectCommand): StoredObject {
  const validated = parseStorageInput(putObjectCommandSchema, command);
  const checksumSha256 = createHash('sha256').update(validated.bytes).digest('hex');
  const objectKey = `${purposePrefix(validated.purpose)}/${validated.resourceId}/${checksumSha256}.${extensionForContentType(validated.contentType)}`;
  const reference = createStorageObjectReference({
    objectKey,
    purpose: validated.purpose,
    resourceId: validated.resourceId,
  });

  return Object.freeze({
    ...reference,
    checksumSha256,
    contentType: validated.contentType,
    sizeBytes: validated.bytes.byteLength,
  });
}

export function createStorageObjectReference(value: unknown): StorageObjectReference {
  return Object.freeze(parseStorageInput(storageObjectReferenceSchema, value));
}

export function validatePutObjectCommand(command: PutObjectCommand): PutObjectCommand {
  return parseStorageInput(putObjectCommandSchema, command);
}

export function validateSignedReadTtl(expiresInSeconds?: number): number {
  return parseStorageInput(
    signedReadTtlSchema,
    expiresInSeconds ?? DEFAULT_SIGNED_READ_TTL_SECONDS,
  );
}
