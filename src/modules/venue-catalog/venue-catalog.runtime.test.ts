import { createHash } from 'node:crypto';

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../../config/config.js';
import { createPrismaClient } from '../../core/database/prisma.js';
import { catalogIdempotencyPayload, createVenueCatalogRuntime } from './venue-catalog.runtime.js';

const prisma = vi.hoisted(() => ({
  $connect: vi.fn(() => Promise.resolve()),
  $disconnect: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../core/database/prisma.js', () => ({
  createPrismaClient: vi.fn(() => prisma),
}));

function runtimeConfig(storage: Config['storage'] = { enabled: false }): Config {
  return {
    database: { url: 'postgresql://test:test@127.0.0.1:5432/test', migrationUrl: undefined },
    storage,
  } as Config;
}

describe('VenueCatalogRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.$connect.mockResolvedValue();
    prisma.$disconnect.mockResolvedValue();
  });

  it('composes and closes the catalog runtime with local fake storage', async () => {
    const runtime = await createVenueCatalogRuntime(runtimeConfig());

    expect(runtime.router).toBeTypeOf('function');
    expect(runtime.resource.name).toBe('venue-catalog-database');
    expect(createPrismaClient).toHaveBeenCalledWith('postgresql://test:test@127.0.0.1:5432/test');
    await runtime.resource.close();
    expect(prisma.$disconnect).toHaveBeenCalledOnce();
  });

  it('composes Supabase storage when explicitly enabled', async () => {
    const runtime = await createVenueCatalogRuntime(
      runtimeConfig({
        enabled: true,
        supabaseUrl: 'https://storage.example.com',
        serviceRoleKey: 'test-service-role-key',
        bucket: 'catalog-media',
      }),
    );

    expect(runtime.router).toBeTypeOf('function');
    await runtime.resource.close();
  });

  it('disconnects the database when catalog composition fails', async () => {
    prisma.$connect.mockRejectedValueOnce(new Error('connection failed'));

    await expect(createVenueCatalogRuntime(runtimeConfig())).rejects.toThrow('connection failed');
    expect(prisma.$disconnect).toHaveBeenCalledOnce();
  });

  it('hashes multipart bytes into the idempotency payload without exposing them', () => {
    const base = { params: { id: 'one' }, query: { limit: '20' }, body: { field: 'value' } };
    expect(catalogIdempotencyPayload(base as unknown as Request)).toEqual(base);

    const payload = catalogIdempotencyPayload({
      ...base,
      file: {
        mimetype: 'image/png',
        size: 5,
        buffer: Buffer.from('image'),
      },
    } as unknown as Request);

    const checksumSha256 = createHash('sha256').update('image').digest('hex');
    expect(payload).toMatchObject({
      file: {
        contentType: 'image/png',
        sizeBytes: 5,
        checksumSha256,
      },
    });
    expect(payload).not.toHaveProperty('file.buffer');
  });
});
