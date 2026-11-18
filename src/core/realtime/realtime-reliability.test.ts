import { Registry } from 'prom-client';
import { createRealtimeMetrics } from './realtime-metrics.js';
import { createRealtimeAudience } from './realtime-audience.js';
import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { watchFanoutRecovery } from './redis-fanout-recovery.js';
import { createRealtimeBroker } from './realtime-broker.js';
import type { RealtimeEvent } from './realtime-types.js';

it('requests one resync only after both fanout connections recover and removes listeners on close', () => {
  const pub = Object.assign(new EventEmitter(), { status: 'ready' });
  const sub = Object.assign(new EventEmitter(), { status: 'ready' });
  const recovered = vi.fn();
  const dispose = watchFanoutRecovery({ pub: pub as Redis, sub: sub as Redis }, recovered);
  pub.emit('ready');
  expect(recovered).not.toHaveBeenCalled();
  pub.status = 'reconnecting';
  pub.emit('close');
  sub.status = 'reconnecting';
  sub.emit('close');
  pub.status = 'ready';
  pub.emit('ready');
  expect(recovered).not.toHaveBeenCalled();
  sub.status = 'ready';
  sub.emit('ready');
  sub.emit('ready');
  expect(recovered).toHaveBeenCalledTimes(1);
  sub.status = 'reconnecting';
  sub.emit('close');
  sub.status = 'ready';
  sub.emit('ready');
  expect(recovered).toHaveBeenCalledTimes(2);
  dispose();
  expect(pub.listenerCount('ready')).toBe(0);
  expect(sub.listenerCount('close')).toBe(0);
});

it('coalesces simultaneous deliveries and retries after a failed dispatch', async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const dispatch = vi
    .fn()
    .mockImplementationOnce(() =>
      held.then(() => {
        throw new Error('outage');
      }),
    )
    .mockResolvedValue(undefined);
  const broker = createRealtimeBroker(
    {} as Parameters<typeof createRealtimeBroker>[0],
    undefined,
    undefined,
    dispatch,
  );
  const event: RealtimeEvent = {
    eventId: 'same',
    schemaVersion: 1,
    type: 'booking.updated',
    scope: { entityType: 'booking', bookingId: 'booking' },
    resources: [],
    occurredAt: new Date().toISOString(),
  };
  const first = broker.publish(event);
  const duplicate = broker.publish(event);
  release();
  const results = await Promise.allSettled([first, duplicate]);
  expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
  expect(dispatch).toHaveBeenCalledTimes(1);
  await broker.publish(event);
  await broker.publish(event);
  expect(dispatch).toHaveBeenCalledTimes(2);
});

it('checks current grants for both tabs and removes a revoked booking room', async () => {
  const bookingId = 'booking';
  const accountId = 'account';
  const sessionId = 'session';
  const lookup = vi.fn(() =>
    Promise.resolve([
      {
        tokenHash: 'hash',
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 60000),
        session: {
          id: sessionId,
          status: 'ACTIVE',
          idleExpiresAt: new Date(Date.now() + 60000),
          absoluteExpiresAt: new Date(Date.now() + 60000),
          account: { id: accountId, status: 'ACTIVE', roles: [{ role: 'COUPLE' }] },
        },
      },
    ]),
  );
  let grants = [{ accountId, consultationId: 'consultation', level: 'FULL' }];
  const prisma = {
    accessCredential: { findMany: lookup },
    booking: {
      findMany: () =>
        Promise.resolve([
          {
            id: bookingId,
            consultationId: 'consultation',
            consultation: { managerAccountId: 'manager' },
          },
        ]),
    },
    consultationAccess: { findMany: () => Promise.resolve(grants) },
    staffAssignment: { findMany: () => Promise.resolve([]) },
  };
  const authorize = createRealtimeAudience(
    prisma as unknown as Parameters<typeof createRealtimeAudience>[0],
  );
  const sockets = ['tab1', 'tab2'].map((id) => {
    const rooms = new Set([id, `booking:${bookingId}`]);
    return {
      id,
      rooms,
      data: {
        tokenHash: 'hash',
        actor: { accountId, sessionId, roles: ['COUPLE'], displayEmail: 'couple@example.test' },
        subscriptions: new Set([bookingId]),
      },
      leave: vi.fn((room: string) => {
        rooms.delete(room);
        return Promise.resolve();
      }),
      join: vi.fn(),
      emit: vi.fn(),
      disconnect: vi.fn(),
    };
  });
  const audience = sockets as unknown as Parameters<typeof authorize>[0];
  expect(await authorize(audience, [`booking:${bookingId}`])).toEqual(['tab1', 'tab2']);
  expect(lookup).toHaveBeenCalledTimes(1); // batch authority lookup, no per-tab query
  grants = [];
  expect(await authorize(audience, [`booking:${bookingId}`])).toEqual([]);
  for (const socket of sockets) expect(socket.rooms.has(`booking:${bookingId}`)).toBe(false);
});

it('exports bounded-label dispatch metrics without implying client acknowledgement', async () => {
  const registry = new Registry();
  const metrics = createRealtimeMetrics(registry);
  metrics.delivery('booking', 'retry');
  metrics.delivery('booking', 'dispatched');
  metrics.dispatchLag('booking', new Date(Date.now() - 1000).toISOString());
  metrics.fanoutRecovered();
  const output = await registry.metrics();
  expect(output).toContain('wedding_realtime_delivery_total{stream="booking",outcome="retry"} 1');
  expect(output).toContain('wedding_realtime_fanout_recoveries_total 1');
  expect(output).toContain('wedding_realtime_dispatch_lag_seconds_count{stream="booking"} 1');
});
