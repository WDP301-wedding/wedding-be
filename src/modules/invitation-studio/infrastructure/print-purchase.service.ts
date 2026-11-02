import { requireUnusedContractCopies } from './print-purchase-policy.js';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client.js';
import { enlistedPrismaClient } from '../../../core/database/enlisted-prisma-client.js';
import { AppError, NotFoundError } from '../../../core/errors/app-error.js';
import { createPrintAppendixWorkflow } from '../../booking-lifecycle/application/print-appendix.workflow.js';
import { createEffectiveCommercialReader } from '../../booking-lifecycle/infrastructure/effective-commercial.reader.js';
import { createPrintOfferingReader } from '../../venue-catalog/application/print-offering.service.js';
import { contractLineSchema } from '../../booking-lifecycle/domain/commercial-contract.js';
import type { MediaRequestContext } from '../application/media.contracts.js';
import {
  printPurchaseInputSchema,
  printPurchaseConfirmSchema,
  printPurchaseDocumentSchema,
} from '../domain/print-purchase.js';
import { digest, parseStudio } from '../domain/studio-policy.js';
import {
  printOrderConflict,
  QUOTE_EXPIRY_DAYS,
  transitionOrderBodySchema,
} from '../domain/print-policy.js';
import { createInvitationTemplateSelectionReader } from './template-selection.reader.js';
import { asJson, contractContext, type StudioRepository } from './studio.repository.js';
import type { StudioAuthorization } from './studio-authorization.js';
import type { PrintableService } from './printable.service.js';
import type { PrintOrderService } from './print-order.service.js';

export class PrintPurchaseService {
  constructor(
    readonly repository: StudioRepository,
    readonly access: StudioAuthorization,
    readonly printable: PrintableService,
    readonly orders: PrintOrderService,
    readonly now = () => new Date(),
  ) {}
  async availability(bookingId: string, context: MediaRequestContext) {
    return this.repository.boundary.run(
      { bookingId, context: contractContext(context) },
      async (scope) => {
        const scoped = { ...context, transactionScopeId: scope.transactionScopeId! };
        await this.access.booking(bookingId, scoped, 'COUPLE');
        const tx = this.repository.boundary.requireScope(bookingId, scope);
        const booking = await tx.booking.findUniqueOrThrow({
          where: { id: bookingId },
          include: { depositSettlement: true },
        });
        const legacy =
          booking.commercialModelVersion === 'LEGACY_PROPOSAL_V1' &&
          !booking.depositSettlement?.contractRevisionId;
        if (booking.phase !== 'CONFIRMED')
          return {
            canOrder: false,
            legacy: false,
            blockReason: ['CANCELLED', 'COMPLETED'].includes(booking.phase)
              ? 'BOOKING_CLOSED'
              : 'SETTLED_CONTRACT_REQUIRED',
          };
        if (legacy) return { canOrder: false, legacy: true, blockReason: null };
        if (!booking.depositSettlement?.contractRevisionId)
          return { canOrder: false, legacy: false, blockReason: 'SETTLED_CONTRACT_REQUIRED' };
        try {
          await createPrintAppendixWorkflow(tx, contractContext(scoped)).requireMutable(bookingId);
        } catch (error) {
          if (error instanceof AppError && error.status === 409)
            return { canOrder: false, legacy: false, blockReason: error.code };
          throw error;
        }
        const head = await tx.commercialAppendixHead.findUnique({
          where: { bookingId },
          include: { currentRevision: true },
        });
        if (
          head?.currentRevision &&
          ['DRAFT', 'AWAITING_APPROVAL'].includes(head.currentRevision.state)
        )
          return { canOrder: false, legacy: false, blockReason: 'PRINT_APPENDIX_PENDING' };
        return { canOrder: true, legacy: false, blockReason: null };
      },
    );
  }
  private async eligible(tx: Prisma.TransactionClient, bookingId: string) {
    const booking = await tx.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { depositSettlement: true },
    });
    if (booking.phase !== 'CONFIRMED' || !booking.depositSettlement?.contractRevisionId)
      throw printOrderConflict('SETTLED_CONTRACT_REQUIRED');
    return booking;
  }
  async quote(bookingId: string, raw: unknown, key: string, context: MediaRequestContext) {
    const input = parseStudio(printPurchaseInputSchema, raw);
    return this.repository.command(
      bookingId,
      context,
      key,
      input,
      (ctx) => this.access.booking(bookingId, ctx, 'COUPLE'),
      async (tx, scoped) => {
        await this.eligible(tx, bookingId);
        await createPrintAppendixWorkflow(tx, contractContext(scoped)).requireMutable(bookingId);
        const design = await tx.invitationDesign.findFirst({
          where: { id: input.designId, bookingId },
        });
        if (!design || design.currentRevisionId !== input.designRevisionId)
          throw printOrderConflict('PRINT_QUOTE_STALE');
        const facts = await createPrintOfferingReader(
          enlistedPrismaClient(tx),
          createInvitationTemplateSelectionReader,
        ).requireSelection({
          offeringId: input.offeringId,
          sourceRevisionId: input.sourceRevisionId,
          quantity: input.quantity,
        });
        if (facts.unitPriceVnd <= 0) throw printOrderConflict('PRINT_PRICE_INVALID');
        const effective = await createEffectiveCommercialReader(tx).getEffective(bookingId);
        await requireUnusedContractCopies(tx, bookingId, effective.lines, facts);
        if (facts.restaurantId !== effective.contract.document.restaurantId)
          throw new NotFoundError();
        const source = await tx.invitationDesignRevision.findUniqueOrThrow({
          where: { id: input.designRevisionId },
        });
        if (
          source.sourceTemplateVersionId &&
          source.sourceTemplateVersionId !== facts.templateVersionId
        )
          throw printOrderConflict('CONTRACT_PRINT_TEMPLATE_CONFLICT');
        const captured = await this.printable.capture(
          { bookingId, designRevisionId: input.designRevisionId },
          contractContext(scoped),
        );
        const line = contractLineSchema.parse({
          category: 'PRINT',
          sourceId: facts.offeringId,
          sourceRevisionId: facts.sourceRevisionId,
          name: facts.name,
          description: `${facts.printType} · ${facts.material}`,
          unit: 'copy',
          quantity: input.quantity,
          unitPriceVnd: facts.unitPriceVnd,
          lineTotalVnd: facts.lineTotalVnd,
        });
        const document = printPurchaseDocumentSchema.parse({
          ...input,
          predecessorRevisionId: effective.revisionId,
          printableRevisionId: captured.printableRevisionId,
          contentDigest: captured.contentDigest,
          line,
          material: facts.material,
          printType: facts.printType,
          templateVersionId: facts.templateVersionId,
        });
        const quoteId = randomUUID(),
          hash = digest(document),
          expiresAt = new Date(this.now().getTime() + QUOTE_EXPIRY_DAYS * 86400000);
        await tx.invitationPrintPurchaseQuote.create({
          data: {
            id: quoteId,
            bookingId,
            actorId: scoped.actorId,
            document,
            digest: hash,
            expiresAt,
          },
        });
        return { quoteId, digest: hash, expiresAt: expiresAt.toISOString(), document };
      },
      { action: 'print-purchase.quote' },
    );
  }
  async confirm(bookingId: string, raw: unknown, key: string, context: MediaRequestContext) {
    const input = parseStudio(printPurchaseConfirmSchema, raw);
    const orderId = await this.repository.command(
      bookingId,
      context,
      key,
      input,
      (ctx) => this.access.booking(bookingId, ctx, 'COUPLE'),
      async (tx, scoped) => {
        const quote = await tx.invitationPrintPurchaseQuote.findFirst({
          where: { id: input.quoteId, bookingId, actorId: scoped.actorId },
        });
        if (!quote || quote.digest !== input.digest || digest(quote.document) !== quote.digest)
          throw printOrderConflict('PRINT_QUOTE_STALE');
        const existing = await tx.invitationPrintPurchase.findUnique({
          where: { quoteId: quote.id },
        });
        if (existing) return existing.orderId;
        if (quote.expiresAt <= this.now()) throw printOrderConflict('PRINT_QUOTE_EXPIRED');
        await this.eligible(tx, bookingId);
        const document = printPurchaseDocumentSchema.parse(quote.document);
        const design = await tx.invitationDesign.findUniqueOrThrow({
          where: { id: document.designId },
        });
        if (design.currentRevisionId !== document.designRevisionId)
          throw printOrderConflict('PRINT_QUOTE_STALE');
        // Current catalogue and retained content must still match the exact price/preview shown.
        const facts = await createPrintOfferingReader(
          enlistedPrismaClient(tx),
          createInvitationTemplateSelectionReader,
        ).requireSelection({
          offeringId: document.offeringId,
          sourceRevisionId: document.sourceRevisionId,
          quantity: document.quantity,
        });
        if (facts.unitPriceVnd !== document.line.unitPriceVnd)
          throw printOrderConflict('PRINT_QUOTE_STALE');
        const captured = await this.printable.capture(
          { bookingId, designRevisionId: document.designRevisionId },
          contractContext(scoped),
        );
        if (captured.contentDigest !== document.contentDigest)
          throw printOrderConflict('PRINT_QUOTE_STALE');
        const effective = await createEffectiveCommercialReader(tx).getEffective(bookingId);
        await requireUnusedContractCopies(tx, bookingId, effective.lines, facts);
        if (effective.revisionId !== document.predecessorRevisionId)
          throw printOrderConflict('COMMERCIAL_PREDECESSOR_STALE');
        const appendix = await createPrintAppendixWorkflow(tx, contractContext(scoped)).create(
          bookingId,
          document.line,
          scoped.actorId,
          'Đặt in thiệp sau đặt cọc',
        );
        const id = randomUUID(),
          lineId = randomUUID(),
          revisionId = randomUUID();
        await tx.invitationPrintOrder.create({
          data: { id, bookingId, status: 'REQUESTED', revision: 1 },
        });
        await tx.invitationPrintLine.create({
          data: {
            id: lineId,
            orderId: id,
            bookingId,
            designId: document.designId,
            quantity: document.quantity,
            printableRevisionId: document.printableRevisionId,
            commercialSource: {
              agreementRevisionId: appendix.id,
              offeringId: document.offeringId,
              sourceRevisionId: document.sourceRevisionId,
              templateVersionId: document.templateVersionId,
              material: document.material,
              printType: document.printType,
              unitPriceVnd: document.line.unitPriceVnd,
            },
          },
        });
        await tx.invitationCommercialRevision.create({
          data: {
            id: revisionId,
            orderId: id,
            bookingId,
            revisionNumber: 1,
            linesJson: [
              {
                lineId,
                designId: document.designId,
                designRevisionId: document.designRevisionId,
                quantity: document.quantity,
                unitPriceVnd: document.line.unitPriceVnd,
                lineTotalVnd: document.line.lineTotalVnd,
              },
            ],
            orderTotalVnd: document.line.lineTotalVnd,
            estimatedHandoverAt: null,
            expiresAt: quote.expiresAt,
          },
        });
        await tx.invitationPrintOrder.update({
          where: { id },
          data: { currentCommercialRevisionId: revisionId },
        });
        await tx.invitationPrintPurchase.create({
          data: { orderId: id, bookingId, quoteId: quote.id, appendixRevisionId: appendix.id },
        });
        await this.repository.printQuotationIssuedEvent(tx, bookingId, scoped, {
          printOrderId: id,
          commercialRevisionId: revisionId,
          quotedAt: this.now().toISOString(),
          expiresAt: quote.expiresAt.toISOString(),
        });
        await tx.invitationPrintAudit.create({
          data: {
            id: randomUUID(),
            bookingId,
            orderId: id,
            actorId: scoped.actorId,
            action: 'invitation.print-cost-confirmed',
            toStatus: 'REQUESTED',
            metadata: asJson({
              quoteId: quote.id,
              digest: quote.digest,
              appendixRevisionId: appendix.id,
            }),
          },
        });
        return id;
      },
      { action: 'print-purchase.confirm' },
    );
    return this.orders.getPrintOrder(bookingId, orderId, context);
  }
  async approve(orderId: string, raw: unknown, key: string, context: MediaRequestContext) {
    const input = parseStudio(transitionOrderBodySchema, raw);
    const order = await this.repository.prisma.invitationPrintOrder.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundError();
    const bookingId = order.bookingId;
    await this.repository.command(
      bookingId,
      context,
      key,
      input,
      (ctx) => this.access.booking(bookingId, ctx, 'MANAGER'),
      async (tx, scoped) => {
        await this.eligible(tx, bookingId);
        const current = await tx.invitationPrintOrder.findUniqueOrThrow({ where: { id: orderId } });
        const purchase = await tx.invitationPrintPurchase.findUniqueOrThrow({ where: { orderId } });
        if (current.revision !== input.expectedRevision || current.status !== 'REQUESTED')
          throw printOrderConflict('PRINT_QUOTE_STALE');
        const quote = await tx.invitationPrintPurchaseQuote.findUniqueOrThrow({
          where: { id: purchase.quoteId },
        });
        if (quote.expiresAt <= this.now()) throw printOrderConflict('PRINT_QUOTE_EXPIRED');
        await createPrintAppendixWorkflow(tx, contractContext(scoped)).approve(
          bookingId,
          purchase.appendixRevisionId,
          scoped.actorId,
        );
        const charge = await tx.billingLedgerEntry.findFirstOrThrow({
          where: {
            bookingId,
            sourceType: 'CONTRACT_APPENDIX',
            sourceRevisionId: purchase.appendixRevisionId,
          },
        });
        await tx.invitationPrintOrder.update({
          where: { id: orderId },
          data: {
            status: 'APPROVED',
            revision: { increment: 1 },
            approvedAt: this.now(),
            receivableChargeId: charge.id,
          },
        });
        await this.repository.printOrderApprovedEvent(tx, bookingId, scoped, {
          printOrderId: orderId,
          commercialRevisionId: current.currentCommercialRevisionId!,
          receivableChargeId: charge.id,
          approvedAt: this.now().toISOString(),
        });
        await tx.invitationPrintAudit.create({
          data: {
            id: randomUUID(),
            bookingId,
            orderId,
            actorId: scoped.actorId,
            action: 'invitation.print-purchase-approved',
            fromStatus: 'REQUESTED',
            toStatus: 'APPROVED',
            metadata: { appendixRevisionId: purchase.appendixRevisionId },
          },
        });
        return { orderId };
      },
      { action: 'print-purchase.approve', resourceId: orderId },
    );
    return this.orders.getPrintOrder(null, orderId, context);
  }
}
