import { Prisma } from '../../../generated/prisma/client.js';
import type { createNotificationBookingReader } from '../../booking-lifecycle/infrastructure/notification-context.reader.js';
import type { createNotificationIdentityReader } from '../../identity-access/authorization/notification-recipient.reader.js';
import { notificationEvent, notificationEventTypes } from '../domain/event-handler.js';
import { digest, type NotificationInput } from '../domain/notification-policy.js';
import type { NotificationFoundation } from './notification-foundation.js';

type Source = {
  eventId: string;
  eventType: string;
  eventVersion: number;
  bookingId: string | null;
  consultationId: string | null;
  occurredAt: Date;
  payload: unknown;
};
type BookingReader = ReturnType<typeof createNotificationBookingReader>;
type IdentityReader = ReturnType<typeof createNotificationIdentityReader>;
type Owner = NotificationInput['owner'];
const owners: Owner[] = [
  'identity-access',
  'booking-lifecycle',
  'payments-billing',
  'invitation-studio',
  'guest-management',
];

/** Read-only integration outbox adapter. Each consumer owns its own immutable receipts. */
export class NotificationEventConsumer {
  constructor(
    readonly foundation: NotificationFoundation,
    readonly booking: BookingReader,
    readonly identity: IdentityReader,
  ) {}

  private source(owner: Owner, limit: number) {
    const types = Prisma.join(notificationEventTypes(owner));
    const notConsumed = (id: Prisma.Sql) => Prisma.sql`NOT EXISTS (
      SELECT 1 FROM "NotificationEventReceipt" r WHERE r.owner=${owner} AND r."eventId"=${id})`;
    let query: Prisma.Sql;
    if (owner === 'identity-access') {
      query = Prisma.sql`SELECT s."eventId",s."eventType",s."eventVersion",NULL::uuid AS "bookingId",s."consultationId",s."occurredAt",s.payload
        FROM "IdentityOutbox" s WHERE s."eventType" IN (${types}) AND ${notConsumed(Prisma.sql`s."eventId"`)}
        ORDER BY s."occurredAt",s."eventId" LIMIT ${limit}`;
    } else if (owner === 'booking-lifecycle' || owner === 'payments-billing') {
      const table =
        owner === 'booking-lifecycle'
          ? Prisma.sql`"BookingOutboxEvent"`
          : Prisma.sql`"BillingOutboxEvent"`;
      query = Prisma.sql`SELECT s.id AS "eventId",s."eventType",s."eventVersion",s."aggregateId" AS "bookingId",NULL::uuid AS "consultationId",s."occurredAt",s.payload
        FROM ${table} s WHERE s."eventType" IN (${types}) AND ${notConsumed(Prisma.sql`s.id`)}
        ORDER BY s."occurredAt",s.id LIMIT ${limit}`;
    } else if (owner === 'invitation-studio') {
      query = Prisma.sql`SELECT s."eventId",s."eventType",(s.envelope->>'eventVersion')::int AS "eventVersion",s."bookingId",NULL::uuid AS "consultationId",
        (s.envelope->>'occurredAt')::timestamptz AS "occurredAt",s.envelope->'payload' AS payload
        FROM "InvitationStudioOutbox" s WHERE s."eventType" IN (${types}) AND ${notConsumed(Prisma.sql`s."eventId"`)}
        ORDER BY s."createdAt",s."eventId" LIMIT ${limit}`;
    } else {
      query = Prisma.sql`SELECT s."eventId",s."eventType",1 AS "eventVersion",s."bookingId",NULL::uuid AS "consultationId",s."createdAt" AS "occurredAt",s.payload
        FROM "GuestOutbox" s WHERE s."eventType" IN (${types}) AND ${notConsumed(Prisma.sql`s."eventId"`)}
        ORDER BY s."createdAt",s."eventId" LIMIT ${limit}`;
    }
    return this.foundation.prisma.$queryRaw<Source[]>(query);
  }

  async poll(limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error('NOTIFICATION_BATCH_INVALID');
    let processed = 0;
    for (const owner of owners) {
      if (processed >= limit) break;
      for (const source of await this.source(owner, limit - processed)) {
        const context = source.bookingId
          ? await this.booking.read(source.bookingId)
          : source.consultationId
            ? await this.booking.fromConsultation(source.consultationId)
            : null;
        if (!context) throw new Error('NOTIFICATION_EVENT_BOOKING_UNAVAILABLE');
        const e = notificationEvent(owner, {
          ...source,
          bookingId: context.id,
          occurredAt: source.occurredAt.toISOString(),
          payload:
            owner === 'identity-access'
              ? { ...asRecord(source.payload), bookingId: context.id }
              : source.payload,
        });
        if (!e) continue;
        const intents: NotificationInput[] = [];
        const staleReview =
          e.purpose === 'TIMELINE_REVIEW' &&
          e.data.referenceId !== context.currentTimelineRevisionId;
        if (
          !staleReview &&
          !(
            context.phase === 'CANCELLED' &&
            e.purpose !== 'CANCELLATION_NOTICE' &&
            owner !== 'payments-billing'
          )
        ) {
          if (e.audience !== 'MANAGER') {
            for (const couple of context.couples) {
              if (
                owner === 'identity-access' &&
                asRecord(source.payload)['accountId'] !== couple.accountId
              )
                continue;
              if (!(await this.identity.account(couple.accountId))) continue;
              const recipient = await this.coupleRecipient(couple.accountId, e.purpose);
              if (!recipient.enabled) continue;
              for (const channel of ['EMAIL', 'IN_APP'] as const) {
                intents.push({
                  eventId: e.eventId,
                  owner,
                  bookingId: context.id,
                  recipientId: recipient.id,
                  channel,
                  purpose: e.purpose,
                  templateVersion: 1,
                  scheduledAt: e.occurredAt,
                  data: e.data,
                });
              }
            }
          }
          if (e.audience !== 'COUPLE' && context.managerAccountId) {
            const account = await this.identity.account(context.managerAccountId);
            if (account?.roles.includes('MANAGER')) {
              const recipient = await this.foundation.prisma.notificationRecipient.findFirst({
                where: {
                  accountId: account.accountId,
                  enabled: true,
                  operational: true,
                  purposes: { has: e.purpose },
                },
              });
              if (recipient)
                for (const channel of ['EMAIL', 'IN_APP'] as const) {
                  intents.push({
                    eventId: e.eventId,
                    owner,
                    bookingId: context.id,
                    recipientId: recipient.id,
                    channel,
                    purpose: e.purpose,
                    templateVersion: 1,
                    scheduledAt: e.occurredAt,
                    data: e.data,
                  });
                }
            }
          }
        }
        await this.foundation.consume({
          owner,
          eventId: e.eventId,
          sourceDigest: digest(source),
          intents,
        });
        processed++;
      }
    }
    return processed;
  }
  coupleRecipient(accountId: string, purpose: NotificationInput['purpose']) {
    return this.foundation.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`notification-recipient:${accountId}`},0))`;
      const prior = await tx.notificationRecipient.findFirst({ where: { accountId } });
      if (!prior)
        return tx.notificationRecipient.create({ data: { accountId, purposes: [purpose] } });
      // Disabled recipients cannot be reactivated by an event consumer.
      if (!prior.enabled) return prior;
      if (prior.purposes.includes(purpose)) return prior;
      return tx.notificationRecipient.update({
        where: { id: prior.id },
        data: { purposes: [...prior.purposes, purpose], revision: { increment: 1 } },
      });
    });
  }
}
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
