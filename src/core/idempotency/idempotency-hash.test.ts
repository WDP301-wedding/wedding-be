import { describe, expect, it } from 'vitest';

import {
  CanonicalRequestError,
  canonicalizeRequest,
  hashCanonicalRequest,
} from './request-hash.js';

describe('idempotency request hashing', () => {
  it('produces the same canonical SHA-256 hash regardless of object key order', () => {
    const first = {
      booking: { guestCount: 120, hallId: 'hall-1' },
      packages: [{ quantity: 12, packageId: 'menu-1' }],
    };
    const second = {
      packages: [{ packageId: 'menu-1', quantity: 12 }],
      booking: { hallId: 'hall-1', guestCount: 120 },
    };

    expect(canonicalizeRequest(first)).toBe(
      '{"booking":{"guestCount":120,"hallId":"hall-1"},"packages":[{"packageId":"menu-1","quantity":12}]}',
    );
    expect(hashCanonicalRequest(first)).toBe(hashCanonicalRequest(second));
    expect(hashCanonicalRequest({ b: 2, a: 1 })).toBe(
      '43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777',
    );
  });

  it('keeps array order and payload values significant', () => {
    expect(hashCanonicalRequest({ items: ['menu-1', 'menu-2'] })).not.toBe(
      hashCanonicalRequest({ items: ['menu-2', 'menu-1'] }),
    );
    expect(hashCanonicalRequest({ amount: 1_000 })).not.toBe(
      hashCanonicalRequest({ amount: '1000' }),
    );
  });

  it('canonicalizes every JSON scalar and null-prototype objects', () => {
    const nullPrototype = Object.create(null) as Record<string, unknown>;
    nullPrototype.enabled = true;
    nullPrototype.note = null;

    expect(canonicalizeRequest(null)).toBe('null');
    expect(canonicalizeRequest('intent')).toBe('"intent"');
    expect(canonicalizeRequest(true)).toBe('true');
    expect(canonicalizeRequest(-0)).toBe('0');
    expect(canonicalizeRequest(nullPrototype)).toBe('{"enabled":true,"note":null}');
  });

  it.each([
    ['undefined', undefined],
    ['a non-finite number', Number.POSITIVE_INFINITY],
    ['a bigint', 1n],
    ['a Date object', new Date('2026-09-29T00:00:00.000Z')],
    ['an object containing undefined', { amount: undefined }],
  ])('rejects %s because it is not an unambiguous JSON payload', (_label, value) => {
    expect(() => hashCanonicalRequest(value)).toThrow(CanonicalRequestError);
  });

  it('rejects cyclic request payloads', () => {
    const payload: { self?: unknown } = {};
    payload.self = payload;

    expect(() => canonicalizeRequest(payload)).toThrow(CanonicalRequestError);
  });

  it('rejects sparse arrays and symbol properties instead of omitting them', () => {
    const sparse = new Array<unknown>(1);
    const symbolProperty = { amount: 1 };
    Object.assign(symbolProperty, { [Symbol('hidden')]: 'not-json' });

    expect(() => canonicalizeRequest(sparse)).toThrow(CanonicalRequestError);
    expect(() => canonicalizeRequest(symbolProperty)).toThrow(CanonicalRequestError);
  });
});
