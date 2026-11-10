import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../app.js';
import { ProviderError } from '../../core/errors/app-error.js';
import { DiskStorageProvider, createDiskStorageRouter } from './disk-storage-provider.js';
import { MongoFoodStorageProvider } from './mongo-food-storage-provider.js';
import { createStoredObject } from './storage-provider.js';

const roots: string[] = [];
const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const command = {
  bytes,
  contentType: 'image/png' as const,
  purpose: 'VENUE_CATALOG_MEDIA' as const,
  resourceId: '984bd852-853b-4c21-82d1-e7f43c442a81',
  catalogResourceType: 'DISH_VERSION' as const,
};
async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'wedding-mongo-food-'));
  roots.push(root);
  const options = {
    root,
    publicOrigin: 'https://api.example.test',
    signingKey: 'a'.repeat(32),
    now: () => 1_800_000_000_000,
  };
  const store = {
    put: vi.fn(() => Promise.resolve(createStoredObject(command))),
    read: vi.fn<() => Promise<Uint8Array | null>>(() => Promise.resolve(bytes)),
    delete: vi.fn(() => Promise.resolve()),
  };
  const provider = new MongoFoodStorageProvider(options, store);
  const disk = new DiskStorageProvider(options);
  const app = createApp({
    runtimeEnvironment: 'test',
    registerRoutes: (app) => {
      app.use('/api/v1/storage', createDiskStorageRouter(provider));
    },
  });
  return { provider, disk, store, app };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('selective MongoDB food image storage', () => {
  it('writes food images to MongoDB but keeps halls and private images on disk', async () => {
    const h = await harness();
    const food = await h.provider.put(command);
    expect(h.store.put).toHaveBeenCalledOnce();
    await expect(h.disk.read(food)).rejects.toMatchObject({ status: 404 });
    const other = {
      bytes,
      contentType: command.contentType,
      purpose: command.purpose,
      resourceId: command.resourceId,
    };
    await h.provider.put(other);
    expect(h.store.put).toHaveBeenCalledOnce();
    expect(await h.disk.read(food)).toEqual(bytes);
    const privateObject = await h.provider.put({ ...other, purpose: 'PRIVATE_WEDDING_MEDIA' });
    await h.provider.read(privateObject);
    expect(h.store.read).not.toHaveBeenCalled();
  });
  it('serves MongoDB bytes only through valid object-specific signed URLs', async () => {
    const h = await harness();
    const object = createStoredObject(command);
    const url = new URL(await h.provider.createSignedReadUrl(object, 60));
    expect((await request(h.app).get(url.pathname + url.search)).status).toBe(200);
    url.searchParams.set('signature', '0'.repeat(64));
    expect((await request(h.app).get(url.pathname + url.search)).status).toBe(404);
  });
  it('falls back for missing legacy files, but never hides a MongoDB outage', async () => {
    const h = await harness();
    const object = await h.disk.put(command);
    h.store.read.mockResolvedValueOnce(null);
    expect(await h.provider.read(object)).toEqual(bytes);
    h.store.read.mockRejectedValueOnce(new ProviderError('unavailable'));
    await expect(h.provider.read(object)).rejects.toMatchObject({ status: 503 });
  });
  it('does not send malformed references or private-image deletes to MongoDB', async () => {
    const h = await harness();
    await expect(
      h.provider.read({ ...createStoredObject(command), resourceId: 'invalid' }),
    ).rejects.toMatchObject({ status: 422 });
    expect(h.store.read).not.toHaveBeenCalled();
    const object = await h.disk.put({
      bytes,
      contentType: 'image/png',
      resourceId: command.resourceId,
      purpose: 'PRIVATE_WEDDING_MEDIA',
    });
    await h.provider.delete(object);
    expect(h.store.delete).not.toHaveBeenCalled();
  });
});
