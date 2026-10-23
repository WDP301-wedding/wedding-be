import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRealtimeBroker, type RealtimeBroker } from '../../src/core/realtime/realtime-broker.js';
import { createRedisAttemptThrottle } from '../../src/core/redis/redis-attempt-throttle.js';
import type {
  ClientToServerEvents,
  RealtimeEvent,
  ServerToClientEvents,
  SocketData,
} from '../../src/core/realtime/realtime-types.js';
import type { Server as SocketIOServer } from 'socket.io';
import type { Redis } from 'ioredis';

describe('Realtime & Redis Core Integration', () => {
  describe('RealtimeBroker', () => {
    let broker: RealtimeBroker;
    let targetedRooms: string[] = [];
    let emittedEvents: Array<{ eventName: string; payload: unknown }> = [];

    beforeEach(() => {
      targetedRooms = [];
      emittedEvents = [];

      const mockIo = {
        to: (room: string) => {
          targetedRooms.push(room);
          return {
            to: (r2: string) => {
              targetedRooms.push(r2);
              return {
                emit: (eventName: string, payload: unknown) => {
                  emittedEvents.push({ eventName, payload });
                },
              };
            },
            emit: (eventName: string, payload: unknown) => {
              emittedEvents.push({ eventName, payload });
            },
          };
        },
        in: vi.fn(),
      };

      broker = createRealtimeBroker(
        mockIo as unknown as SocketIOServer<
          ClientToServerEvents,
          ServerToClientEvents,
          Record<string, never>,
          SocketData
        >,
      );
    });

    it('deduplicates events by eventId using LRU cache', () => {
      const event: RealtimeEvent = {
        eventId: 'evt-001',
        schemaVersion: 1,
        type: 'booking.updated',
        scope: {
          entityType: 'booking',
          entityId: 'b-123',
          bookingId: 'b-123',
        },
        resources: ['/bookings/b-123/proposal'],
        occurredAt: new Date().toISOString(),
      };

      broker.publish(event);
      // Single broadcast to union of rooms (booking:b-123 and role:manager) prevents duplicate packets
      expect(emittedEvents).toHaveLength(1);
      expect(targetedRooms).toContain('booking:b-123');
      expect(targetedRooms).toContain('role:manager');

      // Publish exact same event again
      broker.publish(event);
      // Must not emit duplicate events (remains 1)
      expect(emittedEvents).toHaveLength(1);
    });

    it('targets booking and manager rooms for booking events', () => {
      const event: RealtimeEvent = {
        eventId: 'evt-002',
        schemaVersion: 1,
        type: 'booking.updated',
        scope: {
          entityType: 'booking',
          entityId: 'b-456',
          bookingId: 'b-456',
        },
        resources: ['/bookings/b-456'],
        occurredAt: new Date().toISOString(),
      };

      broker.publish(event);
      // Emits single union packet to both target rooms
      expect(emittedEvents).toHaveLength(1);
      expect(targetedRooms).toContain('booking:b-456');
      expect(targetedRooms).toContain('role:manager');
    });

    it('targets public catalog room for catalog updates', () => {
      const event: RealtimeEvent = {
        eventId: 'evt-003',
        schemaVersion: 1,
        type: 'catalog.updated',
        scope: {
          entityType: 'catalog',
          entityId: 'halls',
        },
        resources: ['/management/catalog/halls'],
        occurredAt: new Date().toISOString(),
      };

      broker.publishToCatalog(event);
      expect(emittedEvents).toHaveLength(1);
      expect(targetedRooms).toContain('public:catalog');
      expect(targetedRooms).toContain('role:manager');
    });
  });

  describe('RedisAttemptThrottle (Atomic Lua & Outage Policy)', () => {
    it('executes atomic Lua script and counts attempts correctly', async () => {
      // Mock successful Lua return: [currentCount, ttlSeconds]
      const evalSpy = vi.fn().mockResolvedValue([2, 58]);
      const mockRedis = {
        eval: evalSpy,
      } as unknown as Redis;

      const throttle = createRedisAttemptThrottle({
        client: mockRedis,
        prefix: 'test_throttle',
      });

      const result = await throttle.consume({
        bucket: 'login-subject',
        key: 'user-1',
        maxAttempts: 5,
        windowSeconds: 60,
        now: new Date(),
      });

      expect(result.allowed).toBe(true);
      expect(result.retryAfterSeconds).toBe(58);
      expect(evalSpy).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'test_throttle:login-subject:user-1',
        '60',
      );
    });

    it('blocks attempts when count exceeds limit', async () => {
      const mockRedis = {
        eval: vi.fn().mockResolvedValue([6, 45]),
      } as unknown as Redis;

      const throttle = createRedisAttemptThrottle({
        client: mockRedis,
        prefix: 'test_throttle',
      });

      const result = await throttle.consume({
        bucket: 'login-subject',
        key: 'user-blocked',
        maxAttempts: 5,
        windowSeconds: 60,
        now: new Date(),
      });

      expect(result.allowed).toBe(false);
      expect(result.retryAfterSeconds).toBe(45);
    });

    it('enforces fail-closed policy on outage for security endpoints', async () => {
      const mockBrokenRedis = {
        eval: vi.fn().mockRejectedValue(new Error('Redis connection lost')),
      } as unknown as Redis;

      const throttle = createRedisAttemptThrottle({
        client: mockBrokenRedis,
        failClosedOnOutage: true,
      });

      const result = await throttle.consume({
        bucket: 'login-ip',
        key: 'user-outage',
        maxAttempts: 5,
        windowSeconds: 60,
        now: new Date(),
      });

      // On Redis outage, auth throttle fails closed (denies attempt)
      expect(result.allowed).toBe(false);
      expect(result.retryAfterSeconds).toBe(60);
    });
  });
});
