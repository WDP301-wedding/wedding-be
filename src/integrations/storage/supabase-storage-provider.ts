import { StorageClient } from '@supabase/storage-js';

import { AppError, NotFoundError, ProviderError } from '../../core/errors/app-error.js';
import {
  providerInfoResponseSchema,
  providerRemoveResponseSchema,
  providerSignedUrlResponseSchema,
  providerUploadResponseSchema,
} from './storage.schemas.js';
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

const DEFAULT_PROVIDER_TIMEOUT_MS = 10_000;
const bucketPattern = /^[a-z\d][a-z\d_-]{2,62}$/u;

interface SupabaseFileBucketLike {
  download?(objectKey: string): Promise<unknown>;
  createSignedUrl(objectKey: string, expiresInSeconds: number): Promise<unknown>;
  info(objectKey: string): Promise<unknown>;
  remove(objectKeys: string[]): Promise<unknown>;
  upload(
    objectKey: string,
    bytes: Uint8Array,
    options: {
      readonly cacheControl: string;
      readonly contentType: string;
      readonly metadata: Readonly<Record<string, string | number>>;
      readonly upsert: false;
    },
  ): Promise<unknown>;
}

export interface SupabaseStorageClientLike {
  readonly from: (bucket: string) => SupabaseFileBucketLike;
}

interface SupabaseStorageProviderOptions {
  readonly bucket: string;
  readonly client: SupabaseStorageClientLike;
  readonly providerOrigin: string;
  readonly timeoutMs?: number;
}

export interface SupabaseStorageConfiguration {
  readonly bucket: string;
  readonly serviceRoleKey: string;
  readonly supabaseUrl: string;
  readonly timeoutMs?: number;
}

export class SupabaseStorageProvider implements StorageProvider {
  readonly #bucket: string;
  readonly #client: SupabaseStorageClientLike;
  readonly #providerOrigin: string;
  readonly #timeoutMs: number;

  constructor(options: SupabaseStorageProviderOptions) {
    if (!bucketPattern.test(options.bucket)) {
      throw new TypeError('Supabase Storage bucket configuration is invalid.');
    }

    const providerUrl = new URL(options.providerOrigin);
    if (providerUrl.protocol !== 'https:') {
      throw new TypeError('Supabase Storage requires an HTTPS provider origin.');
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) {
      throw new TypeError('Supabase Storage timeout must be between 1 and 60000 milliseconds.');
    }

    this.#bucket = options.bucket;
    this.#client = options.client;
    this.#providerOrigin = providerUrl.origin;
    this.#timeoutMs = timeoutMs;
  }

  async put(command: PutObjectCommand): Promise<StoredObject> {
    const validated = validatePutObjectCommand(command);
    const stored = createStoredObject(validated);
    const bucket = this.#client.from(this.#bucket);
    const uploadResponse = await this.#invoke(() =>
      bucket.upload(stored.objectKey, validated.bytes, {
        cacheControl: '3600',
        contentType: stored.contentType,
        metadata: {
          checksumSha256: stored.checksumSha256,
          purpose: stored.purpose,
          resourceId: stored.resourceId,
          sizeBytes: stored.sizeBytes,
        },
        upsert: false,
      }),
    );
    const upload = parseProviderResponse(providerUploadResponseSchema, uploadResponse);
    const uploadWasDuplicate = providerStatus(upload.error) === 409;
    if (!uploadWasDuplicate) {
      throwProviderFailure(upload.error);
    }
    if (!uploadWasDuplicate && (upload.data === null || upload.data.path !== stored.objectKey)) {
      throw new ProviderError('failure');
    }

    const infoResponse = await this.#invoke(() => bucket.info(stored.objectKey));
    const info = parseProviderResponse(providerInfoResponseSchema, infoResponse);
    throwProviderFailure(info.error);
    if (
      info.data === null ||
      info.data.contentType !== stored.contentType ||
      info.data.size !== stored.sizeBytes ||
      info.data.metadata.checksumSha256 !== stored.checksumSha256 ||
      info.data.metadata.purpose !== stored.purpose ||
      info.data.metadata.resourceId !== stored.resourceId ||
      info.data.metadata.sizeBytes !== stored.sizeBytes
    ) {
      throw new ProviderError('failure');
    }

    return stored;
  }

  async read(reference: StorageObjectReference): Promise<Uint8Array> {
    const validated = createStorageObjectReference(reference);
    const bucket = this.#client.from(this.#bucket);
    if (bucket.download === undefined) throw new ProviderError('unavailable');
    const response = parseProviderResponse(
      {
        safeParse: (value: unknown) => {
          if (typeof value !== 'object' || value === null)
            return { success: false as const, error: null };
          const record = value as { data?: unknown; error?: unknown };
          if (!(record.data instanceof Blob) && record.data !== null)
            return { success: false as const, error: null };
          return { success: true as const, data: { data: record.data, error: record.error } };
        },
      },
      await this.#invoke(() => bucket.download!(validated.objectKey)),
    );
    throwProviderFailure(response.error);
    if (response.data === null || response.data.size < 1 || response.data.size > 25 * 1024 * 1024)
      throw new ProviderError('failure');
    const blob = response.data;
    const buffer = await this.#invoke(() => blob.arrayBuffer());
    if (!(buffer instanceof ArrayBuffer)) throw new ProviderError('failure');
    const bytes = new Uint8Array(buffer);
    const contentType = validated.objectKey.endsWith('.png')
      ? 'image/png'
      : validated.objectKey.endsWith('.jpg')
        ? 'image/jpeg'
        : 'image/webp';
    let actual: StoredObject;
    try {
      actual = createStoredObject({
        bytes,
        contentType,
        purpose: validated.purpose,
        resourceId: validated.resourceId,
      });
    } catch {
      throw new ProviderError('failure');
    }
    if (actual.objectKey !== validated.objectKey) throw new ProviderError('failure');
    return bytes;
  }

  async createSignedReadUrl(
    reference: StorageObjectReference,
    expiresInSeconds?: number,
  ): Promise<string> {
    const validated = createStorageObjectReference(reference);
    const expiresIn = validateSignedReadTtl(expiresInSeconds);
    const bucket = this.#client.from(this.#bucket);
    const response = await this.#invoke(() =>
      bucket.createSignedUrl(validated.objectKey, expiresIn),
    );
    const result = parseProviderResponse(providerSignedUrlResponseSchema, response);
    throwProviderFailure(result.error);
    if (result.data === null) {
      throw new ProviderError('failure');
    }

    const signedUrl = new URL(result.data.signedUrl);
    if (
      signedUrl.protocol !== 'https:' ||
      signedUrl.origin !== this.#providerOrigin ||
      !hasExpectedSignedPath(signedUrl, this.#bucket, validated.objectKey) ||
      !signedUrl.searchParams.has('token')
    ) {
      throw new ProviderError('failure');
    }
    return signedUrl.toString();
  }

  async delete(reference: StorageObjectReference): Promise<void> {
    const validated = createStorageObjectReference(reference);
    const bucket = this.#client.from(this.#bucket);
    const response = await this.#invoke(() => bucket.remove([validated.objectKey]));
    const result = parseProviderResponse(providerRemoveResponseSchema, response);
    throwProviderFailure(result.error);
    if (result.data === null) {
      throw new ProviderError('failure');
    }
    if (
      result.data.length > 0 &&
      !result.data.some((deletedObject) => deletedObject.name === validated.objectKey)
    ) {
      throw new ProviderError('failure');
    }
  }

  async #invoke(operation: () => Promise<unknown>): Promise<unknown> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new StorageProviderTimeoutError()), this.#timeoutMs);
    });

    try {
      return await Promise.race([operation(), timeout]);
    } catch (error: unknown) {
      if (error instanceof AppError) {
        throw error;
      }
      throw normalizeThrownProviderError(error);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }
}

export function createSupabaseStorageProvider(
  configuration: SupabaseStorageConfiguration,
): SupabaseStorageProvider {
  const providerOrigin = new URL(configuration.supabaseUrl).origin;
  const timeoutMs = configuration.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  const client = new StorageClient(
    `${providerOrigin}/storage/v1`,
    {
      apikey: configuration.serviceRoleKey,
      Authorization: `Bearer ${configuration.serviceRoleKey}`,
    },
    createTimeoutFetch(timeoutMs),
  );
  return new SupabaseStorageProvider({
    bucket: configuration.bucket,
    client,
    providerOrigin,
    timeoutMs,
  });
}

function createTimeoutFetch(timeoutMs: number): typeof fetch {
  return (input, init) => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
    return fetch(input, { ...init, signal });
  };
}

function parseProviderResponse<T>(
  schema: { safeParse(value: unknown): zResult<T> },
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ProviderError('failure');
  }
  return result.data;
}

type zResult<T> =
  Readonly<{ data: T; success: true }> | Readonly<{ error: unknown; success: false }>;

function throwProviderFailure(error: unknown): void {
  if (error === null) {
    return;
  }
  throw normalizeReturnedProviderError(error);
}

function normalizeReturnedProviderError(error: unknown): AppError {
  const status = providerStatus(error);
  if (status === 404) {
    return new NotFoundError();
  }
  if (status !== undefined && status >= 500) {
    return new ProviderError('unavailable');
  }
  return new ProviderError('failure');
}

function normalizeThrownProviderError(error: unknown): ProviderError {
  if (error instanceof StorageProviderTimeoutError || hasErrorName(error, 'AbortError')) {
    return new ProviderError('timeout');
  }
  const status = providerStatus(error);
  return new ProviderError(status !== undefined && status >= 500 ? 'unavailable' : 'failure');
}

function providerStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const candidate = error as { readonly status?: unknown; readonly statusCode?: unknown };
  const rawStatus = candidate.status ?? candidate.statusCode;
  if (typeof rawStatus === 'number' && Number.isInteger(rawStatus)) {
    return rawStatus;
  }
  if (typeof rawStatus === 'string' && /^\d{3}$/u.test(rawStatus)) {
    return Number(rawStatus);
  }
  return undefined;
}

function hasErrorName(error: unknown, name: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { readonly name?: unknown }).name === name
  );
}

function hasExpectedSignedPath(url: URL, bucket: string, objectKey: string): boolean {
  try {
    return decodeURIComponent(url.pathname) === `/storage/v1/object/sign/${bucket}/${objectKey}`;
  } catch {
    return false;
  }
}

class StorageProviderTimeoutError extends Error {}
