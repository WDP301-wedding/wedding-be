import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import { ValidationError, NotFoundError } from '../../../core/errors/app-error.js';
import type {
  PrismaBookingBoundary,
  ContractContext,
} from '../../../core/database/booking-boundary.js';
import {
  digest,
  intentInput,
  notificationConflict,
  parse,
  retryAt,
  type NotificationInput,
} from '../domain/notification-policy.js';

const limitInput = z.int().min(1).max(100);
const outcomeInput = z.enum([
  'ACCEPTED',
  'DELIVERED',
  'RETRYABLE_FAILED',
  'UNKNOWN',
  'DEAD_LETTER',
  'CANCELLED',
  'SKIPPED_STALE',
]);
const evidenceInput = z.strictObject({
  retryNotBefore: z.date().optional(),
  providerMessageId: z
    .string()
    .min(1)
    .max(320)
    .regex(/^[^\r\n]+$/u)
    .optional(),
  errorCode: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{0,79}$/u)
    .optional(),
});

/** Internal persistence boundary. No HTTP authority or provider call lives here. */
export class NotificationFoundation {
  constructor(
    readonly prisma: PrismaClient,
    readonly now: () => Date = () => new Date(),
    readonly boundary?: PrismaBookingBoundary,
  ) {}

  async enqueue(value: unknown) {
    const input = parse(intentInput, value);
    return this.prisma.$transaction((tx) => this.enqueueIn(tx, input));
  }

  enqueueScoped(value: unknown, scope: ContractContext) {
    const input = parse(intentInput, value);
    if (!this.boundary || input.bookingId === null) throw new ValidationError();
    return this.enqueueIn(this.boundary.requireScope(input.bookingId, scope), input);
  }

  private async enqueueIn(tx: Prisma.TransactionClient, input: NotificationInput) {
    const key = JSON.stringify([
      input.eventId,
      input.channel,
      input.recipientId,
      input.templateVersion,
    ]);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    const payloadDigest = digest(input);
    const prior = await tx.notificationIntent.findUnique({
      where: {
        eventId_channel_recipientId_templateVersion: {
          eventId: input.eventId,
          channel: input.channel,
          recipientId: input.recipientId,
          templateVersion: input.templateVersion,
        },
      },
    });
    if (prior) {
      if (prior.payloadDigest !== payloadDigest)
        throw notificationConflict('NOTIFICATION_SOURCE_CONFLICT');
      return prior;
    }
    const recipient = await tx.notificationRecipient.findUnique({
      where: { id: input.recipientId },
    });
    if (!recipient || !recipient.enabled || !recipient.purposes.includes(input.purpose))
      throw new NotFoundError();
    if (recipient.accountId === null && input.channel !== 'EMAIL') throw new ValidationError();
    return tx.notificationIntent.create({
      data: {
        ...input,
        scheduleRevision: input.scheduleRevision ?? null,
        scheduledAt: new Date(input.scheduledAt),
        nextAttemptAt: new Date(input.scheduledAt),
        payloadDigest,
        createdAt: this.now(),
      },
    });
  }

  async consume(value: unknown) {
    const input = parse(
      z.strictObject({
        owner: intentInput.shape.owner,
        eventId: z.uuid().toLowerCase(),
        sourceDigest: z.string().regex(/^[a-f0-9]{64}$/u),
        intents: z.array(intentInput).max(100),
      }),
      value,
    );
    if (input.intents.some((i) => i.owner !== input.owner || i.eventId !== input.eventId))
      throw new ValidationError();
    return this.prisma.$transaction(async (tx) => {
      const key = `notifications:${input.owner}:${input.eventId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      const prior = await tx.notificationEventReceipt.findUnique({
        where: { owner_eventId: { owner: input.owner, eventId: input.eventId } },
      });
      const payloadDigest = digest({
        ...input,
        intents: [...input.intents].sort((a, b) =>
          JSON.stringify([a.recipientId, a.channel, a.templateVersion]).localeCompare(
            JSON.stringify([b.recipientId, b.channel, b.templateVersion]),
          ),
        ),
      });
      if (prior) {
        if (prior.payloadDigest !== payloadDigest)
          throw notificationConflict('NOTIFICATION_SOURCE_CONFLICT');
        return prior.intentIds as string[];
      }
      const ids: string[] = [];
      for (const intent of input.intents) ids.push((await this.enqueueIn(tx, intent)).id);
      await tx.notificationEventReceipt.create({
        data: {
          owner: input.owner,
          eventId: input.eventId,
          payloadDigest,
          intentIds: ids,
          createdAt: this.now(),
        },
      });
      return ids;
    });
  }

  claimDue(limit = 100) {
    parse(limitInput, limit);
    const now = this.now();
    return this.prisma.$transaction(async (tx) => {
      const ids = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT i.id FROM "NotificationIntent" i JOIN "NotificationRecipient" r ON r.id=i."recipientId"
        WHERE i.state IN ('QUEUED','RETRYABLE_FAILED') AND i."nextAttemptAt"<=${now}
          AND i."scheduledAt"<=${now}
        ORDER BY i."nextAttemptAt", i.id LIMIT ${limit} FOR UPDATE OF i SKIP LOCKED`);
      const claimed = [];
      for (const { id } of ids) {
        const leaseId = randomUUID();
        const row = await tx.notificationIntent.update({
          where: { id },
          data: {
            state: 'IN_FLIGHT',
            leaseId,
            leaseExpiresAt: new Date(now.getTime() + 120_000),
            attemptCount: { increment: 1 },
            revision: { increment: 1 },
          },
        });
        await tx.notificationAttempt.create({
          data: { intentId: id, leaseId, outcome: 'CLAIMED', occurredAt: now },
        });
        claimed.push(row);
      }
      return claimed;
    });
  }

  async recordOutcome(
    intentId: string,
    leaseId: string,
    outcomeValue: unknown,
    evidenceValue: unknown,
  ) {
    parse(z.uuid(), intentId);
    parse(z.uuid(), leaseId);
    const outcome = parse(outcomeInput, outcomeValue),
      evidence = parse(evidenceInput, evidenceValue),
      now = this.now();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "NotificationIntent" WHERE id=${intentId}::uuid FOR UPDATE`;
      const row = await tx.notificationIntent.findUnique({ where: { id: intentId } });
      if (!row) throw new NotFoundError();
      const prior = await tx.notificationAttempt.findUnique({
        where: { intentId_leaseId_outcome: { intentId, leaseId, outcome } },
      });
      if (prior) {
        if (
          prior.providerMessageId !== (evidence.providerMessageId ?? null) ||
          prior.errorCode !== (evidence.errorCode ?? null)
        )
          throw notificationConflict('NOTIFICATION_SOURCE_CONFLICT');
        return row;
      }
      if (row.leaseId !== leaseId || !['IN_FLIGHT', 'UNKNOWN'].includes(row.state))
        throw notificationConflict('NOTIFICATION_LEASE_STALE');
      const scheduledRetry =
        outcome === 'RETRYABLE_FAILED' ? retryAt(now, row.attemptCount) : undefined;
      const next =
        scheduledRetry && evidence.retryNotBefore
          ? new Date(Math.max(scheduledRetry.getTime(), evidence.retryNotBefore.getTime()))
          : scheduledRetry;
      if (outcome === 'ACCEPTED' && evidence.providerMessageId === undefined)
        throw new ValidationError();
      const state =
        outcome === 'ACCEPTED'
          ? row.channel === 'ANDROID'
            ? 'PROVIDER_ACCEPTED'
            : 'UNKNOWN'
          : outcome === 'RETRYABLE_FAILED' && next === undefined
            ? 'DEAD_LETTER'
            : outcome;
      await tx.notificationAttempt.create({
        data: {
          intentId,
          leaseId,
          outcome,
          providerMessageId: evidence.providerMessageId ?? null,
          errorCode: evidence.errorCode ?? null,
          occurredAt: now,
        },
      });
      if (outcome === 'UNKNOWN')
        await tx.notificationPushDelivery.updateMany({
          where: { intentId, leaseId, state: 'IN_FLIGHT' },
          data: { state: 'UNKNOWN', errorCode: 'FCM_RESULT_UNKNOWN', updatedAt: now },
        });
      if (!['UNKNOWN', 'RETRYABLE_FAILED'].includes(state)) {
        await tx.notificationCredential.updateMany({
          where: { intentId, purgedAt: null },
          data: { nonce: null, tag: null, ciphertext: null, purgedAt: now },
        });
      }
      return tx.notificationIntent.update({
        where: { id: intentId },
        data: {
          state,
          revision: { increment: 1 },
          nextAttemptAt: next ?? row.nextAttemptAt,
          leaseId: state === 'UNKNOWN' ? leaseId : null,
          leaseExpiresAt: null,
        },
      });
    });
  }

  reconcileExpired(limit = 100) {
    parse(limitInput, limit);
    const now = this.now();
    return this.prisma.$transaction(async (tx) => {
      const ids = await tx.$queryRaw<{ id: string; leaseId: string }[]>(Prisma.sql`
        SELECT id, "leaseId" FROM "NotificationIntent" WHERE state='IN_FLIGHT' AND "leaseExpiresAt"<=${now}
        ORDER BY "leaseExpiresAt",id LIMIT ${limit} FOR UPDATE SKIP LOCKED`);
      for (const row of ids) {
        await tx.notificationPushDelivery.updateMany({
          where: { intentId: row.id, leaseId: row.leaseId, state: 'IN_FLIGHT' },
          data: { state: 'UNKNOWN', errorCode: 'LEASE_EXPIRED', updatedAt: now },
        });
        await tx.notificationAttempt.create({
          data: {
            intentId: row.id,
            leaseId: row.leaseId,
            outcome: 'UNKNOWN',
            errorCode: 'LEASE_EXPIRED',
            occurredAt: now,
          },
        });
        await tx.notificationIntent.update({
          where: { id: row.id },
          data: { state: 'UNKNOWN', leaseExpiresAt: null, revision: { increment: 1 } },
        });
      }
      return ids.length;
    });
  }
}
