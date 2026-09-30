import type { Request } from 'express';
import { describe, expect, it } from 'vitest';

import {
  classifyIdempotencyResponse,
  createIdempotencyNamespace,
  DEFAULT_IDEMPOTENCY_RETRY_AFTER_SECONDS,
  defineIdempotencyPolicy,
  readIdempotencyKey,
} from './idempotency.policy.js';

function requestWithIdempotencyHeaders(
  rawHeaders: readonly string[],
  value?: string | readonly string[],
): Request {
  return {
    rawHeaders,
    headers: value === undefined ? {} : { 'idempotency-key': value },
  } as unknown as Request;
}

describe('idempotency HTTP policy', () => {
  it('defines an immutable policy with safe defaults', () => {
    const actorScope = () => 'user:user-1';
    const payload = () => ({ amountMinor: 5_000_000 });

    const policy = defineIdempotencyPolicy({
      actorScope,
      normalizedRoute: '/api/v1/bookings',
      operationVersion: 'v1',
      payload,
    });

    expect(policy.payload).toBe(payload);
    expect(policy.retryAfterSeconds).toBe(DEFAULT_IDEMPOTENCY_RETRY_AFTER_SECONDS);
    expect(policy.namespace({ method: 'post' } as Request)).toBe(
      'actor=user%3Auser-1|method=POST|route=%2Fapi%2Fv1%2Fbookings|version=v1',
    );
    expect(Object.isFrozen(policy)).toBe(true);
  });

  it('preserves explicit retention and retry policy', () => {
    const policy = defineIdempotencyPolicy({
      actorScope: () => 'user:user-1',
      normalizedRoute: '/api/v1/payments',
      operationVersion: 'v2',
      payload: () => ({}),
      retentionMs: 60_000,
      retryAfterSeconds: 7,
    });

    expect(policy).toMatchObject({ retentionMs: 60_000, retryAfterSeconds: 7 });
  });

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY])(
    'rejects an invalid Retry-After value of %s',
    (retryAfterSeconds) => {
      expect(() =>
        defineIdempotencyPolicy({
          actorScope: () => 'user:user-1',
          normalizedRoute: '/api/v1/bookings',
          operationVersion: 'v1',
          payload: () => ({}),
          retryAfterSeconds,
        }),
      ).toThrow(RangeError);
    },
  );

  it('builds collision-safe namespaces from the actor, method, route, and version', () => {
    expect(
      createIdempotencyNamespace({
        actorScope: 'guest:household|42',
        method: 'post',
        normalizedRoute: '/api/v1/bookings/:bookingId/payments',
        operationVersion: 'v1.1',
      }),
    ).toBe(
      'actor=guest%3Ahousehold%7C42|method=POST|route=%2Fapi%2Fv1%2Fbookings%2F%3AbookingId%2Fpayments|version=v1.1',
    );
  });

  it.each([
    [{ actorScope: '', method: 'POST', normalizedRoute: '/bookings', operationVersion: 'v1' }],
    [
      {
        actorScope: 'user:1',
        method: 'P0ST',
        normalizedRoute: '/bookings',
        operationVersion: 'v1',
      },
    ],
    [{ actorScope: 'user:1', method: 'POST', normalizedRoute: 'bookings', operationVersion: 'v1' }],
    [
      {
        actorScope: 'user:1',
        method: 'POST',
        normalizedRoute: '/bookings?x=1',
        operationVersion: 'v1',
      },
    ],
    [
      {
        actorScope: 'user:1',
        method: 'POST',
        normalizedRoute: '/bookings with spaces',
        operationVersion: 'v1',
      },
    ],
    [
      {
        actorScope: 'user:1',
        method: 'POST',
        normalizedRoute: '/bookings',
        operationVersion: 'v 1',
      },
    ],
  ])('rejects invalid namespace parts', (input) => {
    expect(() => createIdempotencyNamespace(input)).toThrow(RangeError);
  });

  it('distinguishes missing, malformed, duplicate, and valid header values', () => {
    expect(readIdempotencyKey(requestWithIdempotencyHeaders([]))).toEqual({
      outcome: 'MISSING',
    });
    expect(
      readIdempotencyKey(
        requestWithIdempotencyHeaders(['Idempotency-Key', 'a'.repeat(129)], 'a'.repeat(129)),
      ),
    ).toEqual({ outcome: 'INVALID' });
    expect(
      readIdempotencyKey(
        requestWithIdempotencyHeaders(
          ['Idempotency-Key', 'intent-1', 'idempotency-key', 'intent-2'],
          'intent-1, intent-2',
        ),
      ),
    ).toEqual({ outcome: 'INVALID' });
    expect(
      readIdempotencyKey(
        requestWithIdempotencyHeaders(['Idempotency-Key', 'intent-1'], 'intent-1'),
      ),
    ).toEqual({ outcome: 'VALID', key: 'intent-1' });
  });

  it.each([
    [199, 'UNKNOWN'],
    [200, 'SUCCEEDED'],
    [299, 'SUCCEEDED'],
    [300, 'UNKNOWN'],
    [399, 'UNKNOWN'],
    [400, 'FAILED'],
    [499, 'FAILED'],
    [500, 'UNKNOWN'],
  ] as const)('classifies HTTP %s as %s', (status, expected) => {
    expect(classifyIdempotencyResponse(status)).toBe(expected);
  });
});
