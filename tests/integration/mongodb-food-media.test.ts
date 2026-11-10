import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  GridFsFoodMediaStore,
  FOOD_MEDIA_BUCKET,
} from '../../src/integrations/storage/gridfs-food-media.store.js';
import { createStoredObject } from '../../src/integrations/storage/storage-provider.js';
import { DiskStorageProvider } from '../../src/integrations/storage/disk-storage-provider.js';
import { MongoFoodStorageProvider } from '../../src/integrations/storage/mongo-food-storage-provider.js';
import { migrateFoodMedia } from '../../src/integrations/storage/food-media-migration.js';

// Opt-in service dependency, also exercised by the dedicated CI MongoDB job.
const uri = process.env.TEST_MONGO_URI;
describe.skipIf(!uri)('disposable real MongoDB food images', () => {
  const client = new MongoClient(uri ?? 'mongodb://127.0.0.1:27128', {
    serverSelectionTimeoutMS: 2000,
  });
  const database = `wedding_food_test_${randomUUID().replaceAll('-', '')}`;
  const store = new GridFsFoodMediaStore(client, database);
  const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
  const command = () => ({
    bytes,
    contentType: 'image/png' as const,
    purpose: 'VENUE_CATALOG_MEDIA' as const,
    resourceId: randomUUID(),
    catalogResourceType: 'DISH_VERSION' as const,
  });
  beforeAll(async () => {
    await client.connect();
    await store.initialize();
  });
  afterAll(async () => {
    await client.db(database).dropDatabase();
    await client.close();
  });

  it('deduplicates concurrent uploads without deleting the winner or leaving chunks', async () => {
    const input = command();
    const results = await Promise.all(Array.from({ length: 5 }, () => store.put(input)));
    expect(results.every((result) => result.objectKey === results[0]!.objectKey)).toBe(true);
    expect(await store.read(results[0]!)).toEqual(bytes);
    const files = await client
      .db(database)
      .collection(`${FOOD_MEDIA_BUCKET}.files`)
      .find({ filename: results[0]!.objectKey })
      .toArray();
    expect(files).toHaveLength(1);
    const allChunks = await client
      .db(database)
      .collection(`${FOOD_MEDIA_BUCKET}.chunks`)
      .find({ files_id: files[0]!._id })
      .toArray();
    expect(allChunks).toHaveLength(1);
    const orphanChunks = await client
      .db(database)
      .collection(`${FOOD_MEDIA_BUCKET}.chunks`)
      .aggregate([
        {
          $lookup: {
            from: `${FOOD_MEDIA_BUCKET}.files`,
            localField: 'files_id',
            foreignField: '_id',
            as: 'file',
          },
        },
        { $match: { file: { $size: 0 } } },
      ])
      .toArray();
    expect(orphanChunks).toHaveLength(0);
  });
  it('stores files larger than 16 MiB and reads them from a fresh client', async () => {
    const large = new Uint8Array(17 * 1024 * 1024);
    large.set(bytes);
    const object = await store.put({
      ...command(),
      bytes: large,
      catalogResourceType: 'MENU_PACKAGE_VERSION',
    });
    const fresh = new MongoClient(uri!);
    try {
      const restored = await new GridFsFoodMediaStore(fresh, database).read(object);
      expect(restored !== null && Buffer.from(restored).equals(Buffer.from(large))).toBe(true);
    } finally {
      await fresh.close();
    }
  }, 30_000);
  it('rejects corrupt metadata and bytes rather than returning an unverified image', async () => {
    const object = await store.put(command());
    const collection = client.db(database).collection(`${FOOD_MEDIA_BUCKET}.files`);
    await collection.updateOne(
      { filename: object.objectKey },
      { $set: { 'metadata.sizeBytes': 99 } },
    );
    await expect(store.read(object)).rejects.toMatchObject({ status: 502 });
    await collection.updateOne(
      { filename: object.objectKey },
      { $set: { 'metadata.sizeBytes': bytes.length } },
    );
    const file = await collection.findOne({ filename: object.objectKey });
    await client
      .db(database)
      .collection(`${FOOD_MEDIA_BUCKET}.chunks`)
      .updateOne({ files_id: file!._id }, { $set: { data: Buffer.alloc(bytes.length) } });
    await expect(store.read(object)).rejects.toMatchObject({ status: 502 });
  });
  it('returns null for absent files and deletes idempotently', async () => {
    const input = command();
    const expected = createStoredObject(input);
    expect(await store.read(expected)).toBeNull();
    const object = await store.put(input);
    await store.delete(object);
    await store.delete(object);
    expect(await store.read(object)).toBeNull();
  });
  it('routes food images to real MongoDB and keeps private wedding images on disk', async () => {
    const root = await mkdtemp(join(tmpdir(), 'food-storage-routing-'));
    const options = { root, publicOrigin: 'https://api.example.test', signingKey: 'x'.repeat(32) };
    try {
      const provider = new MongoFoodStorageProvider(options, store);
      const food = await provider.put(command());
      await expect(new DiskStorageProvider(options).read(food)).rejects.toMatchObject({
        status: 404,
      });
      const signed = new URL(await provider.createSignedReadUrl(food));
      const query = Object.fromEntries(signed.searchParams.entries());
      expect((await provider.readSigned(food.objectKey, query)).bytes).toEqual(bytes);
      const privateImage = await provider.put({
        bytes,
        contentType: 'image/png',
        purpose: 'PRIVATE_WEDDING_MEDIA',
        resourceId: randomUUID(),
      });
      expect(await new DiskStorageProvider(options).read(privateImage)).toEqual(bytes);
      await provider.delete(food);
      expect(await store.read(food)).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('rehearses repeatable disk-to-Mongo migration and export with exact original bytes', async () => {
    const source = await mkdtemp(join(tmpdir(), 'food-migration-source-'));
    const target = await mkdtemp(join(tmpdir(), 'food-migration-export-'));
    const options = { publicOrigin: 'https://api.example.test', signingKey: 'x'.repeat(32) };
    try {
      const disk = new DiskStorageProvider({ ...options, root: source });
      const input = command();
      const object = await disk.put(input);
      async function* assets() {
        yield await Promise.resolve({
          ...object,
          resourceType: input.catalogResourceType,
          detachedAt: null,
        });
      }
      for (let repeat = 0; repeat < 2; repeat++)
        expect(
          await migrateFoodMedia({
            assets: assets(),
            disk,
            mongo: store,
            mode: 'copy-to-mongo',
            apply: true,
          }),
        ).toMatchObject({ written: 1, verified: 1 });
      const exported = new DiskStorageProvider({ ...options, root: target });
      expect(
        await migrateFoodMedia({
          assets: assets(),
          disk: exported,
          mongo: store,
          mode: 'export-to-disk',
          apply: true,
        }),
      ).toMatchObject({ verified: 1 });
      expect(await exported.read(object)).toEqual(bytes);
      expect(await disk.read(object)).toEqual(bytes);
    } finally {
      await Promise.all([source, target].map((root) => rm(root, { recursive: true, force: true })));
    }
  });
  it('refuses non-food uploads before writing any data', async () => {
    const input = {
      bytes,
      contentType: 'image/png' as const,
      purpose: 'VENUE_CATALOG_MEDIA' as const,
      resourceId: randomUUID(),
    };
    await expect(store.put(input)).rejects.toThrow(TypeError);
    await expect(
      store.put({ ...command(), purpose: 'PRIVATE_WEDDING_MEDIA' }),
    ).rejects.toMatchObject({ status: 422 });
  });
});
