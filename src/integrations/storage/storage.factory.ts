import type { BackendConfig } from '../../config/env.js';
import { DiskStorageProvider } from './disk-storage-provider.js';
import { createSupabaseStorageProvider } from './supabase-storage-provider.js';
import type { StorageProvider } from './storage-provider.js';

export function createStorageProvider(
  config: Extract<BackendConfig['storage'], { enabled: true }>,
): StorageProvider {
  return 'provider' in config
    ? new DiskStorageProvider(config)
    : createSupabaseStorageProvider(config);
}
