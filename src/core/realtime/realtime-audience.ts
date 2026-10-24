import type { PrismaClient } from '../../generated/prisma/client.js';
import type { RealtimeEvent, SocketData } from './realtime-types.js';

/** Both local Socket and Redis adapter RemoteSocket expose this capability set. */
interface AudienceSocket {
  readonly id: string;
  readonly data: SocketData;
  readonly rooms: Set<string>;
  leave(room: string): void | Promise<unknown>;
  join(room: string): void | Promise<unknown>;
  disconnect(close?: boolean): unknown;
  emit(event: 'realtime:event', payload: RealtimeEvent): unknown;
}

const protectedEvents = new Set(['guest.updated', 'seating.updated', 'print_order.updated']);
const batchSize = 200;

/** Rechecks the authority at delivery, across nodes, without one query per socket.
 * No positive grant cache: revoked grants must not survive in joined rooms.
 */
export function createRealtimeAudience(prisma: PrismaClient) {
  return async function authorize(
    sockets: readonly AudienceSocket[],
    targetRooms: readonly string[],
    event?: RealtimeEvent,
  ): Promise<string[]> {
    const allowedIds: string[] = [];
    for (let offset = 0; offset < sockets.length; offset += batchSize) {
      const batch = sockets.slice(offset, offset + batchSize);
      const hashes = [...new Set(batch.map(socket => socket.data.tokenHash))];
      const credentials = await prisma.accessCredential.findMany({
        where: { tokenHash: { in: hashes } },
        select: {
          tokenHash: true, status: true, expiresAt: true,
          session: { select: {
            id: true, status: true, idleExpiresAt: true, absoluteExpiresAt: true,
            account: { select: { id: true, status: true, roles: { select: { role: true } } } },
          } },
        },
      });
      const states = new Map(credentials.map(credential => [credential.tokenHash, credential]));
      const accountIds = [...new Set(credentials.map(credential => credential.session.account.id))];
      const bookingIds = [...new Set(batch.flatMap(socket => [...socket.rooms]
        .filter(room => room.startsWith('booking:')).map(room => room.slice(8)))
        .concat(event?.scope.bookingId ? [event.scope.bookingId] : []))];
      // Include the event booking for private inbox authorization, even without a subscription.
      const [bookings, grants, assignments] = await Promise.all([
        prisma.booking.findMany({ where: { id: { in: bookingIds } }, select: { id: true, consultationId: true, consultation: { select: { managerAccountId: true } } } }),
        prisma.consultationAccess.findMany({ where: { accountId: { in: accountIds } }, select: { accountId: true, consultationId: true, level: true } }),
        prisma.staffAssignment.findMany({ where: { staffAccountId: { in: accountIds }, bookingId: { in: bookingIds }, status: 'ACTIVE' }, select: { staffAccountId: true, bookingId: true } }),
      ]);
      const consultations = new Map(bookings.map(booking => [booking.id, booking.consultationId]));
      const bookingManagers = new Map(bookings.map(booking => [booking.id, booking.consultation.managerAccountId]));
      const grantLevels = new Map(grants.map(grant => [grant.accountId + ':' + grant.consultationId, grant.level]));
      const accountsWithGrants = new Set(grants.map(grant => grant.accountId));
      const assigned = new Set(assignments.map(assignment => assignment.staffAccountId + ':' + assignment.bookingId));
      const now = Date.now();
      for (const socket of batch) {
        const credential = states.get(socket.data.tokenHash);
        const session = credential?.session;
        if (!credential || !session || credential.status !== 'ACTIVE' || session.status !== 'ACTIVE'
          || session.account.status !== 'ACTIVE' || credential.expiresAt.getTime() <= now
          || session.idleExpiresAt.getTime() <= now || session.absoluteExpiresAt.getTime() <= now
          || session.id !== socket.data.actor.sessionId || session.account.id !== socket.data.actor.accountId) {
          if (!session || session.status !== 'ACTIVE' || session.account.status !== 'ACTIVE') {
            socket.emit('realtime:event', {
              eventId: crypto.randomUUID(), schemaVersion: 1, type: 'session.revoked',
              scope: { entityType: 'session', entityId: socket.data.actor.sessionId },
              resources: [], occurredAt: new Date().toISOString(),
            });
          }
          socket.disconnect(true);
          continue;
        }
        const roles = session.account.roles.map(value => value.role);
        if (socket.data.subscriptions instanceof Set) {
          for (const id of socket.data.subscriptions) {
            if (!socket.rooms.has(`booking:${id}`)) socket.data.subscriptions.delete(id);
          }
        }
        const manager = roles.includes('MANAGER');
        const bookingAllowed = (bookingId: string, delivery: boolean): boolean => {
          if (manager) return true;
          const consultationId = consultations.get(bookingId);
          const level = consultationId ? grantLevels.get(session.account.id + ':' + consultationId) : undefined;
          if (roles.includes('COUPLE') && level) {
            return !delivery || !event || !protectedEvents.has(event.type) || level === 'FULL';
          }
          return roles.includes('STAFF') && assigned.has(session.account.id + ':' + bookingId)
            && (!delivery || !event || event.type === 'guest.updated');
        };
        for (const room of socket.rooms) {
          if ((room === 'role:manager' && !manager)
            || (room === 'role:staff' && !roles.includes('STAFF'))
            || (room.startsWith('booking:') && !bookingAllowed(room.slice(8), false))) {
            await socket.leave(room);
            if (room.startsWith('booking:') && socket.data.subscriptions instanceof Set) {
              socket.data.subscriptions.delete(room.slice(8));
            }
          }
        }
        // Refresh local actor and role rooms. RemoteSocket.data is only a snapshot;
        // security here always uses fresh database state rather than that snapshot.
        socket.data.actor = { ...socket.data.actor, roles };
        if (manager && !socket.rooms.has('role:manager')) await socket.join('role:manager');
        if (roles.includes('STAFF') && !socket.rooms.has('role:staff')) await socket.join('role:staff');
        const permitted = targetRooms.some(room => {
          if (room.startsWith('account:')) {
            if (room !== `account:${session.account.id}`) return false;
            if (event?.type === 'notification.received') {
              const canReadInbox = manager || roles.includes('COUPLE')
                || (roles.length === 0 && accountsWithGrants.has(session.account.id));
              const id = event.scope.bookingId;
              const consultationId = id ? consultations.get(id) : undefined;
              return canReadInbox && (!id || (consultationId !== undefined
                && grantLevels.has(session.account.id + ':' + consultationId))
                || (manager && bookingManagers.get(id) === session.account.id));
            }
            return !event?.scope.bookingId || bookingAllowed(event.scope.bookingId, true);
          }
          if (room === 'role:manager') return manager;
          if (room === 'role:staff') return roles.includes('STAFF');
          if (room === 'public:catalog') return true;
          return room.startsWith('booking:') && socket.rooms.has(room) && bookingAllowed(room.slice(8), true);
        });
        if (permitted) allowedIds.push(socket.id);
      }
    }
    return allowedIds;
  };
}
