import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client.js';
import { enlistedPrismaClient } from '../../../core/database/enlisted-prisma-client.js';
import { createCommercialFinancialService } from '../../payments-billing/application/commercial-financial.service.js';
import { createBookingBoundaryUnitOfWork } from '../../../core/database/booking-unit-of-work.js';
import type { ContractContext } from './deposit.service.js';
import { createEffectiveCommercialReader } from '../infrastructure/effective-commercial.reader.js';
import { createContractedPrintEntitlementReader } from '../../invitation-studio/infrastructure/contracted-print.entitlement.reader.js';
import {
  appendixDigest,
  appendixDocumentSchema,
  calculateAppendixChange,
} from '../domain/commercial-appendix.js';
import { commercialConflict, contractLineSchema } from '../domain/commercial-contract.js';
import type { z } from 'zod';

/** Internal owner port. Caller must hold the booking boundary and authorize the actor. */
export function createPrintAppendixWorkflow(
  tx: Prisma.TransactionClient,
  context: ContractContext,
) {
  const client = enlistedPrismaClient(tx);
  // Enlist owner services in the supplied transaction, never open a second connection.
  const financial = createCommercialFinancialService(
    client,
    createBookingBoundaryUnitOfWork(client),
  );
  const localContext: ContractContext = {
    requestId: context.requestId,
    causationId: context.causationId,
    actorAccountId: context.actorAccountId,
    authority: context.authority,
  };
  async function changed(bookingId: string, revisionId: string, action: string) {
    const booking = await tx.booking.update({
      where: { id: bookingId },
      data: { revision: { increment: 1 } },
    });
    const payload = { bookingId, appendixRevisionId: revisionId };
    await tx.auditLog.create({
      data: {
        requestId: context.requestId,
        actorType: 'USER',
        actorId: context.actorAccountId,
        action: 'booking.appendix-' + action,
        entityType: 'commercial-appendix',
        entityId: revisionId,
        metadata: payload,
      },
    });
    await tx.bookingOutboxEvent.create({
      data: {
        id: randomUUID(),
        eventType: 'booking.appendix-' + action,
        eventVersion: 1,
        correlationId: context.requestId,
        causationId: context.causationId,
        aggregateId: bookingId,
        aggregateRevision: booking.revision,
        occurredAt: new Date(),
        payload,
      },
    });
  }
  return {
    requireMutable: (bookingId: string) => financial.requireMutable(bookingId, localContext),
    async create(
      bookingId: string,
      lineOrLines:
        z.infer<typeof contractLineSchema> | readonly z.infer<typeof contractLineSchema>[],
      coupleId: string,
      reason: string,
      remove = false,
    ) {
      await financial.requireMutable(bookingId, localContext);
      if (remove) {
        const booking = await tx.booking.findUniqueOrThrow({
          where: { id: bookingId },
          select: { consultationId: true },
        });
        const consent = await tx.consultationAccess.findFirst({
          where: {
            consultationId: booking.consultationId,
            accountId: coupleId,
            level: 'FULL',
            account: { status: 'ACTIVE' },
          },
          select: { id: true },
        });
        if (!consent) throw commercialConflict('PRINT_CUSTOMER_CONSENT_INVALID');
      }

      const effective = await createEffectiveCommercialReader(tx).getEffective(bookingId);
      const head = await tx.commercialAppendixHead.upsert({
        where: { bookingId },
        create: { bookingId },
        update: {},
        include: { currentRevision: true },
      });
      if (
        head.currentRevision &&
        ['DRAFT', 'AWAITING_APPROVAL'].includes(head.currentRevision.state)
      )
        throw commercialConflict('PRINT_APPENDIX_PENDING');
      const after = [...effective.lines];
      const requestedLines = contractLineSchema
        .array()
        .parse(Array.isArray(lineOrLines) ? lineOrLines : [lineOrLines]);
      for (const line of requestedLines) {
        const index = after.findIndex(
          (item) => item.category === 'PRINT' && item.sourceId === line.sourceId,
        );
        const prior = after[index];
        if (
          prior &&
          (prior.sourceRevisionId !== line.sourceRevisionId ||
            prior.unitPriceVnd !== line.unitPriceVnd)
        )
          throw commercialConflict('CONTRACT_PRINT_SOURCE_CONFLICT');
        const quantity = (prior?.quantity ?? 0) + (remove ? -line.quantity : line.quantity);
        if (quantity < 0 || quantity > 10000 || (remove && !prior))
          throw commercialConflict('CONTRACT_PRINT_SOURCE_CONFLICT');
        if (quantity === 0) after.splice(index, 1);
        else {
          const next = contractLineSchema.parse({
            ...line,
            quantity,
            lineTotalVnd: quantity * line.unitPriceVnd,
          });
          if (index < 0) after.push(next);
          else after[index] = next;
        }
      }
      const document = appendixDocumentSchema.parse({
        bookingId,
        contractRevisionId: effective.contract.contractRevisionId,
        predecessorRevisionId: effective.revisionId,
        brideName: effective.contract.document.brideName,
        groomName: effective.contract.document.groomName,
        reason,
        beforeLines: effective.lines,
        afterLines: after,
        ...calculateAppendixChange(effective.lines, after),
      });
      const id = randomUUID(),
        documentDigest = appendixDigest(document),
        occurredAt = new Date();
      await tx.commercialAppendixRevision.create({
        data: {
          id,
          bookingId,
          revisionNumber: (head.currentRevision?.revisionNumber ?? 0) + 1,
          predecessorRevisionId: effective.revisionId,
          contractRevisionId: document.contractRevisionId,
          state: 'DRAFT',
          document,
          documentDigest,
          deltaVnd: document.deltaVnd,
          effectiveTotalVnd: document.afterTotalVnd,
          createdByAccountId: coupleId,
          createdAt: occurredAt,
        },
      });
      await tx.commercialAppendixHead.update({
        where: { bookingId },
        data: { currentRevisionId: id },
      });
      await tx.commercialAppendixRevision.update({
        where: { id },
        data: { state: 'AWAITING_APPROVAL', submittedAt: occurredAt },
      });
      await tx.commercialAppendixApproval.create({
        data: {
          id: randomUUID(),
          revisionId: id,
          party: 'COUPLE',
          actorAccountId: coupleId,
          documentDigest,
          requestId: context.requestId,
          occurredAt,
        },
      });
      await changed(bookingId, id, 'submitted');
      return { id, documentDigest, document };
    },
    async approve(bookingId: string, revisionId: string, managerId: string) {
      await financial.requireMutable(bookingId, localContext);
      const row = await tx.commercialAppendixRevision.findFirstOrThrow({
        where: { id: revisionId, bookingId },
        include: { approvals: true },
      });
      const head = await tx.commercialAppendixHead.findUniqueOrThrow({ where: { bookingId } });
      const effective = await createEffectiveCommercialReader(tx).getEffective(bookingId);
      const document = appendixDocumentSchema.parse(row.document);
      if (
        row.state !== 'AWAITING_APPROVAL' ||
        head.currentRevisionId !== row.id ||
        row.predecessorRevisionId !== effective.revisionId ||
        appendixDigest(document) !== row.documentDigest ||
        row.approvals.length !== 1 ||
        row.approvals[0]?.party !== 'COUPLE' ||
        row.approvals[0].actorAccountId === managerId ||
        row.approvals[0].documentDigest !== row.documentDigest
      )
        throw commercialConflict('COMMERCIAL_PREDECESSOR_STALE');
      await createContractedPrintEntitlementReader(client).requirePreserved(
        bookingId,
        document.afterLines,
      );
      const occurredAt = new Date();
      await tx.commercialAppendixApproval.create({
        data: {
          id: randomUUID(),
          revisionId,
          party: 'MANAGER',
          actorAccountId: managerId,
          documentDigest: row.documentDigest,
          requestId: context.requestId,
          occurredAt,
        },
      });
      await tx.commercialAppendixRevision.update({
        where: { id: revisionId },
        data: { state: 'APPROVED', approvedAt: occurredAt },
      });
      await financial.registerAppendix(bookingId, revisionId, localContext);
      await tx.commercialAppendixHead.update({
        where: { bookingId },
        data: { effectiveRevisionId: revisionId },
      });
      await changed(bookingId, revisionId, 'approved');
    },
    async withdraw(bookingId: string, revisionId: string) {
      await financial.requireMutable(bookingId, localContext);
      const row = await tx.commercialAppendixRevision.findFirstOrThrow({
        where: { id: revisionId, bookingId },
      });
      if (row.state !== 'AWAITING_APPROVAL') throw commercialConflict('APPENDIX_NOT_EDITABLE');
      await tx.commercialAppendixRevision.update({
        where: { id: revisionId },
        data: { state: 'SUPERSEDED' },
      });
      await changed(bookingId, revisionId, 'withdrawn');
    },
  };
}
