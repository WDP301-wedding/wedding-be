import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ValidationError } from '../../../core/errors/app-error.js';

export interface CredentialBinding {
  intentId: string;
  bookingId: string | null;
  purpose: string;
}
export interface SealedCredential {
  keyVersion: string;
  nonce: string;
  tag: string;
  ciphertext: string;
  expiresAt: Date;
}

export class CredentialCipher {
  private readonly keys = new Map<string, Buffer>();
  constructor(
    keys: Readonly<Record<string, string>>,
    readonly activeVersion: string,
    readonly now: () => Date = () => new Date(),
  ) {
    for (const [version, value] of Object.entries(keys)) {
      const key = Buffer.from(value, 'base64');
      if (
        !/^[A-Za-z0-9_-]{1,40}$/u.test(version) ||
        key.length !== 32 ||
        key.toString('base64') !== value
      )
        throw new ValidationError();
      this.keys.set(version, key);
    }
    if (!this.keys.has(activeVersion)) throw new ValidationError();
  }
  seal(credential: string, tokenExpiry: Date, binding: CredentialBinding): SealedCredential {
    const now = this.now();
    if (
      !credential ||
      Buffer.byteLength(credential) > 1024 ||
      !Number.isFinite(tokenExpiry.getTime()) ||
      tokenExpiry <= now
    )
      throw new ValidationError();
    const nonce = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', this.keys.get(this.activeVersion)!, nonce);
    const expiresAt = new Date(Math.min(tokenExpiry.getTime(), now.getTime() + 72 * 3600000));
    cipher.setAAD(this.aad(binding, this.activeVersion, expiresAt));
    return {
      keyVersion: this.activeVersion,
      nonce: nonce.toString('base64'),
      ciphertext: Buffer.concat([cipher.update(credential, 'utf8'), cipher.final()]).toString(
        'base64',
      ),
      tag: cipher.getAuthTag().toString('base64'),
      expiresAt,
    };
  }
  open(sealed: SealedCredential, binding: CredentialBinding): string {
    try {
      const key = this.keys.get(sealed.keyVersion),
        nonce = Buffer.from(sealed.nonce, 'base64'),
        tag = Buffer.from(sealed.tag, 'base64');
      if (
        !key ||
        !Number.isFinite(sealed.expiresAt.getTime()) ||
        sealed.expiresAt <= this.now() ||
        nonce.length !== 12 ||
        tag.length !== 16
      )
        throw new ValidationError();
      const decipher = createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAAD(this.aad(binding, sealed.keyVersion, sealed.expiresAt));
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new ValidationError();
    }
  }
  private aad(binding: CredentialBinding, keyVersion: string, expiresAt: Date) {
    return Buffer.from(
      JSON.stringify([
        'notification-credential-v1',
        binding.bookingId,
        binding.purpose,
        binding.intentId,
        keyVersion,
        expiresAt.toISOString(),
      ]),
    );
  }
}
