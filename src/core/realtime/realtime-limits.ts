import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';

const connectionTtlMs = 30_000;
const connectionScript = `
local clock = redis.call('TIME')
local now = tonumber(clock[1])*1000 + math.floor(tonumber(clock[2])/1000)
for i=1,2 do redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', now) end
for i=1,2 do
  if not redis.call('ZSCORE', KEYS[i], ARGV[1]) and redis.call('ZCARD', KEYS[i]) >= tonumber(ARGV[i+1]) then return 0 end
end
for i=1,2 do
  redis.call('ZADD', KEYS[i], now+tonumber(ARGV[4]), ARGV[1])
  redis.call('PEXPIRE', KEYS[i], ARGV[4])
end
return 1`;

/** Cross-node reservations expire if a process dies; local mode is development only. */
export function createRealtimeLimits(redis: Redis | null, environment: string) {
  const prefix = `rt:{${environment}:realtime}:limits:`;
  const local = new Map<string, Map<string, number>>();
  const messages = new Map<string, { count: number; resetAt: number }>();
  const keys = (ip: string, accountId: string) => [
    prefix + 'ip:' + createHash('sha256').update(ip).digest('hex'),
    prefix + 'account:' + accountId,
  ];
  return {
    async reserve(ip: string, accountId: string, socketId: string): Promise<boolean> {
      const pair = keys(ip, accountId);
      const now = Date.now();
      if (redis) {
        return Number(await redis.eval(connectionScript, 2, ...pair, socketId, 50, 10, connectionTtlMs)) === 1;
      }
      const buckets = pair.map(key => {
        const entries = local.get(key) ?? new Map<string, number>();
        for (const [id, until] of entries) if (until <= now) entries.delete(id);
        local.set(key, entries);
        return entries;
      });
      if (buckets.some((bucket, index) => !bucket.has(socketId) && bucket.size >= (index === 0 ? 50 : 10))) return false;
      for (const bucket of buckets) bucket.set(socketId, now + connectionTtlMs);
      return true;
    },
    async release(ip: string, accountId: string, socketId: string): Promise<void> {
      const pair = keys(ip, accountId);
      if (redis) {
        await Promise.all(pair.map(key => redis.zrem(key, socketId)));
      } else {
        for (const key of pair) {
          const bucket = local.get(key);
          bucket?.delete(socketId);
          if (bucket?.size === 0) local.delete(key);
        }
      }
    },
    async acceptMessage(accountId: string, socketId: string): Promise<boolean> {
      const now = Date.now();
      const subject = accountId + ':' + socketId;
      if (redis) {
        const key = prefix + 'messages:' + subject + ':' + Math.floor(now / 10_000);
        return Number(await redis.eval(`local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],10000) end; return n`, 1, key)) <= 30;
      }
      for (const [id, value] of messages) if (value.resetAt <= now) messages.delete(id);
      const bucket = messages.get(subject) ?? { count: 0, resetAt: now + 10_000 };
      bucket.count++;
      messages.set(subject, bucket);
      return bucket.count <= 30;
    },
  };
}
