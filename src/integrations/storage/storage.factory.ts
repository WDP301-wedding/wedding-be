import type { BackendConfig } from '../../config/env.js';
import { DiskStorageProvider } from './disk-storage-provider.js';
import type { StorageProvider } from './storage-provider.js';

export function createStorageProvider(
  config: Extract<BackendConfig['storage'], { enabled: true }>,
): StorageProvider {
  return new DiskStorageProvider(config);
}
