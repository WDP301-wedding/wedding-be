import type { PrismaClient } from '../../generated/prisma/client.js';
import type { Logger } from 'pino';
import type { RedisManager } from '../redis/redis-client.js';
import type { RealtimeBroker } from './realtime-broker.js';
import type { RealtimeEvent, RealtimeEventType } from './realtime-types.js';
import { createDeliveryQueue } from './delivery-queue.js';
import { catalogResources, resourcesForCatalogEntity } from './catalog-events.js';

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

export function createRealtimeOutboxRelay(options: OutboxRelayOptions): OutboxRelayInstance {
  const { prisma, broker, logger, pollIntervalMs = 2_000 } = options;
  const queue = createDeliveryQueue(prisma);
  let timer: ReturnType<typeof setInterval> | null = null;
  let isRunning = false;
  let isPolling = false;
  let activePollPromise: Promise<number> | null = null;

  async function processStreamBatch<T>(
    stream: string,
    fetchBatch: (ids: string[]) => Promise<T[]>,
    getId: (row: T) => string,
    toEvent: (row: T) => RealtimeEvent | readonly RealtimeEvent[] | null,
  ): Promise<number> {
    const claims = await queue.claim(stream);
    if (claims.length === 0) return 0;
    let dispatched = 0;
    try {
      const rows = new Map((await fetchBatch([...new Set(claims.map(c => c.eventId))]))
        .map(row => [getId(row), row]));
      for (const claim of claims) {
        try {
          if (!await queue.renew(stream, claim)) continue;
          const row = rows.get(claim.eventId);
          const converted = row ? toEvent(row) : null;
          const events: readonly RealtimeEvent[] = converted === null
            ? [] : 'eventId' in converted ? [converted] : converted;
          for (const event of events) {
            // A notification row can change revision between claim and read. Its
            // queued revision remains a distinct invalidation, never a cursor fence.
            await broker.publish({ ...event, eventId: event.eventId + ':' + claim.revision });
            dispatched++;
          }
          await queue.finish(stream, claim, true);
        } catch (err) {
          await queue.finish(stream, claim, false);
          logger?.error({ err, stream, eventId: claim.eventId }, 'Realtime delivery will retry.');
        }
      }
    } finally {
      // Token check makes release harmless for delivered/reclaimed claims.
      await Promise.all(claims.map(claim => queue.finish(stream, claim, false)));
    }
    return dispatched;
  }

  const identityRecipients = new Map<string, readonly string[]>();
  const bookingRecipients = new Map<string, readonly string[]>();
  async function resolveRecipients(ids: string[], kind: 'consultation' | 'booking') {
    const bookings = kind === 'booking' ? await prisma.booking.findMany({
      where: { id: { in: ids } }, select: { id: true, consultationId: true },
    }) : [];
    const grants = await prisma.consultationAccess.findMany({
      where: kind === 'consultation'
        ? { consultationId: { in: ids } }
        : { consultationId: { in: bookings.map(row => row.consultationId) } },
      select: { accountId: true, consultationId: true },
    });
    const byConsultation = new Map<string, string[]>();
    for (const grant of grants) {
      const recipients = byConsultation.get(grant.consultationId) ?? [];
      recipients.push(grant.accountId);
      byConsultation.set(grant.consultationId, recipients);
    }
    if (kind === 'consultation') {
      identityRecipients.clear();
      for (const id of ids) identityRecipients.set(id, byConsultation.get(id) ?? []);
    } else {
      bookingRecipients.clear();
      for (const row of bookings) bookingRecipients.set(row.id, byConsultation.get(row.consultationId) ?? []);
    }
  }

  async function scanAndRelay(): Promise<number> {
    let dispatched = 0;

    try {
      // 1. BookingOutboxEvents
      dispatched += await processStreamBatch(
        'booking',
        async (ids) => {
          const rows = await prisma.bookingOutboxEvent.findMany({
            take: 50,
            orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
            where: { id: { in: ids } },
          });
          await resolveRecipients(rows.map(row => row.aggregateId), 'booking');
          return rows;
        },
        (row) => row.id,
        (row) => {
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
          return [{
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
          }, ...(bookingRecipients.get(row.aggregateId) ?? []).map(accountId => ({
            eventId: row.id + ':' + accountId,
            schemaVersion: 1 as const,
            type: 'booking.updated' as const,
            scope: { entityType: 'account' as const, entityId: accountId },
            resources: ['/couple/bookings'],
            occurredAt: row.occurredAt.toISOString(),
          }))];
        },
      );

      // 2. BillingOutboxEvents
      dispatched += await processStreamBatch(
        'billing',
        (ids) =>
          prisma.billingOutboxEvent.findMany({
            take: 50,
            orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
            where: { id: { in: ids } },
          }),
        (row) => row.id,
        (row) => ({
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
        }),
      );

      // 3. GuestOutbox
      dispatched += await processStreamBatch(
        'guest',
        (ids) =>
          prisma.guestOutbox.findMany({
            take: 50,
            orderBy: [{ createdAt: 'asc' }, { eventId: 'asc' }],
            where: { eventId: { in: ids } },
          }),
        (row) => row.eventId,
        (row) => ({
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
        }),
      );

      // 4. SeatingOutbox
      dispatched += await processStreamBatch(
        'seating',
        (ids) =>
          prisma.seatingOutbox.findMany({
            take: 50,
            orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
            where: { id: { in: ids } },
          }),
        (row) => row.id,
        (row) => ({
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
        }),
      );

      // 5. InvitationStudioOutbox
      dispatched += await processStreamBatch(
        'studio',
        (ids) =>
          prisma.invitationStudioOutbox.findMany({
            take: 50,
            orderBy: [{ createdAt: 'asc' }, { eventId: 'asc' }],
            where: { eventId: { in: ids } },
          }),
        (row) => row.eventId,
        (row) => ({
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
        }),
      );

      // Consultation authority is resolved once per batch; manager and account
      // invalidations are separate envelopes with no guessed booking identity.
      if (prisma.identityOutbox?.findMany) {
        dispatched += await processStreamBatch(
          'identity',
          async (ids) => {
            const rows = await prisma.identityOutbox.findMany({
              take: 50,
              orderBy: [{ occurredAt: 'asc' }, { eventId: 'asc' }],
              where: { eventId: { in: ids } },
            });
            await resolveRecipients(rows.map(row => row.consultationId), 'consultation');
            return rows;
          },
          (row) => row.eventId,
          (row) => [{
            eventId: row.eventId,
            schemaVersion: 1,
            type: 'booking.updated' as const,
            scope: { entityType: 'booking' as const },
            resources: ['/couple/bookings', '/management/consultations'],
            occurredAt: row.occurredAt.toISOString(),
            payload: { eventType: row.eventType },
          }, ...(identityRecipients.get(row.consultationId) ?? []).map(accountId => ({
            eventId: row.eventId + ':' + accountId,
            schemaVersion: 1 as const,
            type: 'booking.updated' as const,
            scope: { entityType: 'account' as const, entityId: accountId },
            resources: ['/couple/bookings'],
            occurredAt: row.occurredAt.toISOString(),
          }))],
        );
      }

      // 7. StaffOutbox (Optional stream: check-in events)
      if (prisma.staffOutbox?.findMany) {
        dispatched += await processStreamBatch(
          'staff',
          (ids) =>
            prisma.staffOutbox.findMany({
              take: 50,
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              where: { id: { in: ids } },
            }),
          (row) => row.id,
          (row) => ({
            eventId: row.id,
            schemaVersion: 1,
            type: 'guest.updated',
            scope: {
              entityType: 'booking',
              bookingId: row.bookingId,
            },
            resources: [`/bookings/${row.bookingId}/guests`, `/bookings/${row.bookingId}/check-in`],
            occurredAt: row.createdAt.toISOString(),
            payload: { eventType: row.eventType },
          }),
        );
      }

      // 8. NotificationInbox (Optional stream: notification events)
      // AUDIENCE RESTRICTION: Notification inbox rows are owner-private.
      // The REST inbox always filters by n.accountId = currentAccountId, so
      // the realtime invalidation must match: route ONLY to account:<accountId>.
      // Broker prioritizes the private account audience even with a booking reference.
      if (prisma.notificationInbox?.findMany) {
        dispatched += await processStreamBatch(
          'notification',
          (ids) =>
            prisma.notificationInbox.findMany({
              take: 50,
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              where: { id: { in: ids } },
            }),
          (row) => row.id,
          (row) => ({
            eventId: row.id,
            schemaVersion: 1,
            type: 'notification.received',
            scope: {
              entityType: 'account',
              entityId: row.accountId,
              ...(row.bookingId ? { bookingId: row.bookingId } : {}),
              revision: row.revision,
            },
            resources: ['/notifications', '/account/notifications'],
            occurredAt: row.createdAt.toISOString(),
            payload: { intentId: row.intentId },
          }),
        );
      }

      // Catalog invalidation contains no draft entity ID, action or private payload.
      if (prisma.auditLog?.findMany) {
        dispatched += await processStreamBatch(
          'audit',
          (ids) =>
            prisma.auditLog.findMany({
              take: 50,
              orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
              where: { id: { in: ids } },
            }),
          (row) => row.id,
          (row) => Object.hasOwn(catalogResources, row.entityType) ? ({
            eventId: row.id,
            schemaVersion: 1,
            type: 'catalog.updated',
            scope: {
              entityType: 'catalog',
            },
            resources: resourcesForCatalogEntity(row.entityType) ?? [],
            occurredAt: row.occurredAt.toISOString(),
          }) : null,
        );
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
