import cors from 'cors';
import { type RequestHandler } from 'express';
import helmet from 'helmet';

import type { BackendConfig, RuntimeEnvironment } from '../../config/env.js';
import { CorsOriginDeniedError, RequestTimeoutError } from '../errors/app-error.js';
import { withRequestDeadline } from './request-deadline.js';

const CORS_ALLOWED_HEADERS = [
  'Authorization',
  'Content-Type',
  'Idempotency-Key',
  'X-Request-Id',
] as const;
const CORS_ALLOWED_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
const CORS_EXPOSED_HEADERS = ['Retry-After', 'X-Request-Id'] as const;

export const defaultHttpSecurityConfig: BackendConfig['security'] = Object.freeze({
  bodyLimitBytes: 1_048_576,
  requestTimeoutMs: 60_000,
  rateLimit: Object.freeze({ maxRequests: 100, windowMs: 60_000 }),
  replicaCount: 1,
});

export function createSecurityHeaders(runtimeEnvironment: RuntimeEnvironment): RequestHandler {
  const deployed = runtimeEnvironment === 'production' || runtimeEnvironment === 'staging';

  return helmet({
    strictTransportSecurity: deployed ? { includeSubDomains: true, maxAge: 31_536_000 } : false,
  });
}

export function createCorsMiddleware(config: BackendConfig['cors']): RequestHandler {
  const allowedOrigins = new Set(config.allowedOrigins);

  return cors({
    allowedHeaders: [...CORS_ALLOWED_HEADERS],
    credentials: true,
    exposedHeaders: [...CORS_EXPOSED_HEADERS],
    maxAge: 600,
    methods: [...CORS_ALLOWED_METHODS],
    origin(origin, callback) {
      if (origin === undefined || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new CorsOriginDeniedError());
    },
    optionsSuccessStatus: 204,
  });
}

export function createRequestDeadline(timeoutMs: number): RequestHandler {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('The request timeout must be a positive finite number.');
  }

  return (_request, response, next) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      if (!response.writableEnded) {
        controller.abort();
        next(new RequestTimeoutError());
      }
    }, timeoutMs);
    timeout.unref();

    const clearDeadline = (): void => clearTimeout(timeout);
    response.once('finish', clearDeadline);
    response.once('close', () => {
      clearDeadline();
      if (!response.writableEnded) controller.abort();
    });
    withRequestDeadline(
      { expiresAt: performance.now() + timeoutMs, signal: controller.signal },
      next,
    );
  };
}
