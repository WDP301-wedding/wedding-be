// Operator-only, additive transfer. Existing objects are verified, never overwritten.
// Run on the live service so /var/data is the attached disk, not a build filesystem.
import { StorageClient } from '@supabase/storage-js';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DiskStorageProvider } from '../dist/integrations/storage/disk-storage-provider.js';

if (process.env.STORAGE_IMPORT_FROM_SUPABASE !== 'true') {
  throw new Error('Explicit storage import flag is required.');
}
const root = process.env.STORAGE_DISK_PATH;
if (
  !root ||
  !process.env.SUPABASE_URL ||
  !process.env.SUPABASE_SERVICE_ROLE_KEY ||
  !process.env.SUPABASE_STORAGE_BUCKET
) {
  throw new Error('Storage transfer configuration is incomplete.');
}
const destination = new DiskStorageProvider({
  root,
  publicOrigin: process.env.STORAGE_PUBLIC_ORIGIN,
  signingKey: process.env.STORAGE_SIGNING_KEY,
});
const source = new StorageClient(`${process.env.SUPABASE_URL}/storage/v1`, {
  apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
}).from(process.env.SUPABASE_STORAGE_BUCKET);
const queue = ['private-wedding-media', 'venue-catalog-media'];
const transferred = [];
while (queue.length) {
  const prefix = queue.shift();
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await source.list(prefix, {
      limit: 100,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error || !data) throw new Error('Source inventory failed.');
    for (const entry of data) {
      const key = `${prefix}/${entry.name}`;
      if (!entry.id) {
        queue.push(key);
        continue;
      }
      const match =
        /^(private-wedding-media|venue-catalog-media)\/([0-9a-f-]{36})\/([a-f0-9]{64})\.(jpg|png|webp)$/u.exec(
          key,
        );
      if (!match) throw new Error('Unexpected source key; refusing incomplete migration.');
      const file = await source.download(key);
      if (file.error || !file.data) throw new Error('Source download failed.');
      const bytes = new Uint8Array(await file.data.arrayBuffer());
      const checksum = createHash('sha256').update(bytes).digest('hex');
      if (checksum !== match[3]) throw new Error('Source checksum does not match content key.');
      const object = await destination.put({
        bytes,
        contentType: { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[match[4]],
        purpose:
          match[1] === 'private-wedding-media' ? 'PRIVATE_WEDDING_MEDIA' : 'VENUE_CATALOG_MEDIA',
        resourceId: match[2],
      });
      if (object.objectKey !== key) throw new Error('Destination key mismatch.');
      const readBack = await destination.read(object);
      if (createHash('sha256').update(readBack).digest('hex') !== checksum)
        throw new Error('Destination checksum mismatch.');
      transferred.push({ key, checksum, bytes: bytes.length });
    }
    if (data.length < 100) break;
  }
}
transferred.sort((a, b) => a.key.localeCompare(b.key));
const receipt = {
  completedAt: new Date().toISOString(),
  objects: transferred,
  count: transferred.length,
  bytes: transferred.reduce((sum, item) => sum + item.bytes, 0),
  inventorySha256: createHash('sha256').update(JSON.stringify(transferred)).digest('hex'),
};
await writeFile(join(root, 'migration-receipt.json'), JSON.stringify(receipt, null, 2), {
  mode: 0o600,
});
console.log(
  JSON.stringify({
    event: 'storage-transfer-verified',
    count: receipt.count,
    bytes: receipt.bytes,
    inventorySha256: receipt.inventorySha256,
  }),
);
