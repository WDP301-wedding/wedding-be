import { describe, expect, it } from 'vitest';

import { createRequestDeadline, defaultHttpSecurityConfig } from './security.js';

describe('HTTP security configuration', () => {
  it('keeps conservative process-local defaults immutable', () => {
    expect(defaultHttpSecurityConfig).toEqual({
      bodyLimitBytes: 1_048_576,
      requestTimeoutMs: 30_000,
      rateLimit: { maxRequests: 100, windowMs: 60_000 },
      replicaCount: 1,
    });
    expect(Object.isFrozen(defaultHttpSecurityConfig)).toBe(true);
    expect(Object.isFrozen(defaultHttpSecurityConfig.rateLimit)).toBe(true);
  });

  it.each([0, -1, Number.POSITIVE_INFINITY, Number.NaN])(
    'rejects the invalid request deadline %s',
    (timeoutMs) => {
      expect(() => createRequestDeadline(timeoutMs)).toThrow(RangeError);
    },
  );
});
