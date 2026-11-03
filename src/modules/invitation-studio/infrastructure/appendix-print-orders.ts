import { randomUUID } from 'node:crypto';
import type {
  Prisma,
  PrismaClient,
  InvitationPrintRequest,
} from '../../../generated/prisma/client.js';
import type { z } from 'zod';
import type { contractLineSchema } from '../../booking-lifecycle/domain/commercial-contract.js';
import { appendixDocumentSchema } from '../../booking-lifecycle/domain/commercial-appendix.js';
import {
  fixedPrintLine,
  printRequestDocumentSchema,
  printRequestViewSchema,
} from '../domain/print-request.js';
import { printOrderConflict } from '../domain/print-policy.js';
import type { ContractContext } from '../../../core/database/booking-boundary.js';
import { asJson } from './studio.repository.js';

type Client = PrismaClient | Prisma.TransactionClient;
type Line = z.infer<typeof contractLineSchema>;

export async function requirePrintRequestChangesAllowed(
  client: Client,
  bookingId: string,
  afterLines: readonly Line[],
) {
  const orders = await client.invitationPrintOrder.findMany({
    where: { bookingId, status: { in: ['IN_PRODUCTION', 'READY_FOR_HANDOVER', 'HANDED_OVER'] } },
    select: { id: true },
  });
  if (!orders.length) return;
  const requests = await client.invitationPrintRequest.findMany({
    where: { bookingId, orderId: { in: orders.map((o) => o.id) } },
  });
  const allocations = await client.invitationPrintLine.findMany({
    where: { bookingId, orderId: { in: orders.map((o) => o.id) } },
  });
  for (const request of requests) {
    const document = printRequestDocumentSchema.parse(request.document);
    const lines = allocations.filter((line) => line.orderId === request.orderId);
    for (const source of document.lines) {
      const allocated = lines.find((line) => line.designId === source.designId);
      const agreed = afterLines.find(
        (line) => line.category === 'PRINT' && line.sourceId === source.line.sourceId,
      );
      if ((allocated?.quantity ?? 0) !== (agreed?.quantity ?? 0))
        throw printOrderConflict('PRINT_ORDER_ALREADY_IN_PRODUCTION');
    }
  }
}

/** Read-only Invitation owner facts for Booking's draft/submit validation. */
export async function resolveRequestPrintSelections(
  client: Client,
  bookingId: string,
  selections: readonly {
    category: string;
    sourceId: string;
    sourceRevisionId: string;
    quantity: number;
  }[],
) {
  const requests = await client.invitationPrintRequest.findMany({ where: { bookingId } });
  const sources = requests.flatMap((r) => printRequestDocumentSchema.parse(r.document).lines);
  const resolved = new Map<string, Line>();
  for (const selection of selections.filter((s) => s.category === 'PRINT')) {
    const source = sources.find((s) => s.line.sourceId === selection.sourceId);
    if (!source) continue;
    if (selection.sourceRevisionId !== source.line.sourceRevisionId)
      throw printOrderConflict('PRINT_QUOTE_STALE');
    resolved.set(
      'PRINT' + selection.sourceId,
      fixedPrintLine({ ...selection, title: source.title }),
    );
  }
  return resolved;
}

/** Expose retained previews on original and successor appendices, including removals. */
export async function appendixPrintRequests(
  client: Client,
  bookingId: string,
  bookingRevision: number,
  appendix: { id: string; state: string; document: Prisma.JsonValue },
  retainedRequests?: readonly InvitationPrintRequest[],
) {
  const doc = appendixDocumentSchema.parse(appendix.document);
  const ids = new Set(
    [...doc.beforeLines, ...doc.afterLines]
      .filter((l) => l.category === 'PRINT')
      .map((l) => l.sourceId),
  );
  const requests =
    retainedRequests ?? (await client.invitationPrintRequest.findMany({ where: { bookingId } }));
  return requests.flatMap((request) => {
    const document = printRequestDocumentSchema.parse(request.document);
    if (!document.lines.some((l) => ids.has(l.line.sourceId))) return [];
    // The appendix's item table is authoritative for changed quantities; retain
    // original source previews even when this revision removes the line.
    return [
      printRequestViewSchema.parse({
        requestId: request.id,
        bookingId,
        bookingRevision,
        appendixRevisionId: appendix.id,
        state: appendix.state,
        orderId: request.orderId,
        document,
      }),
    ];
  });
}

export async function linkPrintRequestSuccessors(
  client: Client,
  bookingId: string,
  revisionId: string,
  afterLines: readonly Line[],
) {
  const requests = await client.invitationPrintRequest.findMany({
    where: { bookingId, orderId: null },
  });
  for (const request of requests) {
    const doc = printRequestDocumentSchema.parse(request.document);
    if (
      doc.lines.some((source) =>
        afterLines.some(
          (line) => line.category === 'PRINT' && line.sourceId === source.line.sourceId,
        ),
      )
    )
      await client.invitationPrintRequest.update({
        where: { id: request.id },
        data: { appendixRevisionId: revisionId },
      });
  }
}

/** Booking invokes this enlisted owner port only after both same-version approvals. */
export async function synchronizeAppendixPrintOrders(
  client: Client,
  bookingId: string,
  revisionId: string,
  afterLines: readonly Line[],
  context: ContractContext,
) {
  const actorId = context.actorAccountId;
  if (!actorId) throw printOrderConflict('APPENDIX_APPROVAL_REQUIRED');
  const requests = await client.invitationPrintRequest.findMany({ where: { bookingId } });
  const charge = await client.billingLedgerEntry.findFirst({
    where: { bookingId, sourceType: 'CONTRACT_APPENDIX', sourceRevisionId: revisionId },
  });
  for (const request of requests) {
    const document = printRequestDocumentSchema.parse(request.document);
    const desired = document.lines.flatMap((source) => {
      const agreed = afterLines.find(
        (line) => line.category === 'PRINT' && line.sourceId === source.line.sourceId,
      );
      if (!agreed) return [];
      const expected = fixedPrintLine({
        sourceId: agreed.sourceId,
        sourceRevisionId: source.line.sourceRevisionId,
        title: source.title,
        quantity: agreed.quantity,
      });
      if (JSON.stringify(agreed) !== JSON.stringify(expected))
        throw printOrderConflict('FINANCIAL_SOURCE_CONFLICT');
      return [{ ...source, quantity: agreed.quantity, line: agreed }];
    });
    const order = request.orderId
      ? await client.invitationPrintOrder.findUniqueOrThrow({ where: { id: request.orderId } })
      : null;
    if (!order && desired.length === 0) continue;
    if (order?.status === 'CANCELLED' && desired.length === 0) continue;
    const existingLines = order
      ? await client.invitationPrintLine.findMany({ where: { orderId: order.id } })
      : [];
    const same =
      existingLines.length === desired.length &&
      desired.every((source) =>
        existingLines.some(
          (line) =>
            line.designId === source.designId &&
            line.printableRevisionId === source.printableRevisionId &&
            line.quantity === source.quantity,
        ),
      );
    if (order && same && order.status !== 'CANCELLED') continue;
    if (order && order.status !== 'APPROVED')
      throw printOrderConflict('PRINT_ORDER_ALREADY_IN_PRODUCTION');
    const now = new Date();
    if (order && desired.length === 0) {
      await client.invitationPrintOrder.update({
        where: { id: order.id },
        data: { status: 'CANCELLED', revision: { increment: 1 } },
      });
      await audit(order.id, 'CANCELLED', 'invitation.print-appendix-cancelled');
      await client.invitationPrintRequest.update({
        where: { id: request.id },
        data: { appendixRevisionId: revisionId },
      });
      continue;
    }
    const orderId = order?.id ?? randomUUID();
    const revisionNumber = order
      ? (
          await client.invitationCommercialRevision.findUniqueOrThrow({
            where: { id: order.currentCommercialRevisionId! },
          })
        ).revisionNumber + 1
      : 1;
    const commercialRevisionId = randomUUID();
    const quoted = [];
    if (order) await client.invitationPrintLine.deleteMany({ where: { orderId } });
    else
      await client.invitationPrintOrder.create({
        data: {
          id: orderId,
          bookingId,
          status: 'REQUESTED',
          approvedAt: now,
          receivableChargeId: charge?.id ?? null,
        },
      });
    if (!order)
      await client.invitationPrintRequest.update({
        where: { id: request.id },
        data: { orderId, appendixRevisionId: revisionId },
      });
    for (const source of desired) {
      const lineId = randomUUID();
      await client.invitationPrintLine.create({
        data: {
          id: lineId,
          orderId,
          bookingId,
          designId: source.designId,
          quantity: source.quantity,
          printableRevisionId: source.printableRevisionId,
        },
      });
      quoted.push({
        lineId,
        designId: source.designId,
        designRevisionId: source.designRevisionId,
        quantity: source.quantity,
        unitPriceVnd: source.line.unitPriceVnd,
        lineTotalVnd: source.line.lineTotalVnd,
      });
    }
    await client.invitationCommercialRevision.create({
      data: {
        id: commercialRevisionId,
        orderId,
        bookingId,
        revisionNumber,
        linesJson: quoted,
        orderTotalVnd: quoted.reduce((sum, l) => sum + l.lineTotalVnd, 0),
        expiresAt: now,
      },
    });
    await client.invitationPrintOrder.update({
      where: { id: orderId },
      data: {
        status: 'APPROVED',
        currentCommercialRevisionId: commercialRevisionId,
        ...(order ? { revision: { increment: 1 } } : {}),
      },
    });
    await client.invitationPrintRequest.update({
      where: { id: request.id },
      data: { orderId, appendixRevisionId: revisionId },
    });
    await audit(
      orderId,
      'APPROVED',
      order ? 'invitation.print-appendix-updated' : 'invitation.print-order-approved',
    );
    if (!order && charge) {
      const eventId = randomUUID();
      const envelope = {
        eventId,
        eventType: 'invitation.print-order-approved',
        eventVersion: 1,
        occurredAt: now.toISOString(),
        producerModule: 'invitation-studio',
        aggregateType: 'BOOKING',
        aggregateId: bookingId,
        correlationId: context.requestId,
        causationId: context.causationId,
        payload: {
          bookingId,
          printOrderId: orderId,
          commercialRevisionId,
          receivableChargeId: charge.id,
          approvedAt: now.toISOString(),
        },
      };
      await client.invitationStudioOutbox.create({
        data: { eventId, bookingId, eventType: envelope.eventType, envelope: asJson(envelope) },
      });
    }
    async function audit(orderId: string, toStatus: string, action: string) {
      await client.invitationPrintAudit.create({
        data: {
          id: randomUUID(),
          bookingId,
          orderId,
          actorId: actorId!,
          action,
          fromStatus: order?.status ?? null,
          toStatus,
          metadata: { appendixRevisionId: revisionId, requestId: request.id },
        },
      });
    }
  }
}

/** Guard the same retained source through production, independently of catalogue prices. */
export async function requireAppendixPrintProduction(
  client: Client,
  bookingId: string,
  orderId: string,
) {
  const request = await client.invitationPrintRequest.findUnique({ where: { orderId } });
  if (!request) return false;
  const doc = printRequestDocumentSchema.parse(request.document);
  const head = await client.commercialAppendixHead.findUniqueOrThrow({
    where: { bookingId },
    include: { currentRevision: true },
  });
  if (head.currentRevision && ['DRAFT', 'AWAITING_APPROVAL'].includes(head.currentRevision.state)) {
    const pending = appendixDocumentSchema.parse(head.currentRevision.document);
    for (const source of doc.lines) {
      const before = pending.beforeLines.find(
        (l) => l.sourceId === source.line.sourceId && l.category === 'PRINT',
      );
      const after = pending.afterLines.find(
        (l) => l.sourceId === source.line.sourceId && l.category === 'PRINT',
      );
      if (JSON.stringify(before) !== JSON.stringify(after))
        throw printOrderConflict('PRINT_APPENDIX_PENDING');
    }
  }
  const effective = await client.commercialAppendixRevision.findUniqueOrThrow({
    where: { id: head.effectiveRevisionId! },
  });
  if (effective.state !== 'APPROVED') throw printOrderConflict('APPENDIX_APPROVAL_REQUIRED');
  const afterLines = appendixDocumentSchema.parse(effective.document).afterLines;
  const lines = await client.invitationPrintLine.findMany({ where: { orderId, bookingId } });
  for (const line of lines) {
    const source = doc.lines.find(
      (l) => l.designId === line.designId && l.printableRevisionId === line.printableRevisionId,
    );
    const agreed =
      source &&
      afterLines.find((l) => l.category === 'PRINT' && l.sourceId === source.line.sourceId);
    if (!agreed || agreed.quantity !== line.quantity)
      throw printOrderConflict('CONTRACT_PRINT_SOURCE_CONFLICT');
  }
  return true;
}
