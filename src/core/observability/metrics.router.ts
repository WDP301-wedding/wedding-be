import { createHash, timingSafeEqual } from 'node:crypto';

import { Router, type RequestHandler } from 'express';

import { AppError } from '../errors/app-error.js';
import type { ObservabilityMetrics } from './metrics.js';

export function createMetricsRouter(options: {
  readonly metrics: ObservabilityMetrics;
  readonly token: string;
}): Router {
  const router = Router();

  router.get(
    '/internal/metrics',
    requireMetricsToken(options.token),
    async (_request, response, next) => {
      try {
        response.setHeader('cache-control', 'no-store');
        response.setHeader('content-type', options.metrics.registry.contentType);
        response.send(await options.metrics.registry.metrics());
      } catch (error: unknown) {
        next(error);
      }
    },
  );

  return router;
}

function requireMetricsToken(expectedToken: string): RequestHandler {
  return (request, _response, next) => {
    const authorization = request.get('authorization');
    const match = authorization?.match(/^Bearer\s+(\S+)$/iu);

    if (match?.[1] === undefined || !tokensMatch(match[1], expectedToken)) {
      next(
        new AppError({
          status: 401,
          code: 'METRICS_UNAUTHORIZED',
          message: 'Valid metrics credentials are required.',
          headers: { 'WWW-Authenticate': 'Bearer realm="metrics"' },
        }),
      );
      return;
    }

    next();
  };
}

function tokensMatch(actualToken: string, expectedToken: string): boolean {
  const actualDigest = createHash('sha256').update(actualToken).digest();
  const expectedDigest = createHash('sha256').update(expectedToken).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}
