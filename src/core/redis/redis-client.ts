import { Redis, type RedisOptions } from 'ioredis';
import type { Logger } from 'pino';

export interface RedisManagerOptions {
  readonly url?: string | undefined;
  readonly environment: string;
  readonly logger?: Logger | undefined;
}

export interface RedisManager {
  readonly isConfigured: boolean;
  init(): Promise<boolean>;
  getClient(): Redis | null;
  createPubSubPair(): { pub: Redis; sub: Redis } | null;
  healthCheck(): Promise<boolean>;
  close(): Promise<void>;
}

export function createRedisManager(options: RedisManagerOptions): RedisManager {
  const { url, logger, environment } = options;
  const isConfigured = Boolean(url && url.trim().length > 0);

  if (!isConfigured) {
    if (environment === 'production' || process.env.REDIS_REQUIRED === 'true') {
      throw new Error('REDIS_REQUIRED_IN_PRODUCTION: Redis is required in production environment.');
    }
    logger?.info('Redis is not configured. Running with in-process local stores.');
    return {
      isConfigured: false,
      init: () => Promise.resolve(false),
      getClient: () => null,
      createPubSubPair: () => null,
      healthCheck: () => Promise.resolve(false),
      close: () => Promise.resolve(),
    };
  }

  const trimmedUrl = url!.trim();
  if (!trimmedUrl.startsWith('redis://') && !trimmedUrl.startsWith('rediss://')) {
    throw new Error('INVALID_REDIS_URL: Redis URL must start with redis:// or rediss://');
  }

  const baseOptions: RedisOptions = {
    lazyConnect: true,
    connectTimeout: 5_000,
    commandTimeout: 3_000,
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false,
    retryStrategy(times) {
      if (times > 5) {
        logger?.warn({ attempts: times }, 'Redis reconnection limit reached.');
        return null; // Stop retrying
      }
      return Math.min(times * 200, 2_000); // Exponential backoff with 2s cap
    },
  };

  const client = new Redis(trimmedUrl, baseOptions);
  client.on('error', (err) => {
    logger?.error({ err }, 'Redis connection error.');
  });

  const pubClient = new Redis(trimmedUrl, baseOptions);
  const subClient = new Redis(trimmedUrl, baseOptions);
  pubClient.on('error', (err) => logger?.error({ err }, 'Redis pub client error.'));
  subClient.on('error', (err) => logger?.error({ err }, 'Redis sub client error.'));

  const allClients: Redis[] = [client, pubClient, subClient];

  return {
    isConfigured: true,
    async init() {
      try {
        const connectAndPing = async (c: Redis, name: string) => {
          if (c.status !== 'ready' && c.status !== 'connecting') {
            await c.connect();
          }
          const pong = await Promise.race([
            c.ping(),
            new Promise<string>((_, reject) =>
              setTimeout(() => reject(new Error(`Redis ${name} connection timeout`)), 3000),
            ),
          ]);
          return pong;
        };

        const [generalPong, pubPong, subPong] = await Promise.all([
          connectAndPing(client, 'general'),
          connectAndPing(pubClient, 'pub'),
          connectAndPing(subClient, 'sub'),
        ]);

        return generalPong === 'PONG' && pubPong === 'PONG' && subPong === 'PONG';
      } catch (err) {
        logger?.error({ err }, 'Redis connection initialization failed.');
        if (environment === 'production' || process.env.REDIS_REQUIRED === 'true') {
          throw new Error(
            `REDIS_INIT_FAILED: ${err instanceof Error ? err.message : String(err)}`,
            { cause: err },
          );
        }
        return false;
      }
    },
    getClient() {
      return client;
    },
    createPubSubPair() {
      // Return dedicated Pub/Sub pair initialized and verified ready
      return { pub: pubClient, sub: subClient };
    },
    async healthCheck() {
      try {
        if (client.status !== 'ready') {
          await client.connect();
        }
        const pong = await client.ping();
        return pong === 'PONG';
      } catch (err) {
        logger?.warn({ err }, 'Redis health check failed.');
        return false;
      }
    },
    async close() {
      await Promise.all(
        allClients.map(async (c) => {
          try {
            if (['ready', 'connecting', 'connect'].includes(c.status)) {
              await c.quit();
            } else {
              c.disconnect();
            }
          } catch {
            c.disconnect();
          }
        }),
      );
    },
  };
}
