import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentRequestDeadline, type RequestDeadline } from './request-deadline.js';

import { createRequestDeadline, defaultHttpSecurityConfig } from './security.js';

describe('HTTP security configuration', () => {
  afterEach(() => vi.useRealTimers());
  it('keeps conservative process-local defaults immutable', () => {
    expect(defaultHttpSecurityConfig).toEqual({
      bodyLimitBytes: 1_048_576,
      requestTimeoutMs: 60_000,
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
  it.each(['finish', 'close'] as const)(
    'clears the timer on %s and scopes cancellation to the request',
    (event) => {
      vi.useFakeTimers();
      const response = Object.assign(new EventEmitter(), { writableEnded: event === 'finish' });
      let deadline: RequestDeadline | undefined;
      const next = vi.fn(() => {
        deadline = currentRequestDeadline();
      });
      createRequestDeadline(100)({} as Request, response as unknown as Response, next);
      expect(deadline).toBeDefined();
      expect(currentRequestDeadline()).toBeUndefined();
      response.emit(event);
      vi.advanceTimersByTime(200);
      expect(next).toHaveBeenCalledTimes(1);
      expect(deadline!.signal.aborted).toBe(event === 'close');
    },
  );
  it('marks the scope aborted before forwarding the existing timeout error', () => {
    vi.useFakeTimers();
    const response = Object.assign(new EventEmitter(), { writableEnded: false });
    let deadline: RequestDeadline | undefined;
    const next = vi.fn(() => {
      deadline = currentRequestDeadline() ?? deadline;
    });
    createRequestDeadline(100)({} as Request, response as unknown as Response, next);
    vi.advanceTimersByTime(100);
    expect(deadline!.signal.aborted).toBe(true);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'REQUEST_TIMEOUT' }));
  });
});
