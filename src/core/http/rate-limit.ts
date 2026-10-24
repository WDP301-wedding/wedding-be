import { type Request, type RequestHandler } from 'express';
import rateLimit, { type RateLimitInfo } from 'express-rate-limit';
import RedisStore, { type RedisReply } from 'rate-limit-redis';
import type { Redis } from 'ioredis';

import type { BackendConfig } from '../../config/env.js';
import { RateLimitError } from '../errors/app-error.js';

type RateLimitedRequest = Request & { readonly rateLimit: RateLimitInfo };

export function createGeneralRateLimit(
  config: BackendConfig['security']['rateLimit'],
  redisClient?: Redis | null,
  /** Stable namespace that isolates this limiter's Redis keys from all others.
   *  Use a short, lowercase, hyphen-separated identifier (e.g. 'general', 'otp',
   *  'settings', 'experience').  Defaults to 'general' for the app-wide limiter.
   */
  namespace = 'general',
): RequestHandler {
  const store = redisClient
    ? new RedisStore({
        sendCommand: (cmd: string, ...args: string[]) =>
          redisClient.call(cmd, ...args) as Promise<RedisReply>,
        // Each namespace gets its own key space: rl:<namespace>:<ip>
        prefix: `rl:${namespace}:`,
      })
    : undefined;

  return rateLimit({
    ...(store !== undefined ? { store } : {}),
    handler(request, _response, next) {
      next(new RateLimitError(retryAfterSeconds(request as RateLimitedRequest, config.windowMs)));
    },
    legacyHeaders: false,
    limit: config.maxRequests,
    standardHeaders: 'draft-8',
    windowMs: config.windowMs,
  });
}

function retryAfterSeconds(request: RateLimitedRequest, defaultWindowMs: number): number {
  if (request.rateLimit?.resetTime) {
    return Math.max(1, Math.ceil((request.rateLimit.resetTime.getTime() - Date.now()) / 1_000));
  }
  return Math.max(1, Math.ceil(defaultWindowMs / 1_000));
}
