import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { ProviderError } from '../../../core/errors/app-error.js';

const sealedSchema = z.strictObject({
  keyVersion: z.string().min(1),
  iv: z.string(),
  tag: z.string(),
  body: z.string(),
});
export class NotificationCrypto {
  constructor(
    readonly activeVersion: string | null,
    private readonly keys: ReadonlyMap<string, Buffer>,
  ) {
    if (activeVersion !== null && !keys.has(activeVersion))
      throw new TypeError('Notification active encryption key is missing.');
    for (const [version, key] of keys)
      if (!/^[a-zA-Z0-9_-]{1,40}$/u.test(version) || key.length !== 32)
        throw new TypeError('Invalid notification encryption key.');
  }
  seal(value: unknown, aad: string): string {
    if (this.activeVersion === null) throw new ProviderError('unavailable');
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', this.keys.get(this.activeVersion)!, iv);
    cipher.setAAD(Buffer.from(aad));
    const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return JSON.stringify({
      keyVersion: this.activeVersion,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      body: body.toString('base64'),
    });
  }
  open(value: string, aad: string): unknown {
    const sealed = sealedSchema.parse(JSON.parse(value)),
      key = this.keys.get(sealed.keyVersion);
    if (key === undefined) throw new ProviderError('unavailable');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(sealed.body, 'base64')),
        decipher.final(),
      ]).toString('utf8'),
    ) as unknown;
  }
}
