import { createHash } from 'node:crypto';

/** UUIDv5 in the fixed Notifications namespace; names are canonical scheduling keys. */
export function scheduledId(value: unknown) {
  const namespace = Buffer.from('b7784df5ad9055c9883a46ff06d35bc3', 'hex');
  const bytes = createHash('sha1')
    .update(namespace)
    .update(JSON.stringify(value))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
