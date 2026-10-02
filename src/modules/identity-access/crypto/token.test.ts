import { describe, expect, it } from 'vitest';

import {
  hashOpaqueToken,
  isCredentialExpired,
  issueOpaqueToken,
  verifyOpaqueToken,
  type OpaqueTokenPurpose,
} from './token.js';

const purposes = ['access', 'refresh', 'invitation', 'password-reset'] as const;
const prefixCases = [
  ['access', 'wia'],
  ['refresh', 'wir'],
  ['invitation', 'wii'],
  ['password-reset', 'wip'],
] as const satisfies readonly (readonly [OpaqueTokenPurpose, string])[];

describe('opaque token crypto', () => {
  it.each(purposes)(
    'issues unique high-entropy %s tokens and persists only their hashes',
    (purpose) => {
      const issued = Array.from({ length: 128 }, () => issueOpaqueToken(purpose, 32));

      expect(new Set(issued.map(({ token }) => token))).toHaveLength(128);
      expect(new Set(issued.map(({ tokenHash }) => tokenHash))).toHaveLength(128);
      for (const value of issued) {
        expect(value.tokenHash).not.toContain(value.token);
        expect(verifyOpaqueToken(value.token, value.tokenHash, purpose)).toBe(true);
      }
    },
  );

  it('separates deterministic hashes by credential purpose', () => {
    const token = issueOpaqueToken('access', 32).token;
    const hashes = purposes.map((purpose) => hashOpaqueToken(token, purpose));

    expect(new Set(hashes)).toHaveLength(purposes.length);
  });

  it('fails constant-time verification for the wrong token, purpose, or malformed hash', () => {
    const first = issueOpaqueToken('refresh', 32);
    const second = issueOpaqueToken('refresh', 32);

    expect(verifyOpaqueToken(second.token, first.tokenHash, 'refresh')).toBe(false);
    expect(verifyOpaqueToken(first.token, first.tokenHash, 'access')).toBe(false);
    expect(verifyOpaqueToken(first.token, 'not-base64url!', 'refresh')).toBe(false);
  });

  it.each(prefixCases)('uses a recognizable non-secret prefix for %s', (purpose, prefix) => {
    expect(issueOpaqueToken(purpose, 32).token).toMatch(
      new RegExp(`^${prefix}_[A-Za-z0-9_-]{43}$`, 'u'),
    );
  });

  it('treats the exact expiry instant as expired', () => {
    const expiresAt = new Date('2026-10-03T00:00:00.000Z');

    expect(isCredentialExpired(expiresAt, new Date('2026-10-02T23:59:59.999Z'))).toBe(false);
    expect(isCredentialExpired(expiresAt, new Date('2026-10-03T00:00:00.000Z'))).toBe(true);
    expect(isCredentialExpired(expiresAt, new Date('2026-10-03T00:00:00.001Z'))).toBe(true);
  });

  it('rejects entropy below the approved 32-byte boundary without leaking token material', () => {
    expect(() => issueOpaqueToken('access', 31)).toThrow('Invalid opaque token configuration.');
  });
});
