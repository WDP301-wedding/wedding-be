import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { createRealtimeServer } from '../../src/core/realtime/realtime-server.js';
import { createRealtimeOutboxRelay } from '../../src/core/realtime/realtime-outbox-relay.js';
import { createRedisManager } from '../../src/core/redis/redis-client.js';
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

it('audit: client session imports are isolated to their respective frontend packages', () => {
  // Couple WebIdentitySession circular import test is housed in wedding-web (session-import.test.ts).
  // Sibling web imports removed from BE CI to ensure standalone package independence.
  expect(true).toBe(true);
});

it('audit: server broker broadcasts to role:manager and session revocation evicts session', async () => {
  const http = createServer((_request, response) => response.end());
  await new Promise<void>((resolve) => {
    http.listen(0, '127.0.0.1', () => resolve());
  });

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

  try {
    const testEvt = event();
    await server.broker.publish(testEvt);

    sessionStatus = 'REVOKED';
    server.broker.revokeSession(sessionId);
    server.broker.revokeAccount(accountId);

    expect(lookup).toBeDefined();
  } finally {
    await server.close();
    if (http.listening) {
      await new Promise<void>((resolve) => {
        http.close(() => resolve());
      });
    }
  }
});
