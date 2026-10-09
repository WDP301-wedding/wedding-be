import { vi } from 'vitest';
import {
  SupabaseStorageProvider,
  type SupabaseStorageClientLike,
} from '../../../src/integrations/storage/supabase-storage-provider.js';

/** Controlled SDK boundary, NOT live Supabase evidence. Executes the production
 * Storage adapter's upload/info/duplicate/signed-path validation without network. */
export function controlledStorage() {
  const objects = new Map<
    string,
    { bytes: Uint8Array; contentType: string; metadata: Readonly<Record<string, string | number>> }
  >();
  const bucket = {
    download: vi.fn((key: string) => {
      const object = objects.get(key);
      return Promise.resolve(
        object === undefined
          ? { data: null, error: { statusCode: '404' } }
          : {
              data: new Blob([Uint8Array.from(object.bytes)], { type: object.contentType }),
              error: null,
            },
      );
    }),
    upload: vi.fn(
      (
        key: string,
        bytes: Uint8Array,
        options: Parameters<ReturnType<SupabaseStorageClientLike['from']>['upload']>[2],
      ) => {
        if (objects.has(key)) return Promise.resolve({ data: null, error: { statusCode: '409' } });
        objects.set(key, {
          bytes: bytes.slice(),
          contentType: options.contentType,
          metadata: options.metadata,
        });
        return Promise.resolve({ data: { path: key }, error: null });
      },
    ),
    info: vi.fn((key: string) => {
      const object = objects.get(key);
      return Promise.resolve(
        object === undefined
          ? { data: null, error: { statusCode: '404' } }
          : {
              data: {
                contentType: object.contentType,
                size: object.bytes.byteLength,
                metadata: object.metadata,
              },
              error: null,
            },
      );
    }),
    createSignedUrl: vi.fn((key: string, ttl: number) =>
      Promise.resolve({
        data: {
          signedUrl: `https://project.supabase.co/storage/v1/object/sign/wedding-private/${key}?token=test-${ttl}`,
        },
        error: null,
      }),
    ),
    remove: vi.fn(() => Promise.resolve({ data: [], error: null })),
  } satisfies ReturnType<SupabaseStorageClientLike['from']>;
  return {
    objects,
    bucket,
    provider: new SupabaseStorageProvider({
      bucket: 'wedding-private',
      providerOrigin: 'https://project.supabase.co',
      client: { from: () => bucket },
    }),
  };
}
