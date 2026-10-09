import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import type {
  PrismaBookingBoundary,
  ContractContext,
} from '../../../core/database/booking-boundary.js';
import {
  IdempotencyKeyReusedError,
  RequestInProgressError,
} from '../../../core/errors/app-error.js';
import { createPrismaAuditRepository } from '../../../core/audit/audit.repository.js';
import { parseStudio, digest, id } from '../domain/studio-policy.js';
import { idempotencyKeySchema } from '../../../core/idempotency/idempotency.schemas.js';
import type { MediaRequestContext } from '../application/media.contracts.js';
import { invitationPublicationEvent } from '../application/publication.events.js';

export const asJson = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export function contractContext(context: MediaRequestContext): ContractContext {
  return {
    requestId: context.requestId,
    causationId: context.causationId ?? context.requestId,
    actorAccountId: context.actorId,
    authority: 'AUTHENTICATED',
    ...(context.transactionScopeId === undefined
      ? {}
      : { transactionScopeId: context.transactionScopeId }),
  };
}
export class StudioRepository {
  constructor(
    readonly prisma: PrismaClient,
    readonly boundary: PrismaBookingBoundary,
  ) {}
  async command<T>(
    bookingValue: string,
    context: MediaRequestContext,
    keyValue: string,
    payload: unknown,
    authorize: (scoped: MediaRequestContext) => Promise<void>,
    work: (tx: Prisma.TransactionClient, scoped: MediaRequestContext) => Promise<T>,
    operation?: { action: string; resourceId?: string | null },
  ): Promise<T> {
    const bookingId = parseStudio(id, bookingValue),
      key = parseStudio(idempotencyKeySchema, keyValue);
    const action = operation?.action ?? 'default';
    const resourceId = operation?.resourceId ?? null;
    const intentDigest = digest({ actorId: context.actorId, action, key }),
      commandDigest = digest({
        bookingId,
        actorId: context.actorId,
        action,
        resourceId,
        payload,
      });
    await authorize(context);
    await this.prisma.invitationStudioCommand.createMany({
      data: { bookingId, intentDigest, commandDigest },
      skipDuplicates: true,
    });
    const bound = await this.prisma.invitationStudioCommand.findUniqueOrThrow({
      where: { bookingId_intentDigest: { bookingId, intentDigest } },
    });
    if (bound.commandDigest !== commandDigest) throw new IdempotencyKeyReusedError();
    return this.boundary.run(
      { bookingId, context: contractContext(context) },
      async (scope) => {
        const scoped = { ...context, transactionScopeId: scope.transactionScopeId! };
        const tx = this.boundary.requireScope(bookingId, scope);
        await authorize(scoped);
        const receipt = await tx.invitationStudioReceipt.findUnique({
          where: { bookingId_intentDigest: { bookingId, intentDigest } },
        });
        if (receipt !== null) return receipt.result as T;
        const result = await work(tx, scoped);
        await authorize(scoped);
        await tx.invitationStudioReceipt.create({
          data: { bookingId, intentDigest, result: asJson(result) },
        });
        return result;
      },
      async (tx) => {
        const [lock] = await tx.$queryRaw<
          Array<{ acquired: boolean }>
        >`SELECT pg_try_advisory_xact_lock(hashtextextended(${`studio-command:${bookingId}:${intentDigest}`},0)) AS acquired`;
        if (lock?.acquired !== true) throw new RequestInProgressError(1);
      },
    );
  }
  async audit(
    tx: Prisma.TransactionClient,
    context: MediaRequestContext,
    action: string,
    entityId: string,
    revision: number,
  ) {
    await createPrismaAuditRepository(tx).append({
      occurredAt: new Date(),
      requestId: context.requestId,
      actorType: 'USER',
      actorId: context.actorId,
      action,
      entityType: 'INVITATION',
      entityId,
      metadata: { revision },
    });
  }
  async publicationEvent(
    tx: Prisma.TransactionClient,
    bookingId: string,
    context: MediaRequestContext,
    payload: {
      publicInvitationId: string;
      publishedRevisionId: string;
      published: boolean;
      changedAt: string;
    },
  ) {
    const eventId = randomUUID();
    const { published, ...fact } = payload;
    const envelope = invitationPublicationEvent.parse({
      eventId,
      eventType: published ? 'invitation.publication-changed' : 'invitation.unpublished',
      eventVersion: 1,
      occurredAt: payload.changedAt,
      producerModule: 'invitation-studio',
      aggregateType: 'BOOKING',
      aggregateId: bookingId,
      correlationId: context.requestId,
      causationId: context.causationId ?? context.requestId,
      payload: { bookingId, ...fact },
    });
    await tx.invitationStudioOutbox.create({
      data: { eventId, bookingId, eventType: envelope.eventType, envelope: asJson(envelope) },
    });
  }
  async printQuotationIssuedEvent(
    tx: Prisma.TransactionClient,
    bookingId: string,
    context: MediaRequestContext,
    payload: {
      printOrderId: string;
      commercialRevisionId: string;
      quotedAt: string;
      expiresAt: string;
    },
  ) {
    const eventId = randomUUID();
    const envelope = {
      eventId,
      eventType: 'invitation.print-quotation-issued',
      eventVersion: 1,
      occurredAt: payload.quotedAt,
      producerModule: 'invitation-studio',
      aggregateType: 'BOOKING',
      aggregateId: bookingId,
      correlationId: context.requestId,
      causationId: context.causationId ?? context.requestId,
      payload: { bookingId, ...payload },
    };
    await tx.invitationStudioOutbox.create({
      data: { eventId, bookingId, eventType: envelope.eventType, envelope: asJson(envelope) },
    });
  }
  async printOrderApprovedEvent(
    tx: Prisma.TransactionClient,
    bookingId: string,
    context: MediaRequestContext,
    payload: {
      printOrderId: string;
      commercialRevisionId: string;
      receivableChargeId: string;
      approvedAt: string;
    },
  ) {
    const eventId = randomUUID();
    const envelope = {
      eventId,
      eventType: 'invitation.print-order-approved',
      eventVersion: 1,
      occurredAt: payload.approvedAt,
      producerModule: 'invitation-studio',
      aggregateType: 'BOOKING',
      aggregateId: bookingId,
      correlationId: context.requestId,
      causationId: context.causationId ?? context.requestId,
      payload: { bookingId, ...payload },
    };
    await tx.invitationStudioOutbox.create({
      data: { eventId, bookingId, eventType: envelope.eventType, envelope: asJson(envelope) },
    });
  }
  async printOrderReadyEvent(
    tx: Prisma.TransactionClient,
    bookingId: string,
    context: MediaRequestContext,
    payload: {
      printOrderId: string;
      readyAt: string;
    },
  ) {
    const eventId = randomUUID();
    const envelope = {
      eventId,
      eventType: 'invitation.print-order-ready',
      eventVersion: 1,
      occurredAt: payload.readyAt,
      producerModule: 'invitation-studio',
      aggregateType: 'BOOKING',
      aggregateId: bookingId,
      correlationId: context.requestId,
      causationId: context.causationId ?? context.requestId,
      payload: { bookingId, ...payload },
    };
    await tx.invitationStudioOutbox.create({
      data: { eventId, bookingId, eventType: envelope.eventType, envelope: asJson(envelope) },
    });
  }
  async recordTemplateDeniedAccess(context: MediaRequestContext) {
    await createPrismaAuditRepository(this.prisma).append({
      occurredAt: new Date(),
      requestId: context.requestId,
      actorType: 'USER',
      actorId: context.actorId,
      action: 'invitation.template-access-denied',
      entityType: 'INVITATION_TEMPLATE',
      entityId: null,
      metadata: {},
    });
  }
  async recordUnauthenticatedAccess(requestId: string) {
    await createPrismaAuditRepository(this.prisma).append({
      occurredAt: new Date(),
      requestId,
      actorType: 'SYSTEM',
      actorId: null,
      action: 'invitation.private-access-denied',
      entityType: 'INVITATION',
      entityId: null,
      metadata: {},
    });
  }
}
