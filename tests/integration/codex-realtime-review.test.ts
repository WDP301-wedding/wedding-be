import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { createRealtimeServer } from '../../src/core/realtime/realtime-server.js';
import { createRealtimeOutboxRelay } from '../../src/core/realtime/realtime-outbox-relay.js';
import { createRedisManager } from '../../src/core/redis/redis-client.js';
import { issueOpaqueToken } from '../../src/modules/identity-access/crypto/token.js';
import type { RealtimeEvent } from '../../src/core/realtime/realtime-types.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function event(id = randomUUID()): RealtimeEvent {
  return {
    eventId: id,
    schemaVersion: 1 as const,
    type: 'booking.updated' as const,
    scope: { entityType: 'booking' as const, bookingId: randomUUID(), revision: 1 },
    resources: ['/couple/bookings'],
    occurredAt: new Date().toISOString(),
  };
}

function outboxRows(count: number) {
  return Array.from({ length: count }, (_, n) => ({
    id: `audit-${n}`,
    eventType: 'booking.updated',
    aggregateId: randomUUID(),
    aggregateRevision: n + 1,
    occurredAt: new Date(1000 * n),
  }));
}

function relayFixture(
  rows: ReturnType<typeof outboxRows>,
  publish = vi.fn<(event: RealtimeEvent) => void>(),
) {
  const sortedRows = [...rows].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const prisma = {
    bookingOutboxEvent: {
      findMany: vi.fn((query: { take: number; cursor?: { id: string }; skip?: number }) => {
        let items = sortedRows;
        if (query.cursor) {
          const idx = items.findIndex((r) => r.id === query.cursor?.id);
          if (idx !== -1) {
            items = items.slice(idx + (query.skip ?? 0));
          }
        }
        return Promise.resolve(items.slice(0, query.take));
      }),
    },
    billingOutboxEvent: { findMany: () => Promise.resolve([]) },
    guestOutbox: { findMany: () => Promise.resolve([]) },
    seatingOutbox: { findMany: () => Promise.resolve([]) },
    invitationStudioOutbox: { findMany: () => Promise.resolve([]) },
  };
  const relay = createRealtimeOutboxRelay({
    prisma: prisma as unknown as Parameters<typeof createRealtimeOutboxRelay>[0]['prisma'],
    broker: { publish } as unknown as Parameters<typeof createRealtimeOutboxRelay>[0]['broker'],
    redisManager: createRedisManager({ environment: 'test' }),
  });
  return { relay, publish };
}

it('audit: newest-50 relay reaches all 51 committed events in chronological order', async () => {
  const f = relayFixture(outboxRows(51));
  expect(await f.relay.pollOnce()).toBe(50);
  expect(await f.relay.pollOnce()).toBe(1);
  expect(f.publish).toHaveBeenCalledTimes(51);
  expect(f.publish.mock.calls.some(([e]) => e.eventId === 'audit-0')).toBe(true);

  const idx0 = f.publish.mock.calls.findIndex(([e]) => e.eventId === 'audit-0');
  const idx50 = f.publish.mock.calls.findIndex(([e]) => e.eventId === 'audit-50');
  expect(idx0).toBeLessThan(idx50);
});

it('audit: lease-before-publish with receipt-after-publish retries event after publish failure', async () => {
  let attempt = 0;
  const publish = vi.fn<(event: RealtimeEvent) => void>().mockImplementation(() => {
    attempt++;
    if (attempt === 1) {
      throw new Error('Controlled publish failure');
    }
  });
  const f = relayFixture(outboxRows(1), publish);
  // First poll fails on publish, releases lease, and returns 0 dispatched
  expect(await f.relay.pollOnce()).toBe(0);
  // Second poll retries the pending event and succeeds
  expect(await f.relay.pollOnce()).toBe(1);
  expect(publish).toHaveBeenCalledTimes(2);
});

it('audit: production fails closed when Redis config is missing', async () => {
  expect(() => createRedisManager({ environment: 'production' })).toThrow(
    /REDIS_REQUIRED_IN_PRODUCTION/,
  );
  const m = createRedisManager({ environment: 'production', url: 'redis://127.0.0.1:6379' });
  expect(m.isConfigured).toBe(true);
  expect(m.getClient()).not.toBeNull();
  await m.close();
});

it('audit: importing Couple session does not expose circular initialization error', async () => {
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://127.0.0.1:3000/api/v1');
  const sessionModulePath = '../../../wedding-web/src/features/identity-access/session.js';
  const sessionModule = (await import(sessionModulePath)) as {
    WebIdentitySession: unknown;
  };
  expect(typeof sessionModule.WebIdentitySession).toBe('function');
});

it('audit: actual Manager socket receives BE packet and callbacks trigger; revoke session evicts socket', async () => {
  const http = createServer((_request, response) => response.end());
  await new Promise<void>((resolve) => {
    http.listen(0, '127.0.0.1', () => resolve());
  });
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  const origin = `http://127.0.0.1:${address.port}`;
  vi.stubGlobal('window', { location: { href: origin } });
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', origin + '/api/v1');
  vi.stubEnv('NEXT_PUBLIC_REALTIME_URL', origin);

  const token = issueOpaqueToken('access', 32).token;
  const accountId = randomUUID();
  const sessionId = randomUUID();
  let sessionStatus = 'ACTIVE';
  const lookup = vi.fn(() =>
    Promise.resolve({
      accountId,
      sessionId,
      displayEmail: 'audit@example.test',
      roles: ['MANAGER'] as const,
      accountStatus: 'ACTIVE' as const,
      sessionStatus,
      credentialStatus: 'ACTIVE' as const,
      credentialExpiresAt: new Date(Date.now() + 60000),
      idleExpiresAt: new Date(Date.now() + 60000),
      absoluteExpiresAt: new Date(Date.now() + 60000),
    }),
  );

  const server = createRealtimeServer({
    httpServer: http,
    config: { cors: { allowedOrigins: [] } } as unknown as Parameters<
      typeof createRealtimeServer
    >[0]['config'],
    sessionRepository: {
      findActorByAccessTokenHash: lookup,
    } as Parameters<typeof createRealtimeServer>[0]['sessionRepository'],
    prisma: {} as Parameters<typeof createRealtimeServer>[0]['prisma'],
    redisManager: createRedisManager({ environment: 'test' }),
  });

  const clientPath = '../../../wedding-manage-web/src/features/realtime/realtime-client.js';
  const { ManagementRealtimeManager } = (await import(clientPath)) as {
    ManagementRealtimeManager: new () => {
      addEventListener: (cb: (e: RealtimeEvent) => void) => void;
      addResyncListener: (cb: () => void) => void;
      addStatusListener: (cb: (status: string) => void) => () => void;
      connect: (token: string) => void;
      disconnect: () => void;
      getStatus: () => string;
    };
  };

  const manager = new ManagementRealtimeManager();
  const listener = vi.fn<(event: RealtimeEvent) => void>();
  const resync = vi.fn();
  manager.addEventListener(listener);
  manager.addResyncListener(resync);

  try {
    const connected = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Local socket handshake timeout')), 5000);
      const unsub = manager.addStatusListener((s) => {
        if (s === 'connected') {
          clearTimeout(timer);
          unsub();
          resolve();
        }
      });
    });
    manager.connect(token);
    await connected;

    // Send realtime event from server to role:manager
    const testEvt = event();
    server.broker.publish(testEvt);

    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1), { timeout: 5000 });
    const firstCall = listener.mock.calls[0];
    expect(firstCall?.[0]?.eventId).toBe(testEvt.eventId);

    // Now revoke the session: broker revokes session room and evicts socket
    sessionStatus = 'REVOKED';
    server.broker.revokeSession(sessionId);

    await vi.waitFor(() => expect(manager.getStatus()).toBe('disconnected'), { timeout: 5000 });

    // Subsequent events should not reach the evicted manager
    server.broker.publish(event());
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(listener).toHaveBeenCalledTimes(1);
  } finally {
    manager.disconnect();
    await new Promise<void>((resolve) => {
      void server.io.close(() => resolve());
    });
    if (http.listening) {
      await new Promise<void>((resolve) => {
        http.close(() => resolve());
      });
    }
  }
}, 15000);
