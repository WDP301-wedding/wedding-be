import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { NotificationCrypto } from './notification-crypto.js';
describe('notification AES-GCM', () => {
  it('authenticates scope, keeps plaintext absent and supports versioned key rotation', () => {
    const keys = new Map([
        ['v1', randomBytes(32)],
        ['v2', randomBytes(32)],
      ]),
      c = new NotificationCrypto('v1', keys),
      raw = { credential: 'secret', email: 'guest@example.test' };
    const encrypted = c.seal(raw, 'booking/purpose/intent');
    expect(encrypted).not.toContain('secret');
    expect(encrypted).not.toContain('example.test');
    expect(new NotificationCrypto('v2', keys).open(encrypted, 'booking/purpose/intent')).toEqual(
      raw,
    );
    expect(() => c.open(encrypted, 'other-booking/purpose/intent')).toThrow();
    expect(() =>
      new NotificationCrypto(null, new Map()).open(encrypted, 'booking/purpose/intent'),
    ).toThrow();
    expect(() => c.open('{}', 'scope')).toThrow();
  });
  it('fails closed on missing or malformed keys', () => {
    expect(() => new NotificationCrypto('v1', new Map())).toThrow();
    expect(() => new NotificationCrypto(null, new Map([['bad!', randomBytes(32)]]))).toThrow();
    expect(() => new NotificationCrypto(null, new Map([['v1', randomBytes(31)]]))).toThrow();
    expect(() => new NotificationCrypto(null, new Map()).seal('secret', 'scope')).toThrow();
  });
});
