import type { Request, Response } from 'express';

import { isValidIdempotencyKey } from './idempotency.service.js';

export const DEFAULT_IDEMPOTENCY_RETRY_AFTER_SECONDS = 1;

export interface IdempotencyPolicy {
  readonly namespace: (request: Request) => string;
  readonly payload: (request: Request, response: Response) => unknown;
  readonly retentionMs?: number;
  readonly retryAfterSeconds: number;
}

export interface DefineIdempotencyPolicyInput {
  /** Derive this only from authenticated or otherwise trusted request context. */
  readonly actorScope: (request: Request) => string;
  readonly normalizedRoute: string;
  readonly operationVersion: string;
  readonly payload: (request: Request, response: Response) => unknown;
  readonly retentionMs?: number;
  readonly retryAfterSeconds?: number;
}

export type IdempotencyHeaderResult =
  | Readonly<{ outcome: 'MISSING' }>
  | Readonly<{ outcome: 'INVALID' }>
  | Readonly<{ outcome: 'VALID'; key: string }>;

export type IdempotencyResponseDisposition = 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';

export interface IdempotencyNamespaceInput {
  readonly actorScope: string;
  readonly method: string;
  readonly normalizedRoute: string;
  readonly operationVersion: string;
}

export function createIdempotencyNamespace(input: IdempotencyNamespaceInput): string {
  const actorScope = input.actorScope.trim();
  const method = input.method.trim().toUpperCase();
  const normalizedRoute = input.normalizedRoute.trim();
  const operationVersion = input.operationVersion.trim();

  if (
    actorScope === '' ||
    !/^[A-Z]+$/.test(method) ||
    !/^\/[^\s?#]*$/.test(normalizedRoute) ||
    !/^[A-Za-z0-9._-]+$/.test(operationVersion)
  ) {
    throw new RangeError('The idempotency namespace policy is invalid.');
  }

  return [
    `actor=${encodeURIComponent(actorScope)}`,
    `method=${method}`,
    `route=${encodeURIComponent(normalizedRoute)}`,
    `version=${encodeURIComponent(operationVersion)}`,
  ].join('|');
}

export function defineIdempotencyPolicy(input: DefineIdempotencyPolicyInput): IdempotencyPolicy {
  const retryAfterSeconds = input.retryAfterSeconds ?? DEFAULT_IDEMPOTENCY_RETRY_AFTER_SECONDS;

  if (!Number.isInteger(retryAfterSeconds) || retryAfterSeconds <= 0) {
    throw new RangeError('Retry-After must be a positive integer number of seconds.');
  }

  createIdempotencyNamespace({
    actorScope: 'configuration-check',
    method: 'POST',
    normalizedRoute: input.normalizedRoute,
    operationVersion: input.operationVersion,
  });

  return Object.freeze({
    namespace: (request: Request) =>
      createIdempotencyNamespace({
        actorScope: input.actorScope(request),
        method: request.method,
        normalizedRoute: input.normalizedRoute,
        operationVersion: input.operationVersion,
      }),
    payload: input.payload,
    ...(input.retentionMs === undefined ? {} : { retentionMs: input.retentionMs }),
    retryAfterSeconds,
  });
}

export function readIdempotencyKey(request: Request): IdempotencyHeaderResult {
  const headerCount = request.rawHeaders.reduce((count, header, index) => {
    if (index % 2 === 0 && header.toLowerCase() === 'idempotency-key') {
      return count + 1;
    }

    return count;
  }, 0);
  const value = request.headers['idempotency-key'];

  if (headerCount === 0 || value === undefined) {
    return { outcome: 'MISSING' };
  }

  if (headerCount !== 1 || typeof value !== 'string' || !isValidIdempotencyKey(value)) {
    return { outcome: 'INVALID' };
  }

  return { outcome: 'VALID', key: value };
}

export function classifyIdempotencyResponse(status: number): IdempotencyResponseDisposition {
  if (status >= 200 && status <= 299) {
    return 'SUCCEEDED';
  }

  if (status >= 400 && status <= 499) {
    return 'FAILED';
  }

  return 'UNKNOWN';
}
