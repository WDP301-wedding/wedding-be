import { describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../core/errors/app-error.js';
import { migrateFoodMedia, type FoodMediaMigrationAsset } from './food-media-migration.js';
import { createStoredObject } from './storage-provider.js';

const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const command = {
  bytes,
  contentType: 'image/png' as const,
  purpose: 'VENUE_CATALOG_MEDIA' as const,
  resourceId: '984bd852-853b-4c21-82d1-e7f43c442a81',
  catalogResourceType: 'DISH_VERSION' as const,
};
const object = createStoredObject(command);
const asset = { ...object, resourceType: 'DISH_VERSION' as const, detachedAt: null };
async function* rows(value: FoodMediaMigrationAsset = asset) {
  yield await Promise.resolve(value);
}
function fixture() {
  const disk = {
    read: vi.fn(() => Promise.resolve(bytes)),
    put: vi.fn(() => Promise.resolve(object)),
    delete: vi.fn(),
    createSignedReadUrl: vi.fn(),
  };
  const mongo = {
    read: vi.fn<() => Promise<Uint8Array | null>>(() => Promise.resolve(bytes)),
    put: vi.fn(() => Promise.resolve(object)),
    delete: vi.fn(),
  };
  return { disk, mongo };
}
describe('non-destructive food image migration', () => {
  it('reconciles Mongo-only new images after restart without requiring a legacy disk copy', async () => {
    const f = fixture();
    f.disk.read.mockRejectedValue(new NotFoundError());
    expect(
      await migrateFoodMedia({ ...f, assets: rows(), mode: 'reconcile-to-mongo', apply: true }),
    ).toMatchObject({ verified: 1, written: 0 });
    expect(f.disk.read).not.toHaveBeenCalled();
    expect(f.mongo.put).not.toHaveBeenCalled();
    f.mongo.read.mockResolvedValueOnce(null);
    f.disk.read.mockResolvedValue(bytes);
    expect(
      await migrateFoodMedia({ ...f, assets: rows(), mode: 'reconcile-to-mongo', apply: true }),
    ).toMatchObject({ verified: 1, written: 1 });
  });
  it('defaults to a checksum-verified dry run without destination writes or source deletes', async () => {
    const f = fixture();
    expect(
      await migrateFoodMedia({ ...f, assets: rows(), mode: 'copy-to-mongo', apply: false }),
    ).toMatchObject({ examined: 1, written: 0, verified: 1, dryRun: true });
    expect(f.mongo.put).not.toHaveBeenCalled();
    expect(f.disk.delete).not.toHaveBeenCalled();
  });
  it('copies and reads back bytes before reporting success', async () => {
    const f = fixture();
    expect(
      await migrateFoodMedia({ ...f, assets: rows(), mode: 'copy-to-mongo', apply: true }),
    ).toMatchObject({ written: 1, verified: 1 });
    expect(f.mongo.put).toHaveBeenCalledWith(command);
    f.mongo.read.mockResolvedValueOnce(new Uint8Array([1]));
    await expect(
      migrateFoodMedia({ ...f, assets: rows(), mode: 'copy-to-mongo', apply: true }),
    ).rejects.toMatchObject({ status: 502 });
  });
  it('blocks active missing or mismatched files and reports missing detached originals', async () => {
    const f = fixture();
    f.disk.read.mockRejectedValue(new NotFoundError());
    await expect(
      migrateFoodMedia({ ...f, assets: rows(), mode: 'copy-to-mongo', apply: true }),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      await migrateFoodMedia({
        ...f,
        assets: rows({ ...asset, detachedAt: new Date() }),
        mode: 'copy-to-mongo',
        apply: true,
      }),
    ).toMatchObject({ missingDetached: 1, written: 0 });
    f.disk.read.mockResolvedValue(bytes);
    await expect(
      migrateFoodMedia({
        ...f,
        assets: rows({ ...asset, sizeBytes: 99 }),
        mode: 'copy-to-mongo',
        apply: true,
      }),
    ).rejects.toMatchObject({ status: 502 });
    expect(f.mongo.put).not.toHaveBeenCalled();
  });
  it('exports to disk for rollback and verifies without changing MongoDB', async () => {
    const f = fixture();
    expect(
      await migrateFoodMedia({ ...f, assets: rows(), mode: 'export-to-disk', apply: true }),
    ).toMatchObject({ written: 1 });
    expect(f.disk.put).toHaveBeenCalledWith(command);
    expect(f.mongo.delete).not.toHaveBeenCalled();
    f.disk.put.mockClear();
    expect(
      await migrateFoodMedia({ ...f, assets: rows(), mode: 'verify', apply: true }),
    ).toMatchObject({ written: 0, verified: 1 });
    expect(f.disk.put).not.toHaveBeenCalled();
  });
});
