import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client.js';
import { AppError, NotFoundError } from '../../../core/errors/app-error.js';
import { createPrintAppendixWorkflow } from '../../booking-lifecycle/application/print-appendix.workflow.js';
import type { MediaRequestContext } from '../application/media.contracts.js';
import { printPurchaseConfirmSchema } from '../domain/print-purchase.js';
import { parseStudio } from '../domain/studio-policy.js';
import { printOrderConflict, transitionOrderBodySchema } from '../domain/print-policy.js';
import { contractContext, type StudioRepository } from './studio.repository.js';
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
  async quote(bookingId: string, _raw: unknown, _key: string, context: MediaRequestContext) {
    await this.access.booking(bookingId, context, 'COUPLE');
    throw printOrderConflict('PRINT_APPENDIX_FLOW_REQUIRED');
  }
  async confirm(bookingId: string, raw: unknown, _key: string, context: MediaRequestContext) {
    const input = parseStudio(printPurchaseConfirmSchema, raw);
    await this.access.booking(bookingId, context, 'COUPLE');
    const quote = await this.repository.prisma.invitationPrintPurchaseQuote.findFirst({
      where: { id: input.quoteId, bookingId, actorId: context.actorId, digest: input.digest },
    });
    const existing =
      quote &&
      (await this.repository.prisma.invitationPrintPurchase.findUnique({
        where: { quoteId: quote.id },
      }));
    if (!existing) throw printOrderConflict('PRINT_APPENDIX_FLOW_REQUIRED');
    return this.orders.getPrintOrder(bookingId, existing.orderId, context);
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
