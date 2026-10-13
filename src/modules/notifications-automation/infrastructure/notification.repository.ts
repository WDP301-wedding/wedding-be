import { randomUUID } from 'node:crypto';
import {
  Prisma,
  type PrismaClient,
  type NotificationIntent,
} from '../../../generated/prisma/client.js';
import { RETRY_MS, TEMPLATE_VERSION } from '../domain/notification-policy.js';
export type NotificationClient = Prisma.TransactionClient;
export type EnqueueInput = Readonly<{
  eventId: string;
  bookingId: string;
  purpose: string;
  recipientId: string;
  accountId: string | null;
  channel: 'EMAIL' | 'PUSH';
  scheduledAt: Date;
  scheduleRevision?: number;
  referenceId?: string;
  id?: string;
  credentialId?: string;
  ciphertext?: string;
  secretExpiresAt?: Date;
}>;
export const credentialAad = (bookingId: string, intentId: string) =>
  `${bookingId}/GUEST_INVITATION/${intentId}`;
export class NotificationRepository {
  constructor(
    readonly prisma: PrismaClient,
    readonly now: () => Date = () => new Date(),
    readonly bookingIds?: readonly string[],
  ) {}
  async enqueue(tx: NotificationClient, input: EnqueueInput) {
    const { scheduleRevision, ...data } = input;
    return tx.notificationIntent.upsert({
      where: {
        eventId_channel_recipientId_templateVersion: {
          eventId: input.eventId,
          channel: input.channel,
          recipientId: input.recipientId,
          templateVersion: TEMPLATE_VERSION,
        },
      },
      create: {
        ...data,
        id: input.id ?? randomUUID(),
        templateVersion: TEMPLATE_VERSION,
        scheduleRevision: scheduleRevision ?? null,
        nextAttemptAt: input.scheduledAt,
      },
      update: {},
    });
  }
  async claim(limit = 100): Promise<NotificationIntent[]> {
    const now = this.now(),
      lease = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const scope =
        this.bookingIds === undefined
          ? Prisma.empty
          : this.bookingIds.length === 0
            ? Prisma.sql`AND false`
            : Prisma.sql`AND "bookingId" IN (${Prisma.join(this.bookingIds.map((id) => Prisma.sql`${id}::uuid`))})`;
      return tx.$queryRaw<NotificationIntent[]>(Prisma.sql`
        WITH due AS (SELECT id FROM "NotificationIntent"
          WHERE state IN ('QUEUED','RETRYABLE_FAILED') AND "nextAttemptAt"<=${now} AND "scheduledAt"<=${now} ${scope}
          ORDER BY "nextAttemptAt",id LIMIT ${Math.min(Math.max(limit, 1), 100)} FOR UPDATE SKIP LOCKED)
        UPDATE "NotificationIntent" n SET state='IN_FLIGHT',"leaseToken"=${lease}::uuid,"leaseUntil"=${new Date(now.getTime() + 120000)},
          "attemptCount"="attemptCount"+1,revision=revision+1 FROM due WHERE n.id=due.id RETURNING n.*`);
    });
  }
  async finish(row: NotificationIntent, outcome: string, messageId?: string, errorCode?: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "NotificationIntent" WHERE id=${row.id}::uuid FOR UPDATE`;
      const current = await tx.notificationIntent.findUniqueOrThrow({ where: { id: row.id } });
      // A late acknowledgement after lease expiry resolves the same attempt, never
      // starts another send. An operator changing the revision wins over it.
      if (
        current.attemptCount !== row.attemptCount ||
        (current.leaseToken !== row.leaseToken && current.state !== 'UNKNOWN')
      )
        return;
      if (!['IN_FLIGHT', 'UNKNOWN'].includes(current.state)) return;
      const state =
        outcome === 'RETRYABLE_FAILED' && row.attemptCount >= 6 ? 'DEAD_LETTER' : outcome;
      await tx.notificationAttempt.upsert({
        where: {
          intentId_attemptNumber_outcome: {
            intentId: row.id,
            attemptNumber: row.attemptCount,
            outcome,
          },
        },
        create: {
          intentId: row.id,
          attemptNumber: row.attemptCount,
          outcome,
          providerMessageId: messageId ?? null,
          errorCode: errorCode ?? null,
        },
        update: {},
      });
      await tx.notificationIntent.update({
        where: { id: row.id },
        data: {
          state,
          revision: { increment: 1 },
          leaseToken: null,
          leaseUntil: null,
          providerMessageId: messageId ?? current.providerMessageId,
          nextAttemptAt: new Date(
            this.now().getTime() + (RETRY_MS[row.attemptCount - 1] ?? 43200000),
          ),
          ...(['DELIVERED', 'CANCELLED', 'SKIPPED_STALE', 'DEAD_LETTER'].includes(state)
            ? { ciphertext: null }
            : {}),
        },
      });
    });
  }
  async recover() {
    const now = this.now();
    await this.prisma.$transaction(async (tx) => {
      const scope =
        this.bookingIds === undefined
          ? Prisma.empty
          : this.bookingIds.length === 0
            ? Prisma.sql`AND false`
            : Prisma.sql`AND "bookingId" IN (${Prisma.join(this.bookingIds.map((id) => Prisma.sql`${id}::uuid`))})`;
      const rows = await tx.$queryRaw<NotificationIntent[]>(Prisma.sql`
        SELECT * FROM "NotificationIntent" WHERE state='IN_FLIGHT' AND "leaseUntil"<=${now} ${scope} LIMIT 100 FOR UPDATE SKIP LOCKED`);
      for (const row of rows) {
        await tx.notificationAttempt.create({
          data: {
            intentId: row.id,
            attemptNumber: row.attemptCount,
            outcome: 'UNKNOWN',
            errorCode: 'LEASE_EXPIRED',
          },
        });
        await tx.notificationIntent.update({
          where: { id: row.id },
          data: {
            state: 'UNKNOWN',
            leaseToken: null,
            leaseUntil: null,
            revision: { increment: 1 },
          },
        });
      }
      await tx.notificationIntent.updateMany({
        where: {
          ciphertext: { not: null },
          secretExpiresAt: { lte: now },
          ...(this.bookingIds === undefined ? {} : { bookingId: { in: [...this.bookingIds] } }),
        },
        data: { ciphertext: null },
      });
    });
  }
}
