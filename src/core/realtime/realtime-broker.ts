import type { Server as SocketIOServer } from 'socket.io';
import type { Logger } from 'pino';
import type {
  ClientToServerEvents,
  RealtimeEvent,
  ServerToClientEvents,
  SocketData,
} from './realtime-types.js';

export interface RealtimeBroker {
  publish(event: RealtimeEvent): Promise<void>;
  publishToBooking(bookingId: string, event: RealtimeEvent): Promise<void>;
  publishToAccount(accountId: string, event: RealtimeEvent): Promise<void>;
  publishToRole(role: string, event: RealtimeEvent): Promise<void>;
  publishToCatalog(event: RealtimeEvent): Promise<void>;
  revokeSession(sessionId: string): void;
  revokeAccount(accountId: string): void;
}

export function createRealtimeBroker(
  io: SocketIOServer<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>,
  logger?: Logger,
  onBeforeDispatch?: (rooms: readonly string[]) => void | Promise<void>,
  authorizedDispatch?: (rooms: readonly string[], event: RealtimeEvent) => Promise<void>,
): RealtimeBroker {
  // Deduplication cache to prevent echo or replay storms
  const seenEventIds = new Set<string>();
  const MAX_SEEN_EVENTS = 10_000;

  function markAndCheckDuplicate(eventId: string): boolean {
    if (seenEventIds.has(eventId)) {
      return true;
    }
    if (seenEventIds.size >= MAX_SEEN_EVENTS) {
      // Clear oldest entries
      const iterator = seenEventIds.values();
      for (let i = 0; i < 2_000; i++) {
        const next = iterator.next();
        if (next.done) break;
        seenEventIds.delete(next.value);
      }
    }
    seenEventIds.add(eventId);
    return false;
  }

  async function dispatchToRooms(rooms: readonly string[], event: RealtimeEvent): Promise<void> {
    if (rooms.length === 0) return;
    if (authorizedDispatch) {
      await authorizedDispatch(rooms, event);
      return;
    }
    if (onBeforeDispatch) {
      await onBeforeDispatch(rooms);
    }

    const firstRoom = rooms[0];
    if (!firstRoom) return;
    let broadcaster = io.to(firstRoom);
    for (let i = 1; i < rooms.length; i++) {
      const nextRoom = rooms[i];
      if (nextRoom) {
        broadcaster = broadcaster.to(nextRoom);
      }
    }
    broadcaster.emit('realtime:event', event);
  }

  return {
    async publish(event: RealtimeEvent): Promise<void> {
      if (seenEventIds.has(event.eventId)) {
        return;
      }

      logger?.debug(
        { eventId: event.eventId, type: event.type, scope: event.scope },
        'Dispatching realtime event.',
      );

      // Targeted routing based on scope with union rooms
      const targetRooms: string[] = [];
      if (event.scope.entityType === 'account') {
        // Account events are private even when a booking reference is present.
        // An unresolved account must never fall back to a broader audience.
        if (!event.scope.entityId) throw new Error('ACCOUNT_EVENT_REQUIRES_RECIPIENT');
        targetRooms.push(`account:${event.scope.entityId}`);
      } else if (event.scope.bookingId) {
        targetRooms.push(`booking:${event.scope.bookingId}`, 'role:manager');
      } else if (event.scope.entityType === 'catalog') {
        targetRooms.push('public:catalog', 'role:manager');
      } else {
        targetRooms.push('role:manager');
      }

      await dispatchToRooms(targetRooms, event);
      markAndCheckDuplicate(event.eventId);
    },

    async publishToBooking(bookingId: string, event: RealtimeEvent): Promise<void> {
      if (seenEventIds.has(event.eventId)) return;
      await dispatchToRooms([`booking:${bookingId}`, 'role:manager'], event);
      markAndCheckDuplicate(event.eventId);
    },

    async publishToAccount(accountId: string, event: RealtimeEvent): Promise<void> {
      if (seenEventIds.has(event.eventId)) return;
      await dispatchToRooms([`account:${accountId}`], event);
      markAndCheckDuplicate(event.eventId);
    },

    async publishToRole(role: string, event: RealtimeEvent): Promise<void> {
      if (seenEventIds.has(event.eventId)) return;
      await dispatchToRooms([`role:${role}`], event);
      markAndCheckDuplicate(event.eventId);
    },

    async publishToCatalog(event: RealtimeEvent): Promise<void> {
      if (seenEventIds.has(event.eventId)) return;
      await dispatchToRooms(['public:catalog', 'role:manager'], event);
      markAndCheckDuplicate(event.eventId);
    },

    revokeSession(sessionId: string) {
      io.to(`session:${sessionId}`).emit('realtime:event', {
        eventId: crypto.randomUUID(), schemaVersion: 1, type: 'session.revoked',
        scope: { entityType: 'session', entityId: sessionId },
        resources: [], occurredAt: new Date().toISOString(),
      });
      io.in(`session:${sessionId}`).disconnectSockets(true);
    },

    revokeAccount(accountId: string) {
      io.to(`account:${accountId}`).emit('realtime:event', {
        eventId: crypto.randomUUID(), schemaVersion: 1, type: 'session.revoked',
        scope: { entityType: 'account', entityId: accountId },
        resources: [], occurredAt: new Date().toISOString(),
      });
      io.in(`account:${accountId}`).disconnectSockets(true);
    },
  };
}
