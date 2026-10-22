import { constants } from 'node:fs';
import { link, mkdir, open, unlink } from 'node:fs/promises';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { Router } from 'express';
import { z } from 'zod';

import { NotFoundError, ProviderError } from '../../core/errors/app-error.js';
import { MAX_STORAGE_OBJECT_BYTES, storageObjectKeySchema } from './storage.schemas.js';
import {
  createStoredObject,
  createStorageObjectReference,
  validateSignedReadTtl,
  type PutObjectCommand,
  type StorageObjectReference,
  type StorageProvider,
} from './storage-provider.js';

export interface DiskStorageOptions {
  readonly root: string;
  readonly publicOrigin: string;
  readonly signingKey: string;
  readonly now?: () => number;
}

const signedQuery = z.strictObject({
  expires: z.string().regex(/^[1-9]\d{0,11}$/u),
  signature: z.string().regex(/^[a-f0-9]{64}$/u),
});

/** Content keys and domain metadata stay unchanged when moving from Supabase. */
export class DiskStorageProvider implements StorageProvider {
  readonly #root: string;
  readonly #origin: string;
  readonly #key: string;
  readonly #now: () => number;

  constructor(options: DiskStorageOptions) {
    const origin = new URL(options.publicOrigin);
    if (
      !isAbsolute(options.root) ||
      origin.protocol !== 'https:' ||
      origin.origin !== options.publicOrigin ||
      Buffer.byteLength(options.signingKey) < 32
    )
      throw new TypeError('Invalid persistent storage configuration.');
    this.#root = resolve(options.root);
    this.#origin = origin.origin;
    this.#key = options.signingKey;
    this.#now = options.now ?? Date.now;
  }

  async put(command: PutObjectCommand) {
    const object = createStoredObject(command);
    const path = join(this.#root, object.objectKey);
    const parent = join(this.#root, object.objectKey.split('/').slice(0, -1).join('/'));
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const temporary = join(parent, `.upload-${randomUUID()}`);
    try {
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(command.bytes);
        await file.sync();
      } finally {
        await file.close();
      }
      try {
        await link(temporary, path);
      } catch (error) {
        if (!hasCode(error, 'EEXIST')) throw error;
      }
      await this.read(object);
      return object;
    } finally {
      await unlink(temporary).catch((error: unknown) => {
        if (!hasCode(error, 'ENOENT')) throw error;
      });
    }
  }

  async read(reference: StorageObjectReference): Promise<Uint8Array> {
    const validated = createStorageObjectReference(reference);
    let file;
    try {
      file = await open(
        join(this.#root, validated.objectKey),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
    } catch (error) {
      if (hasCode(error, 'ENOENT')) throw new NotFoundError();
      throw new ProviderError('failure');
    }
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size < 1 || stat.size > MAX_STORAGE_OBJECT_BYTES)
        throw new ProviderError('failure');
      const bytes = new Uint8Array(await file.readFile());
      try {
        const actual = createStoredObject({
          bytes,
          contentType: contentType(validated.objectKey),
          purpose: validated.purpose,
          resourceId: validated.resourceId,
        });
        if (actual.objectKey !== validated.objectKey) throw new ProviderError('failure');
      } catch {
        throw new ProviderError('failure');
      }
      return bytes;
    } finally {
      await file.close();
    }
  }

  async createSignedReadUrl(reference: StorageObjectReference, ttl?: number): Promise<string> {
    const validated = createStorageObjectReference(reference);
    const expires = String(Math.floor(this.#now() / 1000) + validateSignedReadTtl(ttl));
    await this.read(validated);
    const url = new URL(`/api/v1/storage/objects/${validated.objectKey}`, this.#origin);
    url.searchParams.set('expires', expires);
    url.searchParams.set('signature', this.#signature(validated.objectKey, expires));
    return url.toString();
  }

  async delete(reference: StorageObjectReference): Promise<void> {
    const validated = createStorageObjectReference(reference);
    try {
      await unlink(join(this.#root, validated.objectKey));
    } catch (error) {
      if (!hasCode(error, 'ENOENT')) throw new ProviderError('failure');
    }
  }

  async readSigned(key: string, query: unknown) {
    const parsedKey = storageObjectKeySchema.safeParse(key);
    const parsedQuery = signedQuery.safeParse(query);
    if (!parsedKey.success || !parsedQuery.success) throw new NotFoundError();
    const { expires, signature } = parsedQuery.data;
    const seconds = Math.floor(this.#now() / 1000);
    if (
      Number(expires) <= seconds ||
      Number(expires) > seconds + 3600 ||
      !timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(this.#signature(key, expires), 'hex'),
      )
    )
      throw new NotFoundError();
    const parts = key.split('/');
    const reference = createStorageObjectReference({
      objectKey: key,
      purpose:
        parts[0] === 'private-wedding-media' ? 'PRIVATE_WEDDING_MEDIA' : 'VENUE_CATALOG_MEDIA',
      resourceId: parts[1],
    });
    return { bytes: await this.read(reference), contentType: contentType(key) };
  }

  #signature(key: string, expires: string) {
    return createHmac('sha256', this.#key).update(`v1\n${key}\n${expires}`).digest('hex');
  }
}

export function createDiskStorageRouter(provider: DiskStorageProvider): Router {
  const router = Router();
  router.get('/objects/*objectKey', (req, res, next) => {
    const segments = req.params.objectKey;
    const key = Array.isArray(segments) ? segments.join('/') : (segments ?? '');
    void provider
      .readSigned(key, req.query)
      .then(({ bytes, contentType: type }) => {
        res.set({
          'Cache-Control': 'private, no-store',
          'Cross-Origin-Resource-Policy': 'cross-origin',
          'X-Content-Type-Options': 'nosniff',
        });
        res.type(type).send(Buffer.from(bytes));
      })
      .catch(next);
  });
  return router;
}

function contentType(key: string) {
  return key.endsWith('.png')
    ? ('image/png' as const)
    : key.endsWith('.jpg')
      ? ('image/jpeg' as const)
      : ('image/webp' as const);
}
function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
