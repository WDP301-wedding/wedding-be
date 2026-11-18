import { beforeEach, expect, it, vi } from 'vitest';
import { createRealtimeOutboxRelay } from './realtime-outbox-relay.js';
import { createRedisManager } from '../redis/redis-client.js';
const queue = vi.hoisted(() => ({ claim: vi.fn(), renew: vi.fn(), finish: vi.fn() }));
vi.mock('./delivery-queue.js', () => ({ createDeliveryQueue: () => queue }));
beforeEach(() => {
  vi.resetAllMocks();
});

it('leaves an unsuccessful dispatch retryable and only finishes after a successful retry', async () => {
  const claim = { eventId: 'event', revision: 1, leaseToken: 'lease' };
  queue.claim.mockImplementation((stream: string) =>
    Promise.resolve(stream === 'booking' ? [claim] : []),
  );
  queue.renew.mockResolvedValue(true);
  queue.finish.mockResolvedValue(undefined);
  const publish = vi
    .fn()
    .mockRejectedValueOnce(new Error('REALTIME_FANOUT_UNAVAILABLE'))
    .mockResolvedValue(undefined);
  const delivery = vi.fn();
  const prisma = {
    bookingOutboxEvent: {
      findMany: () =>
        Promise.resolve([
          {
            id: 'event',
            aggregateId: 'booking',
            aggregateRevision: 2,
            eventType: 'booking.updated',
            occurredAt: new Date(),
          },
        ]),
    },
    booking: { findMany: () => Promise.resolve([]) },
    consultationAccess: { findMany: () => Promise.resolve([]) },
  };
  const relay = createRealtimeOutboxRelay({
    prisma: prisma as unknown as Parameters<typeof createRealtimeOutboxRelay>[0]['prisma'],
    broker: { publish } as unknown as Parameters<typeof createRealtimeOutboxRelay>[0]['broker'],
    redisManager: createRedisManager({ environment: 'test' }),
    metrics: { delivery, dispatchLag: vi.fn(), fanoutRecovered: vi.fn() },
  });
  expect(await relay.pollOnce()).toBe(0);
  expect(queue.finish).not.toHaveBeenCalledWith('booking', claim, true);
  expect(queue.finish).toHaveBeenCalledWith('booking', claim, false);
  expect(delivery).toHaveBeenCalledWith('booking', 'retry');
  expect(await relay.pollOnce()).toBe(1);
  expect(queue.finish).toHaveBeenCalledWith('booking', claim, true);
  expect(publish).toHaveBeenCalledTimes(2);
  expect(delivery).toHaveBeenCalledWith('booking', 'dispatched');
});
