import { type Request, type RequestHandler } from 'express';
import rateLimit, { type RateLimitInfo } from 'express-rate-limit';

import type { BackendConfig } from '../../config/env.js';
import { RateLimitError } from '../errors/app-error.js';

type RateLimitedRequest = Request & { readonly rateLimit: RateLimitInfo };

export function createGeneralRateLimit(
  config: BackendConfig['security']['rateLimit'],
): RequestHandler {
  return rateLimit({
    handler(request, _response, next) {
      next(new RateLimitError(retryAfterSeconds(request as RateLimitedRequest)));
    },
    legacyHeaders: false,
    limit: config.maxRequests,
    standardHeaders: 'draft-8',
    windowMs: config.windowMs,
  });
}

function retryAfterSeconds(request: RateLimitedRequest): number {
  // This baseline intentionally uses express-rate-limit's in-process MemoryStore,
  // which always supplies the reset time used for its standard headers.
  return Math.max(1, Math.ceil((request.rateLimit.resetTime!.getTime() - Date.now()) / 1_000));
}
