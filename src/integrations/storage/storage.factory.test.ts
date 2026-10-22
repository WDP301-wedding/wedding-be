import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createStorageProvider } from './storage.factory.js';
import { DiskStorageProvider } from './disk-storage-provider.js';
import { SupabaseStorageProvider } from './supabase-storage-provider.js';
import { parseEnvironment } from '../../config/env.js';
import { createRuntimeFeatureManifest } from '../../config/runtime-manifest.js';

describe('configured storage provider', () => {
  it('selects persistent disk without exposing its key in the manifest', () => {
    const config = parseEnvironment({
      STORAGE_DRIVER: 'render-disk',
      STORAGE_DISK_PATH: tmpdir(),
      STORAGE_PUBLIC_ORIGIN: 'https://api.example.test',
      STORAGE_SIGNING_KEY: 'private-sentinel-at-least-32-bytes',
    });
    if (!config.storage.enabled) throw new Error('Expected enabled storage');
    expect(createStorageProvider(config.storage)).toBeInstanceOf(DiskStorageProvider);
    const manifest = createRuntimeFeatureManifest(config);
    expect(manifest.features.catalogStorage.mode).toBe('render-disk');
    expect(manifest.features.invitationStorage.mode).toBe('render-disk');
    expect(JSON.stringify(manifest)).not.toContain('private-sentinel');
  });
  it('keeps existing Supabase configuration compatible', () => {
    expect(
      createStorageProvider({
        enabled: true,
        supabaseUrl: 'https://storage.example.test',
        serviceRoleKey: 'test-key',
        bucket: 'private-media',
      }),
    ).toBeInstanceOf(SupabaseStorageProvider);
  });
});
