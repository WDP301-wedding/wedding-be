import type { PrismaClient } from '../../generated/prisma/client.js';
import type { Logger } from 'pino';
import type { RedisManager } from '../redis/redis-client.js';
import type { RealtimeBroker } from './realtime-broker.js';
import type { RealtimeEvent, RealtimeEventType } from './realtime-types.js';

export interface OutboxRelayOptions {
  readonly prisma: PrismaClient;
  readonly broker: RealtimeBroker;
  readonly redisManager: RedisManager;
  readonly logger?: Logger;
  readonly pollIntervalMs?: number;
}

export interface OutboxRelayInstance {
  start(): void;
  stop(): Promise<void>;
  pollOnce(): Promise<number>;
}

interface StreamCursor {
  cursorId: string | null;
  watermarkDate: Date | null;
}

export function createRealtimeOutboxRelay(options: OutboxRelayOptions): OutboxRelayInstance {
  const { prisma, broker, redisManager, logger, pollIntervalMs = 2_000 } = options;
  let timer: ReturnType<typeof setInterval> | null = null;
  let isRunning = false;
  let isPolling = false;
  let activePollPromise: Promise<number> | null = null;

  // Track stream cursor/watermark to drain backlogs without scanning full history
  type StreamKey = 'booking' | 'billing' | 'guest' | 'seating' | 'studio';
  const cursors: Record<StreamKey, StreamCursor> = {
    booking: { cursorId: null, watermarkDate: null },
    billing: { cursorId: null, watermarkDate: null },
    guest: { cursorId: null, watermarkDate: null },
    seating: { cursorId: null, watermarkDate: null },
    studio: { cursorId: null, watermarkDate: null },
  };

  // In-memory fallback stores when Redis is not available
  const localReceipts = new Set<string>();
  const localLeases = new Map<string, number>();
  const MAX_LOCAL_ENTRIES = 50_000;

  async function tryAcquireLease(stream: string, eventId: string): Promise<boolean> {
    const key = `${stream}:${eventId}`;
    const redis = redisManager.getClient();

    if (redis && redis.status === 'ready') {
      try {
        // If already has durable receipt, do not lease
        const receipt = await redis.get(`rt:receipt:${key}`);
        if (receipt !== null) return false;

        // Acquire short-lived lease (30s)
        const leased = await redis.set(`rt:lease:${key}`, '1', 'EX', 30, 'NX');
        return leased === 'OK';
      } catch (err) {
        logger?.warn({ err, eventId }, 'Redis lease acquire failed, falling back to local.');
      }
    }

    if (localReceipts.has(key)) return false;
    const now = Date.now();
    const existingLease = localLeases.get(key);
    if (existingLease && existingLease > now) return false;

    if (localLeases.size >= MAX_LOCAL_ENTRIES) {
      const it = localLeases.entries();
      for (let i = 0; i < 5_000; i++) {
        const n = it.next();
        if (n.done) break;
        if (n.value[1] <= now) localLeases.delete(n.value[0]);
      }
    }
    localLeases.set(key, now + 30_000);
    return true;
  }

  async function markReceipt(stream: string, eventId: string): Promise<void> {
    const key = `${stream}:${eventId}`;
    const redis = redisManager.getClient();

    if (redis && redis.status === 'ready') {
      try {
        // Set durable receipt for 7 days (604,800s) and release lease
        await redis.set(`rt:receipt:${key}`, '1', 'EX', 604_800);
        await redis.del(`rt:lease:${key}`);
        return;
      } catch (err) {
        logger?.warn({ err, eventId }, 'Redis mark receipt failed, falling back to local.');
      }
    }

    if (localReceipts.size >= MAX_LOCAL_ENTRIES) {
      const it = localReceipts.values();
      for (let i = 0; i < 5_000; i++) {
        const n = it.next();
        if (n.done) break;
        localReceipts.delete(n.value);
      }
    }
    localReceipts.add(key);
    localLeases.delete(key);
  }

  async function releaseLease(stream: string, eventId: string): Promise<void> {
    const key = `${stream}:${eventId}`;
    const redis = redisManager.getClient();
    if (redis && redis.status === 'ready') {
      try {
        await redis.del(`rt:lease:${key}`);
      } catch {
        // Ignore deletion error on release
      }
    }
    localLeases.delete(key);
  }

  async function scanAndRelay(): Promise<number> {
    let dispatched = 0;

    try {
      // 1. Scan BookingOutboxEvents in chronological order (asc)
      const bookingCursor = cursors.booking.cursorId;
      const bookingEvents = await prisma.bookingOutboxEvent.findMany({
        take: 50,
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        ...(bookingCursor ? { cursor: { id: bookingCursor }, skip: 1 } : {}),
      });

      for (const row of bookingEvents) {
        const leased = await tryAcquireLease('booking', row.id);
        if (!leased) continue;

        let eventType: RealtimeEventType = 'booking.updated';
        if (row.eventType.includes('timeline')) {
          eventType = 'timeline.updated';
        } else if (row.eventType.includes('contract')) {
          eventType = 'contract.updated';
        } else if (row.eventType.includes('deposit')) {
          eventType = 'deposit.received';
        } else if (row.eventType.includes('proposal')) {
          eventType = 'proposal.updated';
        }

        const event: RealtimeEvent = {
          eventId: row.id,
          schemaVersion: 1,
          type: eventType,
          scope: {
            entityType: 'booking',
            bookingId: row.aggregateId,
            revision: row.aggregateRevision,
          },
          resources: [
            `/bookings/${row.aggregateId}`,
            `/bookings/${row.aggregateId}/timeline`,
            `/bookings/${row.aggregateId}/proposal`,
            `/couple/bookings`,
          ],
          occurredAt: row.occurredAt.toISOString(),
          payload: { eventType: row.eventType },
        };

        try {
          broker.publish(event);
          dispatched++;
          await markReceipt('booking', row.id);
          cursors.booking.cursorId = row.id;
        } catch (err) {
          await releaseLease('booking', row.id);
          logger?.error(
            { err, eventId: row.id },
            'Broker publish failed; lease released for retry.',
          );
          break; // Stop batch to retry from this event
        }
      }

      // 2. Scan BillingOutboxEvents
      const billingCursor = cursors.billing.cursorId;
      const billingEvents = await prisma.billingOutboxEvent.findMany({
        take: 50,
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        ...(billingCursor ? { cursor: { id: billingCursor }, skip: 1 } : {}),
      });

      for (const row of billingEvents) {
        const leased = await tryAcquireLease('billing', row.id);
        if (!leased) continue;

        const event: RealtimeEvent = {
          eventId: row.id,
          schemaVersion: 1,
          type: 'billing.updated',
          scope: {
            entityType: 'booking',
            bookingId: row.aggregateId,
            revision: row.aggregateRevision,
          },
          resources: [
            `/bookings/${row.aggregateId}/billing`,
            `/bookings/${row.aggregateId}/contracts`,
            `/couple/bookings`,
          ],
          occurredAt: row.occurredAt.toISOString(),
          payload: { eventType: row.eventType },
        };

        try {
          broker.publish(event);
          dispatched++;
          await markReceipt('billing', row.id);
          cursors.billing.cursorId = row.id;
        } catch (err) {
          await releaseLease('billing', row.id);
          logger?.error(
            { err, eventId: row.id },
            'Broker publish failed; lease released for retry.',
          );
          break;
        }
      }

      // 3. Scan GuestOutbox
      const guestCursor = cursors.guest.cursorId;
      const guestEvents = await prisma.guestOutbox.findMany({
        take: 50,
        orderBy: [{ createdAt: 'asc' }, { eventId: 'asc' }],
        ...(guestCursor ? { cursor: { eventId: guestCursor }, skip: 1 } : {}),
      });

      for (const row of guestEvents) {
        const leased = await tryAcquireLease('guest', row.eventId);
        if (!leased) continue;

        const event: RealtimeEvent = {
          eventId: row.eventId,
          schemaVersion: 1,
          type: 'guest.updated',
          scope: {
            entityType: 'booking',
            bookingId: row.bookingId,
          },
          resources: [`/bookings/${row.bookingId}/guests`, `/bookings/${row.bookingId}/groups`],
          occurredAt: row.createdAt.toISOString(),
          payload: { eventType: row.eventType },
        };

        try {
          broker.publish(event);
          dispatched++;
          await markReceipt('guest', row.eventId);
          cursors.guest.cursorId = row.eventId;
        } catch (err) {
          await releaseLease('guest', row.eventId);
          logger?.error(
            { err, eventId: row.eventId },
            'Broker publish failed; lease released for retry.',
          );
          break;
        }
      }

      // 4. Scan SeatingOutbox
      const seatingCursor = cursors.seating.cursorId;
      const seatingEvents = await prisma.seatingOutbox.findMany({
        take: 50,
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        ...(seatingCursor ? { cursor: { id: seatingCursor }, skip: 1 } : {}),
      });

      for (const row of seatingEvents) {
        const leased = await tryAcquireLease('seating', row.id);
        if (!leased) continue;

        const event: RealtimeEvent = {
          eventId: row.id,
          schemaVersion: 1,
          type: 'seating.updated',
          scope: {
            entityType: 'booking',
            bookingId: row.bookingId,
          },
          resources: [
            `/bookings/${row.bookingId}/seating/tables`,
            `/bookings/${row.bookingId}/seating/assignments`,
          ],
          occurredAt: row.occurredAt.toISOString(),
          payload: { eventType: row.eventType },
        };

        try {
          broker.publish(event);
          dispatched++;
          await markReceipt('seating', row.id);
          cursors.seating.cursorId = row.id;
        } catch (err) {
          await releaseLease('seating', row.id);
          logger?.error(
            { err, eventId: row.id },
            'Broker publish failed; lease released for retry.',
          );
          break;
        }
      }

      // 5. Scan InvitationStudioOutbox
      const studioCursor = cursors.studio.cursorId;
      const studioEvents = await prisma.invitationStudioOutbox.findMany({
        take: 50,
        orderBy: [{ createdAt: 'asc' }, { eventId: 'asc' }],
        ...(studioCursor ? { cursor: { eventId: studioCursor }, skip: 1 } : {}),
      });

      for (const row of studioEvents) {
        const leased = await tryAcquireLease('studio', row.eventId);
        if (!leased) continue;

        const event: RealtimeEvent = {
          eventId: row.eventId,
          schemaVersion: 1,
          type: 'print_order.updated',
          scope: {
            entityType: 'print_order',
            bookingId: row.bookingId,
          },
          resources: [`/management/print-orders`, `/bookings/${row.bookingId}/invitation-studio`],
          occurredAt: row.createdAt.toISOString(),
          payload: { eventType: row.eventType },
        };

        try {
          broker.publish(event);
          dispatched++;
          await markReceipt('studio', row.eventId);
          cursors.studio.cursorId = row.eventId;
        } catch (err) {
          await releaseLease('studio', row.eventId);
          logger?.error(
            { err, eventId: row.eventId },
            'Broker publish failed; lease released for retry.',
          );
          break;
        }
      }
    } catch (err) {
      logger?.error({ err }, 'Realtime outbox relay encountered an error during polling.');
    }

    return dispatched;
  }

  function executePoll(): Promise<number> {
    if (isPolling && activePollPromise) {
      return activePollPromise;
    }
    isPolling = true;
    activePollPromise = scanAndRelay().finally(() => {
      isPolling = false;
      activePollPromise = null;
    });
    return activePollPromise;
  }

  return {
    start() {
      if (isRunning) return;
      isRunning = true;
      timer = setInterval(() => {
        void executePoll();
      }, pollIntervalMs);
      logger?.info('Realtime outbox relay started.');
    },
    async stop() {
      if (!isRunning) return;
      isRunning = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (activePollPromise) {
        await activePollPromise;
      }
      logger?.info('Realtime outbox relay stopped.');
    },
    pollOnce() {
      return executePoll();
    },
  };
}
