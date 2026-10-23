import type { Redis } from 'ioredis';
import type { AttemptThrottle } from '../../modules/identity-access/session/session.service.js';
import type { Logger } from 'pino';

const ATOMIC_THROTTLE_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { current, ttl }
`;

export interface RedisAttemptThrottleOptions {
  readonly client: Redis;
  readonly prefix?: string;
  readonly logger?: Logger;
  readonly failClosedOnOutage?: boolean;
}

export function createRedisAttemptThrottle(options: RedisAttemptThrottleOptions): AttemptThrottle {
  const { client, prefix = 'auth_throttle', logger, failClosedOnOutage = true } = options;

  return Object.freeze({
    async consume(input) {
      const key = `${prefix}:${input.bucket}:${input.key}`;
      const windowSec = Math.max(1, Math.ceil(input.windowSeconds));

      try {
        const result = (await client.eval(ATOMIC_THROTTLE_LUA, 1, key, windowSec.toString())) as [
          number,
          number,
        ];

        const [count, ttl] = result;
        const allowed = count <= input.maxAttempts;
        const retryAfterSeconds = Math.max(1, ttl);

        return Object.freeze({
          allowed,
          retryAfterSeconds,
        });
      } catch (error) {
        logger?.error(
          { err: error, bucket: input.bucket, key: input.key },
          'Redis attempt throttle operation failed.',
        );

        if (failClosedOnOutage) {
          // Security policy: fail-closed on security-critical throttles during Redis outage
          return Object.freeze({
            allowed: false,
            retryAfterSeconds: windowSec,
          });
        }

        // If explicitly permitted to fail-open (non-critical):
        return Object.freeze({
          allowed: true,
          retryAfterSeconds: 0,
        });
      }
    },
  });
}
