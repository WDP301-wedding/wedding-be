import type { Server as SocketIOServer } from 'socket.io';
import type { Logger } from 'pino';
import type {
  ClientToServerEvents,
  RealtimeEvent,
  ServerToClientEvents,
  SocketData,
} from './realtime-types.js';

export interface RealtimeBroker {
  publish(event: RealtimeEvent): void;
  publishToBooking(bookingId: string, event: RealtimeEvent): void;
  publishToAccount(accountId: string, event: RealtimeEvent): void;
  publishToRole(role: string, event: RealtimeEvent): void;
  publishToCatalog(event: RealtimeEvent): void;
  revokeSession(sessionId: string): void;
  revokeAccount(accountId: string): void;
}

export function createRealtimeBroker(
  io: SocketIOServer<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>,
  logger?: Logger,
  onBeforeDispatch?: (rooms: readonly string[]) => void | Promise<void>,
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

  function dispatchToRooms(rooms: readonly string[], event: RealtimeEvent): void {
    if (rooms.length === 0) return;
    void (async () => {
      try {
        if (onBeforeDispatch) {
          await onBeforeDispatch(rooms);
        }
      } catch (err) {
        logger?.warn({ err }, 'Error in realtime pre-dispatch validation hook.');
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
    })();
  }

  return {
    publish(event: RealtimeEvent) {
      if (markAndCheckDuplicate(event.eventId)) {
        return;
      }

      logger?.debug(
        { eventId: event.eventId, type: event.type, scope: event.scope },
        'Dispatching realtime event.',
      );

      // Targeted routing based on scope with union rooms
      if (event.scope.bookingId) {
        dispatchToRooms([`booking:${event.scope.bookingId}`, 'role:manager'], event);
      } else if (event.scope.entityType === 'catalog') {
        dispatchToRooms(['public:catalog', 'role:manager'], event);
      } else if (event.scope.entityType === 'account' && event.scope.entityId) {
        dispatchToRooms([`account:${event.scope.entityId}`], event);
      } else {
        dispatchToRooms(['role:manager'], event);
      }
    },

    publishToBooking(bookingId: string, event: RealtimeEvent) {
      if (markAndCheckDuplicate(event.eventId)) return;
      dispatchToRooms([`booking:${bookingId}`, 'role:manager'], event);
    },

    publishToAccount(accountId: string, event: RealtimeEvent) {
      if (markAndCheckDuplicate(event.eventId)) return;
      dispatchToRooms([`account:${accountId}`], event);
    },

    publishToRole(role: string, event: RealtimeEvent) {
      if (markAndCheckDuplicate(event.eventId)) return;
      dispatchToRooms([`role:${role}`], event);
    },

    publishToCatalog(event: RealtimeEvent) {
      if (markAndCheckDuplicate(event.eventId)) return;
      dispatchToRooms(['public:catalog', 'role:manager'], event);
    },

    revokeSession(sessionId: string) {
      // Send revocation signal then disconnect sockets associated with the session
      io.in(`session:${sessionId}`).disconnectSockets(true);
    },

    revokeAccount(accountId: string) {
      io.in(`account:${accountId}`).disconnectSockets(true);
    },
  };
}
