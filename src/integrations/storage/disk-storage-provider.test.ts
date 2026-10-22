import { mkdir, mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DiskStorageProvider, createDiskStorageRouter } from './disk-storage-provider.js';

const roots: string[] = [];
const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const command = {
  bytes,
  contentType: 'image/png' as const,
  purpose: 'PRIVATE_WEDDING_MEDIA' as const,
  resourceId: '984bd852-853b-4c21-82d1-e7f43c442a81',
};
async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'wedding-disk-'));
  roots.push(root);
  let now = 1_800_000_000_000;
  const provider = new DiskStorageProvider({
    root,
    publicOrigin: 'https://api.example.test',
    signingKey: 'controlled-disk-signing-key-at-least-32-bytes',
    now: () => now,
  });
  const app = createApp({
    runtimeEnvironment: 'test',
    registerRoutes(app) {
      app.use('/api/v1/storage', createDiskStorageRouter(provider));
    },
  });
  return { root, provider, app, advance: (ms: number) => (now += ms) };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('persistent disk private storage', () => {
  it('persists immutable content-addressed bytes across provider instances and duplicate puts', async () => {
    const h = await harness();
    const objects = await Promise.all([h.provider.put(command), h.provider.put(command)]);
    expect(objects[0]).toEqual(objects[1]);
    expect(new Uint8Array(await readFile(join(h.root, objects[0].objectKey)))).toEqual(bytes);
    const restarted = new DiskStorageProvider({
      root: h.root,
      publicOrigin: 'https://api.example.test',
      signingKey: 'controlled-disk-signing-key-at-least-32-bytes',
    });
    expect(await restarted.read(objects[0])).toEqual(bytes);
  });

  it('serves the exact image only with a valid scoped, unexpired signature', async () => {
    const h = await harness();
    const object = await h.provider.put(command);
    const signed = new URL(await h.provider.createSignedReadUrl(object, 60));
    const response = await request(h.app).get(signed.pathname + signed.search);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('image/png');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(response.body).toEqual(Buffer.from(bytes));
    expect((await request(h.app).get(signed.pathname)).status).toBe(404);
    const altered = new URL(signed);
    altered.searchParams.set('signature', '0'.repeat(64));
    expect((await request(h.app).get(altered.pathname + altered.search)).status).toBe(404);
    const other = signed.pathname.replace(
      command.resourceId,
      '11111111-1111-4111-8111-111111111111',
    );
    expect((await request(h.app).get(other + signed.search)).status).toBe(404);
    h.advance(60_000);
    expect((await request(h.app).get(signed.pathname + signed.search)).status).toBe(404);
  });

  it('fails closed for corrupted bytes, unsafe paths and invalid signing configuration', async () => {
    const h = await harness();
    const object = await h.provider.put(command);
    await writeFile(join(h.root, object.objectKey), Buffer.from('corrupted'));
    await expect(h.provider.read(object)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    await expect(
      h.provider.read({ ...object, objectKey: '../secret' } as typeof object),
    ).rejects.toBeDefined();
    expect(
      () =>
        new DiskStorageProvider({
          root: h.root,
          publicOrigin: 'http://api.example.test',
          signingKey: 'short',
        }),
    ).toThrow();
  });

  it('deletes only the referenced object and does not sign missing objects', async () => {
    const h = await harness();
    const object = await h.provider.put(command);
    await h.provider.delete(object);
    await h.provider.delete(object);
    await expect(h.provider.createSignedReadUrl(object)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('preserves catalog JPEG and WebP MIME types and refuses TTL/query manipulation', async () => {
    const h = await harness();
    for (const [contentType, bytes] of [
      ['image/jpeg', Uint8Array.from([255, 216, 255, 1])],
      ['image/webp', Uint8Array.from([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80])],
    ] as const) {
      const object = await h.provider.put({
        ...command,
        purpose: 'VENUE_CATALOG_MEDIA',
        contentType,
        bytes,
      });
      const url = new URL(await h.provider.createSignedReadUrl(object));
      expect(
        (await request(h.app).get(url.pathname + url.search)).headers['content-type'],
      ).toContain(contentType);
      url.searchParams.set('extra', 'unexpected');
      expect((await request(h.app).get(url.pathname + url.search)).status).toBe(404);
      url.searchParams.delete('extra');
      url.searchParams.set('expires', '1800003601');
      expect((await request(h.app).get(url.pathname + url.search)).status).toBe(404);
      await expect(h.provider.createSignedReadUrl(object, 3601)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      await expect(h.provider.readSigned('../secret', {})).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    }
  });

  it('refuses empty, oversized, replaced and inaccessible stored content', async () => {
    const h = await harness();
    const object = await h.provider.put(command);
    const path = join(h.root, object.objectKey);
    await truncate(path, 0);
    await expect(h.provider.read(object)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    await truncate(path, 25 * 1024 * 1024 + 1);
    await expect(h.provider.read(object)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    await writeFile(path, Uint8Array.from([...bytes, 4]));
    await expect(h.provider.read(object)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    await expect(h.provider.put(command)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    await rm(path);
    await mkdir(path);
    await expect(h.provider.read(object)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    await expect(h.provider.delete(object)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    await expect(h.provider.put({ ...command, bytes: new Uint8Array() })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});
