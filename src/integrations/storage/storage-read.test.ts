import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  SupabaseStorageProvider,
  type SupabaseStorageClientLike,
} from './supabase-storage-provider.js';
import { FakeStorageProvider } from './fake-storage-provider.js';
import { createStoredObject } from './storage-provider.js';
describe('Private content-addressed reads for derived invitation assets', () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  function harness(download?: () => Promise<unknown>) {
    const client = {
      from: () => ({
        upload: vi.fn(),
        info: vi.fn(),
        remove: vi.fn(),
        createSignedUrl: vi.fn(),
        ...(download === undefined ? {} : { download }),
      }),
    } as SupabaseStorageClientLike;
    return new SupabaseStorageProvider({
      client,
      bucket: 'private-media',
      providerOrigin: 'https://storage.example.test',
    });
  }
  it.each(['image/png', 'image/jpeg', 'image/webp'] as const)(
    'verifies checksum and clones bytes for %s',
    async (contentType) => {
      const data =
        contentType === 'image/png'
          ? bytes
          : contentType === 'image/jpeg'
            ? new Uint8Array([255, 216, 255, 224])
            : new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]);
      const ref = createStoredObject({
        bytes: data,
        contentType,
        purpose: 'PRIVATE_WEDDING_MEDIA',
        resourceId: randomUUID(),
      });
      expect(
        await harness(() => Promise.resolve({ data: new Blob([data]), error: null })).read(ref),
      ).toEqual(data);
    },
  );
  it.each([
    null,
    {},
    { data: 'bad', error: null },
    { data: null, error: null },
    { data: new Blob([]), error: null },
    { data: new Blob([new Uint8Array([9])]), error: null },
    { data: new Blob([new Uint8Array(25 * 1024 * 1024 + 1)]), error: null },
  ])('fails closed on malformed/missing/oversized/corrupt read %#', async (response) => {
    const ref = createStoredObject({
      bytes,
      contentType: 'image/png',
      purpose: 'PRIVATE_WEDDING_MEDIA',
      resourceId: randomUUID(),
    });
    await expect(harness(() => Promise.resolve(response)).read(ref)).rejects.toMatchObject({
      status: 502,
    });
  });
  it('requires download capability, conceals absent objects and validates reference before provider access', async () => {
    const ref = createStoredObject({
      bytes,
      contentType: 'image/png',
      purpose: 'PRIVATE_WEDDING_MEDIA',
      resourceId: randomUUID(),
    });
    await expect(harness().read(ref)).rejects.toMatchObject({ status: 503 });
    await expect(
      harness(() => Promise.resolve({ data: null, error: { statusCode: 404 } })).read(ref),
    ).rejects.toMatchObject({ status: 404 });
    const read = vi.fn(() => Promise.resolve({ data: new Blob([bytes]), error: null }));
    await expect(
      harness(read).read({ ...ref, objectKey: '../../private' as never }),
    ).rejects.toMatchObject({ status: 422 });
    expect(read).not.toHaveBeenCalled();
  });
  it('fake read models missing objects and never shares the mutable stored buffer', async () => {
    const fake = new FakeStorageProvider(),
      command = {
        bytes,
        contentType: 'image/png' as const,
        purpose: 'PRIVATE_WEDDING_MEDIA' as const,
        resourceId: randomUUID(),
      };
    const ref = createStoredObject(command);
    await expect(fake.read(ref)).rejects.toMatchObject({ status: 404 });
    await fake.put(command);
    const read = await fake.read(ref);
    read[0] = 9;
    expect(await fake.read(ref)).toEqual(bytes);
  });
});
