import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CredentialCipher } from './credential-cipher.js';

describe('purpose-bound transient notification credentials', () => {
  const key = randomBytes(32).toString('base64');
  const now = new Date('2026-10-12T00:00:00Z');
  const context = () => ({
    intentId: randomUUID(),
    bookingId: randomUUID(),
    purpose: 'GUEST_INVITATION',
  });
  it('authenticates booking, purpose and intent and does not retain plaintext', () => {
    const c = new CredentialCipher({ v1: key }, 'v1', () => now),
      bound = context();
    const encrypted = c.seal('wgc_private-credential', new Date('2027-01-01T00:00:00Z'), bound);
    expect(JSON.stringify(encrypted)).not.toContain('wgc_private-credential');
    expect(encrypted.expiresAt.toISOString()).toBe('2026-10-15T00:00:00.000Z');
    expect(c.open(encrypted, bound)).toBe('wgc_private-credential');
    expect(() => c.open(encrypted, { ...bound, bookingId: randomUUID() })).toThrow();
    expect(() => c.open(encrypted, { ...bound, purpose: 'PASSWORD_OTP' })).toThrow();
    expect(() =>
      c.open({ ...encrypted, expiresAt: new Date('2026-10-16T00:00:00Z') }, bound),
    ).toThrow();
    expect(() =>
      c.open({ ...encrypted, ciphertext: encrypted.ciphertext.slice(0, -4) + 'AAAA' }, bound),
    ).toThrow();
  });
  it('uses the earlier token expiry and refuses an expired credential', () => {
    const c = new CredentialCipher({ v1: key }, 'v1', () => now),
      bound = context();
    const expiresAt = new Date(now.getTime() + 60_000),
      encrypted = c.seal('short-token', expiresAt, bound);
    expect(encrypted.expiresAt).toEqual(expiresAt);
    const later = new CredentialCipher({ v1: key }, 'v1', () => expiresAt);
    expect(() => later.open(encrypted, bound)).toThrow();
    expect(() => c.seal('expired', now, bound)).toThrow();
  });
  it('supports key rotation while rejecting unknown key versions and invalid keys', () => {
    const bound = context(),
      old = new CredentialCipher({ v1: key }, 'v1', () => now);
    const encrypted = old.seal('rotated-token', new Date(now.getTime() + 60_000), bound);
    const next = new CredentialCipher(
      { v1: key, v2: randomBytes(32).toString('base64') },
      'v2',
      () => now,
    );
    expect(next.open(encrypted, bound)).toBe('rotated-token');
    expect(() => next.open({ ...encrypted, keyVersion: 'missing' }, bound)).toThrow();
    expect(() => new CredentialCipher({ v1: 'invalid' }, 'v1')).toThrow();
  });
});
