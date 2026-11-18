import { beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({
  clients: [] as Array<{
    status: string;
    options: { retryStrategy: (attempt: number) => number | null };
    connect: ReturnType<typeof vi.fn>;
    ping: ReturnType<typeof vi.fn>;
  }>,
}));
vi.mock('ioredis', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    Redis: class extends EventEmitter {
      status = 'wait';
      connect = vi.fn(() => {
        this.status = 'ready';
        return Promise.resolve();
      });
      ping = vi.fn(() => Promise.resolve('PONG'));
      quit = vi.fn(() => {
        this.status = 'end';
        return Promise.resolve();
      });
      disconnect = vi.fn(() => {
        this.status = 'end';
      });
      constructor(
        _url: string,
        public options: { retryStrategy: (attempt: number) => number | null },
      ) {
        super();
        fixture.clients.push(this);
      }
    },
  };
});
import { createRedisManager } from './redis-client.js';
beforeEach(() => {
  fixture.clients.length = 0;
});

it('keeps retrying all Redis connections beyond the former retry budget with capped delays', async () => {
  const manager = createRedisManager({ url: 'redis://localhost:6379', environment: 'test' });
  expect(await manager.init()).toBe(true);
  expect(fixture.clients).toHaveLength(3);
  for (const client of fixture.clients) {
    expect(client.options.retryStrategy(100)).toBeGreaterThanOrEqual(5000);
    expect(client.options.retryStrategy(100)).toBeLessThan(5200);
  }
  await manager.close();
  for (const client of fixture.clients) expect(client.options.retryStrategy(101)).toBeNull();
});

it('does not report healthy with a broken subscriber and does not resurrect closed connections', async () => {
  const manager = createRedisManager({ url: 'redis://localhost:6379', environment: 'test' });
  await manager.init();
  fixture.clients[2]!.status = 'reconnecting';
  expect(await manager.healthCheck()).toBe(false);
  fixture.clients[2]!.status = 'ready';
  expect(await manager.healthCheck()).toBe(true);
  await manager.close();
  expect(await manager.healthCheck()).toBe(false);
  for (const client of fixture.clients) expect(client.connect).toHaveBeenCalledTimes(1);
});
