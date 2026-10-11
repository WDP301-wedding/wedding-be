import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { NotFoundError, ProviderError, ValidationError } from '../../core/errors/app-error.js';
import { FakeStorageProvider } from './fake-storage-provider.js';
import { MAX_STORAGE_OBJECT_BYTES } from './storage.schemas.js';
import {
  createStorageObjectReference,
  type PutObjectCommand,
  type StorageObjectReference,
} from './storage-provider.js';
import {
  createSupabaseStorageProvider,
  SupabaseStorageProvider,
  type SupabaseStorageClientLike,
} from './supabase-storage-provider.js';

const resourceId = '11111111-1111-4111-8111-111111111111';
const pngBytes = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
]);
const pngChecksum = createHash('sha256').update(pngBytes).digest('hex');
const jpegBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]);
const webpBytes = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

function validPutCommand(): PutObjectCommand {
  return {
    bytes: pngBytes,
    contentType: 'image/png',
    purpose: 'PRIVATE_WEDDING_MEDIA',
    resourceId,
  };
}

function createClient(
  overrides: Partial<ReturnType<SupabaseStorageClientLike['from']>> = {},
): SupabaseStorageClientLike {
  return {
    from: vi.fn(() => ({
      createSignedUrl: vi.fn(() =>
        Promise.resolve({
          data: {
            signedUrl:
              'https://project.supabase.co/storage/v1/object/sign/wedding-private/placeholder',
          },
          error: null,
        }),
      ),
      info: vi.fn(() =>
        Promise.resolve({
          data: {
            contentType: 'image/png',
            metadata: {
              checksumSha256: pngChecksum,
              purpose: 'PRIVATE_WEDDING_MEDIA',
              resourceId,
              sizeBytes: pngBytes.byteLength,
            },
            size: pngBytes.byteLength,
          },
          error: null,
        }),
      ),
      remove: vi.fn((objectKeys: string[]) =>
        Promise.resolve({ data: [{ name: objectKeys[0] }], error: null }),
      ),
      upload: vi.fn((objectKey: string) =>
        Promise.resolve({ data: { path: objectKey }, error: null }),
      ),
      ...overrides,
    })),
  };
}

function createAdapter(client: SupabaseStorageClientLike): SupabaseStorageProvider {
  return new SupabaseStorageProvider({
    bucket: 'wedding-private',
    client,
    providerOrigin: 'https://project.supabase.co',
    timeoutMs: 50,
  });
}

describe('FakeStorageProvider', () => {
  it('stores validated bytes under a generated purpose/resource key and signs reads for 15 minutes', async () => {
    const provider = new FakeStorageProvider();

    const stored = await provider.put(validPutCommand());
    const signedUrl = await provider.createSignedReadUrl(stored);

    expect(stored).toMatchObject({
      contentType: 'image/png',
      purpose: 'PRIVATE_WEDDING_MEDIA',
      resourceId,
      sizeBytes: pngBytes.byteLength,
    });
    expect(stored.checksumSha256).toMatch(/^[a-f\d]{64}$/u);
    expect(stored.objectKey).toBe(
      `private-wedding-media/${resourceId}/${stored.checksumSha256}.png`,
    );
    expect(signedUrl).toContain('expiresIn=900');
  });

  it('canonicalizes an uppercase UUID before generating the object key', async () => {
    const provider = new FakeStorageProvider();
    const uppercaseResourceId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';

    const stored = await provider.put({
      ...validPutCommand(),
      resourceId: uppercaseResourceId,
    });

    expect(stored.resourceId).toBe(uppercaseResourceId.toLowerCase());
    expect(stored.objectKey).toContain(`/${uppercaseResourceId.toLowerCase()}/`);
  });

  it('isolates venue catalog media under its generated purpose/resource prefix', async () => {
    const provider = new FakeStorageProvider();

    const stored = await provider.put({
      ...validPutCommand(),
      purpose: 'VENUE_CATALOG_MEDIA',
    });

    expect(stored.objectKey).toBe(`venue-catalog-media/${resourceId}/${stored.checksumSha256}.png`);
    expect(stored.purpose).toBe('VENUE_CATALOG_MEDIA');
    expect(() =>
      createStorageObjectReference({
        ...stored,
        purpose: 'PRIVATE_WEDDING_MEDIA',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects unsupported MIME declarations and mismatched magic bytes', async () => {
    const provider = new FakeStorageProvider();
    const unsupported = {
      ...validPutCommand(),
      contentType: 'image/gif',
    } as unknown as PutObjectCommand;
    const mismatched = { ...validPutCommand(), contentType: 'image/jpeg' as const };

    await expect(provider.put(unsupported)).rejects.toBeInstanceOf(ValidationError);
    await expect(provider.put(mismatched)).rejects.toBeInstanceOf(ValidationError);
  });

  it('accepts allowlisted JPEG and WebP signatures and rejects malformed WebP content', async () => {
    const provider = new FakeStorageProvider();

    const jpeg = await provider.put({
      ...validPutCommand(),
      bytes: jpegBytes,
      contentType: 'image/jpeg',
    });
    const webp = await provider.put({
      ...validPutCommand(),
      bytes: webpBytes,
      contentType: 'image/webp',
    });

    expect(jpeg.objectKey).toMatch(/\.jpg$/u);
    expect(webp.objectKey).toMatch(/\.webp$/u);
    await expect(
      provider.put({
        ...validPutCommand(),
        bytes: Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0, 0, 0, 0]),
        contentType: 'image/webp',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects empty and over-limit file bodies before hashing or storage', async () => {
    const provider = new FakeStorageProvider();

    await expect(
      provider.put({ ...validPutCommand(), bytes: new Uint8Array() }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      provider.put({
        ...validPutCommand(),
        bytes: new Uint8Array(MAX_STORAGE_OBJECT_BYTES + 1),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('removes an object and reports a later read as missing', async () => {
    const provider = new FakeStorageProvider();
    const stored = await provider.put(validPutCommand());

    await provider.delete(stored);

    await expect(provider.createSignedReadUrl(stored)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('storage object references', () => {
  it('rejects a key that escapes or disagrees with its purpose/resource identity', () => {
    expect(() =>
      createStorageObjectReference({
        objectKey: '../another-booking/private.png',
        purpose: 'PRIVATE_WEDDING_MEDIA',
        resourceId,
      }),
    ).toThrow(ValidationError);
    expect(() =>
      createStorageObjectReference({
        objectKey:
          'private-wedding-media/22222222-2222-4222-8222-222222222222/' + `${'a'.repeat(64)}.png`,
        purpose: 'PRIVATE_WEDDING_MEDIA',
        resourceId,
      }),
    ).toThrow(ValidationError);
  });
});

describe('SupabaseStorageProvider', () => {
  it('rejects unsafe adapter configuration before any client operation', () => {
    const client = createClient();
    const baseOptions = {
      bucket: 'wedding-private',
      client,
      providerOrigin: 'https://project.supabase.co',
    };

    expect(() => new SupabaseStorageProvider({ ...baseOptions, bucket: '../private' })).toThrow(
      TypeError,
    );
    expect(
      () =>
        new SupabaseStorageProvider({
          ...baseOptions,
          providerOrigin: 'http://project.supabase.co',
        }),
    ).toThrow(TypeError);
    expect(() => new SupabaseStorageProvider({ ...baseOptions, timeoutMs: 1.5 })).toThrow(
      TypeError,
    );
    expect(() => new SupabaseStorageProvider({ ...baseOptions, timeoutMs: 0 })).toThrow(TypeError);
    expect(() => new SupabaseStorageProvider({ ...baseOptions, timeoutMs: 60_001 })).toThrow(
      TypeError,
    );
    expect(() => new SupabaseStorageProvider(baseOptions)).not.toThrow();
  });

  it('uploads without upsert, validates remote metadata, and returns only a persistent object key', async () => {
    const upload = vi.fn((objectKey: string) =>
      Promise.resolve({ data: { path: objectKey }, error: null }),
    );
    const info = vi.fn(() =>
      Promise.resolve({
        data: {
          contentType: 'image/png',
          metadata: {
            checksumSha256: pngChecksum,
            purpose: 'PRIVATE_WEDDING_MEDIA',
            resourceId,
            sizeBytes: pngBytes.byteLength,
          },
          size: pngBytes.byteLength,
        },
        error: null,
      }),
    );
    const client = createClient({ upload, info });
    const provider = createAdapter(client);

    const stored = await provider.put(validPutCommand());

    expect(client.from).toHaveBeenCalledWith('wedding-private');
    expect(upload).toHaveBeenCalledWith(stored.objectKey, pngBytes, {
      cacheControl: '3600',
      contentType: 'image/png',
      metadata: {
        checksumSha256: stored.checksumSha256,
        purpose: 'PRIVATE_WEDDING_MEDIA',
        resourceId,
        sizeBytes: pngBytes.byteLength,
      },
      upsert: false,
    });
    expect(info).toHaveBeenCalledWith(stored.objectKey);
    expect(stored).not.toHaveProperty('signedUrl');
  });

  it('uses a 900-second signed read by default and validates its origin', async () => {
    const createSignedUrl = vi.fn((objectKey: string) =>
      Promise.resolve({
        data: {
          signedUrl: `https://project.supabase.co/storage/v1/object/sign/wedding-private/${objectKey}?token=signed`,
        },
        error: null,
      }),
    );
    const client = createClient({ createSignedUrl });
    const provider = createAdapter(client);
    const stored = await provider.put(validPutCommand());

    await expect(provider.createSignedReadUrl(stored)).resolves.toContain('token=signed');
    expect(createSignedUrl).toHaveBeenCalledWith(stored.objectKey, 900);
  });

  it('rejects provider metadata that disagrees with the uploaded file', async () => {
    const client = createClient({
      info: vi.fn(() =>
        Promise.resolve({
          data: { contentType: 'image/jpeg', size: pngBytes.byteLength + 1 },
          error: null,
        }),
      ),
    });

    await expect(createAdapter(client).put(validPutCommand())).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    });
  });

  it('rejects malformed and mismatched upload responses', async () => {
    const malformed = createClient({ upload: vi.fn(() => Promise.resolve({ ok: true })) });
    const mismatched = createClient({
      upload: vi.fn(() => Promise.resolve({ data: { path: 'wrong/key.png' }, error: null })),
    });

    await expect(createAdapter(malformed).put(validPutCommand())).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    });
    await expect(createAdapter(mismatched).put(validPutCommand())).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    });
  });

  it('maps a permanent upload rejection to a stable provider failure', async () => {
    const client = createClient({
      upload: vi.fn(() =>
        Promise.resolve({ data: null, error: { message: 'invalid', status: 400 } }),
      ),
    });

    await expect(createAdapter(client).put(validPutCommand())).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    });
  });

  it('recovers a content-addressed upload retry when the existing object metadata matches', async () => {
    const client = createClient({
      upload: vi.fn(() =>
        Promise.resolve({ data: null, error: { message: 'duplicate', statusCode: 409 } }),
      ),
    });

    const stored = await createAdapter(client).put(validPutCommand());

    expect(stored.checksumSha256).toBe(pngChecksum);
    expect(stored.objectKey).toContain(pngChecksum);
  });

  it.each([409, '409'])('recovers SDK HTTP 400 with storage statusCode %s', async (statusCode) => {
    const client = createClient({
      upload: vi.fn(() => Promise.resolve({ data: null, error: { status: 400, statusCode } })),
    });

    await expect(createAdapter(client).put(validPutCommand())).resolves.toMatchObject({
      checksumSha256: pngChecksum,
    });
  });

  it('rejects SDK duplicate recovery when retained metadata differs', async () => {
    const client = createClient({
      upload: vi.fn(() =>
        Promise.resolve({ data: null, error: { status: 400, statusCode: '409' } }),
      ),
      info: vi.fn(() =>
        Promise.resolve({
          data: {
            contentType: 'image/png',
            size: pngBytes.byteLength,
            metadata: {
              checksumSha256: 'a'.repeat(64),
              purpose: 'PRIVATE_WEDDING_MEDIA',
              resourceId,
              sizeBytes: pngBytes.byteLength,
            },
          },
          error: null,
        }),
      ),
    });

    await expect(createAdapter(client).put(validPutCommand())).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    });
  });

  it('rejects a signed URL for another object or provider origin', async () => {
    const client = createClient({
      createSignedUrl: vi.fn(() =>
        Promise.resolve({
          data: { signedUrl: 'https://attacker.example/object?token=stolen' },
          error: null,
        }),
      ),
    });
    const provider = createAdapter(client);
    const stored = await provider.put(validPutCommand());

    await expect(provider.createSignedReadUrl(stored)).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    });
  });

  it('rejects signed responses with a missing URL, wrong path, missing token, or malformed encoding', async () => {
    const providerFor = (signedUrlResponse: unknown): SupabaseStorageProvider =>
      createAdapter(
        createClient({ createSignedUrl: vi.fn(() => Promise.resolve(signedUrlResponse)) }),
      );
    const stored = await createAdapter(createClient()).put(validPutCommand());
    const responses = [
      { data: null, error: null },
      {
        data: {
          signedUrl:
            'https://project.supabase.co/storage/v1/object/sign/wedding-private/wrong.png?token=signed',
        },
        error: null,
      },
      {
        data: {
          signedUrl: `https://project.supabase.co/storage/v1/object/sign/wedding-private/${stored.objectKey}`,
        },
        error: null,
      },
      {
        data: {
          signedUrl:
            'https://project.supabase.co/storage/v1/object/sign/wedding-private/%E0%A4%A?token=signed',
        },
        error: null,
      },
      {
        data: {
          signedUrl: `https://project.supabase.co/unexpected/storage/v1/object/sign/wedding-private/${stored.objectKey}?token=signed`,
        },
        error: null,
      },
    ];

    for (const response of responses) {
      await expect(providerFor(response).createSignedReadUrl(stored)).rejects.toMatchObject({
        code: 'PROVIDER_ERROR',
      });
    }
  });

  it('normalizes a provider timeout without leaking the raw operation', async () => {
    const never = new Promise<never>(() => undefined);
    const client = createClient({ upload: vi.fn(() => never) });
    const provider = new SupabaseStorageProvider({
      bucket: 'wedding-private',
      client,
      providerOrigin: 'https://project.supabase.co',
      timeoutMs: 5,
    });

    await expect(provider.put(validPutCommand())).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT',
    });
  });

  it('normalizes thrown abort, unavailable, and opaque failures', async () => {
    const abortError = Object.assign(new Error('aborted provider secret'), { name: 'AbortError' });
    const failures = [
      { expectedCode: 'PROVIDER_TIMEOUT', rejection: abortError },
      {
        expectedCode: 'PROVIDER_UNAVAILABLE',
        rejection: Object.assign(new Error('unavailable'), { statusCode: '503' }),
      },
      { expectedCode: 'PROVIDER_ERROR', rejection: new Error('opaque failure') },
    ];

    for (const failure of failures) {
      const client = createClient({ upload: vi.fn(() => Promise.reject(failure.rejection)) });
      await expect(createAdapter(client).put(validPutCommand())).rejects.toMatchObject({
        code: failure.expectedCode,
      });
    }
  });

  it('preserves an already-normalized application error thrown by the client boundary', async () => {
    const normalized = new ProviderError('failure');
    const client = createClient({ upload: vi.fn(() => Promise.reject(normalized)) });

    await expect(createAdapter(client).put(validPutCommand())).rejects.toBe(normalized);
  });

  it('maps a missing provider object to the stable not-found error', async () => {
    const client = createClient({
      createSignedUrl: vi.fn(() =>
        Promise.resolve({ data: null, error: { message: 'missing secret path', statusCode: 404 } }),
      ),
    });
    const provider = createAdapter(client);
    const stored = await provider.put(validPutCommand());

    await expect(provider.createSignedReadUrl(stored)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects unsafe references before invoking the Supabase client', async () => {
    const client = createClient();
    const provider = createAdapter(client);
    const unsafeReference = {
      objectKey: '../outside/private.png',
      purpose: 'PRIVATE_WEDDING_MEDIA',
      resourceId,
    } as unknown as StorageObjectReference;

    await expect(provider.delete(unsafeReference)).rejects.toBeInstanceOf(ValidationError);
    expect(client.from).not.toHaveBeenCalled();
  });

  it('validates the deleted object identity and keeps deletion idempotent', async () => {
    const provider = createAdapter(createClient());
    const stored = await provider.put(validPutCommand());

    await expect(provider.delete(stored)).resolves.toBeUndefined();

    const missingProvider = createAdapter(
      createClient({ remove: vi.fn(() => Promise.resolve({ data: [], error: null })) }),
    );
    await expect(missingProvider.delete(stored)).resolves.toBeUndefined();

    const mismatchedProvider = createAdapter(
      createClient({
        remove: vi.fn(() => Promise.resolve({ data: [{ name: 'wrong/key.png' }], error: null })),
      }),
    );
    await expect(mismatchedProvider.delete(stored)).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    });
  });

  it('normalizes unavailable failures separately from permanent provider failures', async () => {
    const client = createClient({
      upload: vi.fn(() =>
        Promise.resolve({ data: null, error: { message: 'backend unavailable', statusCode: 503 } }),
      ),
    });

    const promise = createAdapter(client).put(validPutCommand());

    await expect(promise).rejects.toBeInstanceOf(ProviderError);
    await expect(promise).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });

  it('constructs the official standalone SDK adapter without issuing a request', () => {
    const provider = createSupabaseStorageProvider({
      bucket: 'wedding-private',
      serviceRoleKey: 'test-service-key',
      supabaseUrl: 'https://project.supabase.co/',
      timeoutMs: 25,
    });

    expect(provider).toBeInstanceOf(SupabaseStorageProvider);
  });
});
