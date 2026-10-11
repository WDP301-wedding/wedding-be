import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client.js';
import { NotFoundError, ValidationError } from '../../../core/errors/app-error.js';
import type {
  BookingMediaPrerequisiteReader,
  BookingTimelineSnapshotReader,
} from '../../booking-lifecycle/application/booking-readers.js';
import type {
  BillingReader,
  BookingChargeRegistrar,
  BookingChargeAdjustmentRegistrar,
} from '../../payments-billing/application/billing.contracts.js';
import type { MediaRequestContext } from '../application/media.contracts.js';
import type { PrintOrderView, QuotedLineView } from '../application/print-order.contracts.js';
import { id, parseStudio } from '../domain/studio-policy.js';
import {
  type PrintOrderStatus,
  QUOTE_EXPIRY_DAYS,
  requestPrintOrderBodySchema,
  quotePrintOrderBodySchema,
  approvePrintOrderBodySchema,
  transitionOrderBodySchema,
  handoverOrderBodySchema,
  cancelOrderBodySchema,
  cancellationIntentBodySchema,
  replacementProposalBodySchema,
  replacementApprovalBodySchema,
  computeCommercialTotal,
  assertValidEstimatedHandover,
  assertQuoteNotExpired,
  printOrderConflict,
} from '../domain/print-policy.js';
import { contractContext, asJson, type StudioRepository } from './studio.repository.js';
import type { StudioAuthorization } from './studio-authorization.js';
import type { PrintableService } from './printable.service.js';
import type { ContractedPrintFulfillment } from './contracted-print.fulfillment.js';
import { commercialPrintSnapshotSchema } from '../domain/contracted-print.js';

export class PrintOrderService {
  constructor(
    readonly repository: StudioRepository,
    readonly authorization: StudioAuthorization,
    readonly printable: PrintableService,
    readonly billing: BillingReader & BookingChargeRegistrar & BookingChargeAdjustmentRegistrar,
    readonly booking: BookingMediaPrerequisiteReader,
    readonly timeline: BookingTimelineSnapshotReader,
    readonly now: () => Date = () => new Date(),
    readonly fulfillment?: ContractedPrintFulfillment,
  ) {}

  private mapOrderView(
    order: {
      id: string;
      bookingId: string;
      status: string;
      revision: number;
      currentCommercialRevisionId: string | null;
      receivableChargeId: string | null;
      readyAt: Date | null;
      handedOverAt: Date | null;
      evidenceReference: string | null;
      createdAt: Date;
      updatedAt: Date;
    },
    lines: Array<{
      id: string;
      designId: string;
      quantity: number;
      printableRevisionId: string | null;
      commercialSource?: Prisma.JsonValue;
    }>,
    currentCommercialRevision: {
      id: string;
      revisionNumber: number;
      linesJson: Prisma.JsonValue;
      orderTotalVnd: Prisma.Decimal;
      estimatedHandoverAt: Date;
      expiresAt: Date;
      createdAt: Date;
    } | null,
    pendingReplacementProposal: {
      id: string;
      revisionNumber: number;
      linesJson: Prisma.JsonValue;
      orderTotalVnd: Prisma.Decimal;
      estimatedHandoverAt: Date;
      expiresAt: Date;
      createdAt: Date;
    } | null = null,
  ): PrintOrderView {
    return {
      orderId: order.id,
      bookingId: order.bookingId,
      status: order.status as PrintOrderStatus,
      revision: order.revision,
      lines: lines.map((l) => ({
        lineId: l.id,
        designId: l.designId,
        quantity: l.quantity,
        printableRevisionId: l.printableRevisionId,
        ...(l.commercialSource == null
          ? {}
          : { commercialSource: commercialPrintSnapshotSchema.parse(l.commercialSource) }),
      })),
      currentCommercialRevisionId: order.currentCommercialRevisionId,
      currentCommercialRevision: currentCommercialRevision
        ? {
            commercialRevisionId: currentCommercialRevision.id,
            revisionNumber: currentCommercialRevision.revisionNumber,
            lines: currentCommercialRevision.linesJson as unknown as QuotedLineView[],
            orderTotalVnd: currentCommercialRevision.orderTotalVnd.toNumber(),
            estimatedHandoverAt: currentCommercialRevision.estimatedHandoverAt.toISOString(),
            expiresAt: currentCommercialRevision.expiresAt.toISOString(),
            createdAt: currentCommercialRevision.createdAt.toISOString(),
          }
        : null,
      pendingReplacementProposal: pendingReplacementProposal
        ? {
            commercialRevisionId: pendingReplacementProposal.id,
            revisionNumber: pendingReplacementProposal.revisionNumber,
            lines: pendingReplacementProposal.linesJson as unknown as QuotedLineView[],
            orderTotalVnd: pendingReplacementProposal.orderTotalVnd.toNumber(),
            estimatedHandoverAt: pendingReplacementProposal.estimatedHandoverAt.toISOString(),
            expiresAt: pendingReplacementProposal.expiresAt.toISOString(),
            createdAt: pendingReplacementProposal.createdAt.toISOString(),
          }
        : null,
      receivableChargeId: order.receivableChargeId,
      readyAt: order.readyAt?.toISOString() ?? null,
      handedOverAt: order.handedOverAt?.toISOString() ?? null,
      evidenceReference: order.evidenceReference,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  }

  async requestPrintOrder(
    bookingId: string,
    body: unknown,
    idempotencyKey: string,
    context: MediaRequestContext,
  ): Promise<PrintOrderView> {
    const input = parseStudio(requestPrintOrderBodySchema, body);
    const parsedBookingId = parseStudio(id, bookingId);

    return this.repository.command(
      parsedBookingId,
      context,
      idempotencyKey,
      input,
      async (scoped) => {
        await this.authorization.booking(parsedBookingId, scoped, 'COUPLE');
        await this.booking.requireConfirmedEventContext(parsedBookingId);
      },
      async (tx, scoped) => {
        for (const line of input.lines) {
          const design = await tx.invitationDesign.findFirst({
            where: { id: line.designId, bookingId: parsedBookingId },
          });
          if (design === null) {
            throw new ValidationError();
          }
        }

        const orderId = randomUUID();
        const createdOrder = await tx.invitationPrintOrder.create({
          data: {
            id: orderId,
            bookingId: parsedBookingId,
            status: 'REQUESTED',
            revision: 1,
          },
        });

        const createdLines: Array<{
          id: string;
          designId: string;
          quantity: number;
          printableRevisionId: string | null;
        }> = [];

        for (const line of input.lines) {
          const lineId = randomUUID();
          const commercialSource = await this.fulfillment?.snapshot(
            tx,
            parsedBookingId,
            line.designId,
            line.quantity,
            line.commercialSource,
          );
          const createdLine = await tx.invitationPrintLine.create({
            data: {
              id: lineId,
              orderId,
              bookingId: parsedBookingId,
              designId: line.designId,
              quantity: line.quantity,
              printableRevisionId: null,
              ...(commercialSource == null ? {} : { commercialSource: asJson(commercialSource) }),
            },
          });
          createdLines.push(createdLine);
        }

        await tx.invitationPrintAudit.create({
          data: {
            id: randomUUID(),
            bookingId: parsedBookingId,
            orderId,
            actorId: scoped.actorId,
            action: 'invitation.print-order-requested',
            fromStatus: null,
            toStatus: 'REQUESTED',
            metadata: asJson({ linesCount: input.lines.length }),
          },
        });

        return this.mapOrderView(createdOrder, createdLines, null);
      },
      { action: 'print-order.request' },
    );
  }

  async quotePrintOrder(
    orderId: string,
    body: unknown,
    idempotencyKey: string,
    context: MediaRequestContext,
  ): Promise<PrintOrderView> {
    const input = parseStudio(quotePrintOrderBodySchema, body);
    const parsedOrderId = parseStudio(id, orderId);

    const existingOrder = await this.repository.prisma.invitationPrintOrder.findUnique({
      where: { id: parsedOrderId },
    });
    if (existingOrder === null) {
      throw new NotFoundError();
    }
    const bookingId = existingOrder.bookingId;

    return this.repository.command(
      bookingId,
      context,
      idempotencyKey,
      input,
      async (scoped) => {
        await this.authorization.manager(scoped);
      },
      async (tx, scoped) => {
        const order = await tx.invitationPrintOrder.findUniqueOrThrow({
          where: { id: parsedOrderId },
        });

        if (order.revision !== input.expectedRevision) {
          throw printOrderConflict('PRINT_QUOTE_STALE');
        }

        if (order.status !== 'REQUESTED' && order.status !== 'QUOTED') {
          throw printOrderConflict('PRINT_ORDER_STATE_INVALID');
        }

        const lines = await tx.invitationPrintLine.findMany({
          where: { orderId: parsedOrderId },
        });

        if (lines.length !== input.lines.length) {
          throw new ValidationError();
        }

        const linesWithQuantity = lines.map((l) => ({
          lineId: l.id,
          designId: l.designId,
          quantity: l.quantity,
        }));

        const quoteInputs = input.lines.map((l) => ({
          lineId: l.lineId,
          unitPriceVnd: l.unitPriceVnd,
        }));
        const contractObligation = await this.fulfillment?.validateOrder(
          tx,
          bookingId,
          parsedOrderId,
          new Map(quoteInputs.map((l) => [l.lineId, l.unitPriceVnd])),
        );

        const { quotedLines, orderTotalVnd } = computeCommercialTotal(
          linesWithQuantity,
          quoteInputs,
          contractObligation != null,
        );

        const currentTime = this.now();
        const estimatedHandoverDate = new Date(input.estimatedHandoverAt);
        assertValidEstimatedHandover(estimatedHandoverDate, currentTime);

        const expiresAt = new Date(currentTime.getTime() + QUOTE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

        const quotedLinesWithDesignRevision: Array<QuotedLineView & { designRevisionId: string }> =
          [];
        for (const q of quotedLines) {
          const design = await tx.invitationDesign.findUniqueOrThrow({
            where: { id: q.designId },
          });
          quotedLinesWithDesignRevision.push({
            ...q,
            designRevisionId: design.currentRevisionId,
          });
        }

        const lastRev = await tx.invitationCommercialRevision.findFirst({
          where: { orderId: parsedOrderId },
          orderBy: { revisionNumber: 'desc' },
        });
        const nextRevisionNumber = (lastRev?.revisionNumber ?? 0) + 1;
        const commercialRevisionId = randomUUID();

        const createdCommercialRevision = await tx.invitationCommercialRevision.create({
          data: {
            id: commercialRevisionId,
            orderId: parsedOrderId,
            bookingId,
            revisionNumber: nextRevisionNumber,
            linesJson: asJson(quotedLinesWithDesignRevision),
            orderTotalVnd,
            estimatedHandoverAt: estimatedHandoverDate,
            expiresAt,
          },
        });

        const nextRevision = order.revision + 1;
        const updatedOrder = await tx.invitationPrintOrder.update({
          where: { id: parsedOrderId },
          data: {
            status: 'QUOTED',
            currentCommercialRevisionId: commercialRevisionId,
            revision: nextRevision,
          },
        });

        await this.repository.printQuotationIssuedEvent(tx, bookingId, scoped, {
          printOrderId: parsedOrderId,
          commercialRevisionId,
          quotedAt: currentTime.toISOString(),
          expiresAt: expiresAt.toISOString(),
        });

        await tx.invitationPrintAudit.create({
          data: {
            id: randomUUID(),
            bookingId,
            orderId: parsedOrderId,
            actorId: scoped.actorId,
            action: 'invitation.print-quotation-issued',
            fromStatus: order.status,
            toStatus: 'QUOTED',
            metadata: asJson({
              commercialRevisionId,
              revisionNumber: nextRevisionNumber,
              orderTotalVnd,
            }),
          },
        });

        return this.mapOrderView(updatedOrder, lines, createdCommercialRevision);
      },
      { action: 'print-order.quote', resourceId: parsedOrderId },
    );
  }

  async approvePrintOrder(
    bookingId: string,
    orderId: string,
    body: unknown,
    idempotencyKey: string,
    context: MediaRequestContext,
  ): Promise<PrintOrderView> {
    const input = parseStudio(approvePrintOrderBodySchema, body);
    const parsedBookingId = parseStudio(id, bookingId);
    const parsedOrderId = parseStudio(id, orderId);

    return this.repository.command(
      parsedBookingId,
      context,
      idempotencyKey,
      input,
      async (scoped) => {
        await this.authorization.booking(parsedBookingId, scoped, 'COUPLE');
      },
      async (tx, scoped) => {
        const order = await tx.invitationPrintOrder.findFirst({
          where: { id: parsedOrderId, bookingId: parsedBookingId },
        });
        if (order === null) {
          throw new NotFoundError();
        }

        if (order.revision !== input.expectedRevision) {
          throw printOrderConflict('PRINT_QUOTE_STALE');
        }

        if (order.status !== 'QUOTED') {
          throw printOrderConflict('PRINT_ORDER_STATE_INVALID');
        }

        if (order.currentCommercialRevisionId !== input.commercialRevisionId) {
          throw printOrderConflict('PRINT_QUOTE_STALE');
        }

        const commercialRevision = await tx.invitationCommercialRevision.findUniqueOrThrow({
          where: { id: input.commercialRevisionId },
        });

        const currentTime = this.now();
        assertQuoteNotExpired(commercialRevision.expiresAt, currentTime);

        const lines = await tx.invitationPrintLine.findMany({
          where: { orderId: parsedOrderId },
        });

        const quotedLines = commercialRevision.linesJson as unknown as Array<
          QuotedLineView & { designRevisionId: string }
        >;
        const quotedMap = new Map(quotedLines.map((q) => [q.lineId, q]));

        const updatedLines: Array<{
          id: string;
          designId: string;
          quantity: number;
          printableRevisionId: string | null;
        }> = [];

        for (const line of lines) {
          const qLine = quotedMap.get(line.id);
          if (qLine === undefined) {
            throw new ValidationError();
          }

          const captureResult = await this.printable.capture(
            { bookingId: parsedBookingId, designRevisionId: qLine.designRevisionId },
            contractContext(scoped),
          );

          await tx.invitationPrintLine.update({
            where: { id: line.id },
            data: { printableRevisionId: captureResult.printableRevisionId },
          });

          updatedLines.push({
            id: line.id,
            designId: line.designId,
            quantity: line.quantity,
            printableRevisionId: captureResult.printableRevisionId,
            ...(line.commercialSource == null ? {} : { commercialSource: line.commercialSource }),
          });
        }

        const obligation = await this.fulfillment?.validateOrder(
          tx,
          parsedBookingId,
          parsedOrderId,
          new Map(quotedLines.map((l) => [l.lineId, l.unitPriceVnd])),
        );
        const chargeResult = obligation
          ? { receivableChargeId: obligation, replayed: false }
          : await this.billing.registerAcceptedCharge({
              bookingId: parsedBookingId,
              sourceType: 'PRINT_ORDER',
              sourceRevisionId: commercialRevision.id,
              amountVnd: commercialRevision.orderTotalVnd.toNumber(),
              acceptedAt: currentTime,
            });

        const nextRevision = order.revision + 1;
        const updatedOrder = await tx.invitationPrintOrder.update({
          where: { id: parsedOrderId },
          data: {
            status: 'APPROVED',
            receivableChargeId: chargeResult.receivableChargeId,
            approvedAt: currentTime,
            revision: nextRevision,
          },
        });

        await this.repository.printOrderApprovedEvent(tx, parsedBookingId, scoped, {
          printOrderId: parsedOrderId,
          commercialRevisionId: commercialRevision.id,
          receivableChargeId: chargeResult.receivableChargeId,
          approvedAt: currentTime.toISOString(),
        });

        await tx.invitationPrintAudit.create({
          data: {
            id: randomUUID(),
            bookingId: parsedBookingId,
            orderId: parsedOrderId,
            actorId: scoped.actorId,
            action: 'invitation.print-order-approved',
            fromStatus: order.status,
            toStatus: 'APPROVED',
            metadata: asJson({
              commercialRevisionId: commercialRevision.id,
              receivableChargeId: chargeResult.receivableChargeId,
            }),
          },
        });

        return this.mapOrderView(updatedOrder, updatedLines, commercialRevision);
      },
      { action: 'print-order.approve', resourceId: parsedOrderId },
    );
  }

  async startProduction(
    orderId: string,
    body: unknown,
    idempotencyKey: string,
    context: MediaRequestContext,
  ): Promise<PrintOrderView> {
    const input = parseStudio(transitionOrderBodySchema, body);
    const parsedOrderId = parseStudio(id, orderId);

    const existingOrder = await this.repository.prisma.invitationPrintOrder.findUnique({
      where: { id: parsedOrderId },
    });
    if (existingOrder === null) {
      throw new NotFoundError();
    }
    const bookingId = existingOrder.bookingId;

    return this.repository.command(
      bookingId,
      context,
      idempotencyKey,
      input,
      async (scoped) => {
        await this.authorization.manager(scoped);
      },
      async (tx, scoped) => {
        const order = await tx.invitationPrintOrder.findUniqueOrThrow({
          where: { id: parsedOrderId },
        });

        if (order.revision !== input.expectedRevision) {
          throw printOrderConflict('PRINT_QUOTE_STALE');
        }

        if (order.status !== 'APPROVED') {
          throw printOrderConflict('PRINT_ORDER_STATE_INVALID');
        }

        await this.fulfillment?.validateOrder(tx, bookingId, parsedOrderId, undefined, false);

        const approvedRevision = await tx.invitationCommercialRevision.findUniqueOrThrow({
          where: { id: order.currentCommercialRevisionId! },
        });

        const pendingProposal = await tx.invitationCommercialRevision.findFirst({
          where: {
            orderId: parsedOrderId,
            revisionNumber: { gt: approvedRevision.revisionNumber },
          },
          orderBy: { revisionNumber: 'desc' },
        });

        if (
          pendingProposal !== null &&
          this.now().getTime() <= pendingProposal.expiresAt.getTime()
        ) {
          throw printOrderConflict(
            'PRINT_REPLACEMENT_PENDING',
            'A replacement proposal is pending approval.',
          );
        }

        const lines = await tx.invitationPrintLine.findMany({
          where: { orderId: parsedOrderId },
        });

        const nextRevision = order.revision + 1;
        const updatedOrder = await tx.invitationPrintOrder.update({
          where: { id: parsedOrderId },
          data: {
            status: 'IN_PRODUCTION',
            revision: nextRevision,
          },
        });

        await tx.invitationPrintAudit.create({
          data: {
            id: randomUUID(),
            bookingId,
            orderId: parsedOrderId,
            actorId: scoped.actorId,
            action: 'invitation.print-order-production-started',
            fromStatus: order.status,
            toStatus: 'IN_PRODUCTION',
            metadata: asJson({ revision: nextRevision }),
          },
        });

        return this.mapOrderView(updatedOrder, lines, approvedRevision, null);
      },
      { action: 'print-order.production-start', resourceId: parsedOrderId },
    );
  }

  async markReadyForHandover(
    orderId: string,
    body: unknown,
    idempotencyKey: string,
    context: MediaRequestContext,
  ): Promise<PrintOrderView> {
    const input = parseStudio(transitionOrderBodySchema, body);
    const parsedOrderId = parseStudio(id, orderId);

    const existingOrder = await this.repository.prisma.invitationPrintOrder.findUnique({
      where: { id: parsedOrderId },
    });
    if (existingOrder === null) {
      throw new NotFoundError();
    }
    const bookingId = existingOrder.bookingId;

    return this.repository.command(
      bookingId,
      context,
      idempotencyKey,
      input,
      async (scoped) => {
        await this.authorization.manager(scoped);
      },
      async (tx, scoped) => {
        const order = await tx.invitationPrintOrder.findUniqueOrThrow({
          where: { id: parsedOrderId },
        });

        if (order.revision !== input.expectedRevision) {
          throw printOrderConflict('PRINT_QUOTE_STALE');
        }

        if (order.status !== 'IN_PRODUCTION') {
          throw printOrderConflict('PRINT_ORDER_STATE_INVALID');
        }

        const currentRev = await tx.invitationCommercialRevision.findUniqueOrThrow({
          where: { id: order.currentCommercialRevisionId! },
        });

        const lines = await tx.invitationPrintLine.findMany({
          where: { orderId: parsedOrderId },
        });

        const currentTime = this.now();
        const nextRevision = order.revision + 1;
        const updatedOrder = await tx.invitationPrintOrder.update({
          where: { id: parsedOrderId },
          data: {
            status: 'READY_FOR_HANDOVER',
            readyAt: currentTime,
            revision: nextRevision,
          },
        });

        await this.repository.printOrderReadyEvent(tx, bookingId, scoped, {
          printOrderId: parsedOrderId,
          readyAt: currentTime.toISOString(),
        });

        await tx.invitationPrintAudit.create({
          data: {
            id: randomUUID(),
            bookingId,
            orderId: parsedOrderId,
            actorId: scoped.actorId,
            action: 'invitation.print-order-ready',
            fromStatus: order.status,
            toStatus: 'READY_FOR_HANDOVER',
            metadata: asJson({ readyAt: currentTime.toISOString() }),
          },
        });

        return this.mapOrderView(updatedOrder, lines, currentRev, null);
      },
      { action: 'print-order.ready', resourceId: parsedOrderId },
    );
  }

  async markHandedOver(
    orderId: string,
    body: unknown,
    idempotencyKey: string,
    context: MediaRequestContext,
  ): Promise<PrintOrderView> {
    const input = parseStudio(handoverOrderBodySchema, body);
    const parsedOrderId = parseStudio(id, orderId);

    const existingOrder = await this.repository.prisma.invitationPrintOrder.findUnique({
      where: { id: parsedOrderId },
    });
    if (existingOrder === null) {
      throw new NotFoundError();
    }
    const bookingId = existingOrder.bookingId;

    return this.repository.command(
      bookingId,
      context,
      idempotencyKey,
      input,
      async (scoped) => {
        await this.authorization.manager(scoped);
      },
      async (tx, scoped) => {
        const order = await tx.invitationPrintOrder.findUniqueOrThrow({
          where: { id: parsedOrderId },
        });

        if (order.revision !== input.expectedRevision) {
          throw printOrderConflict('PRINT_QUOTE_STALE');
        }

        if (order.status !== 'READY_FOR_HANDOVER') {
          throw printOrderConflict('PRINT_ORDER_STATE_INVALID');
        }

        const currentRev = await tx.invitationCommercialRevision.findUniqueOrThrow({
          where: { id: order.currentCommercialRevisionId! },
        });

        const lines = await tx.invitationPrintLine.findMany({
          where: { orderId: parsedOrderId },
        });

        const currentTime = this.now();
        const nextRevision = order.revision + 1;
        const updatedOrder = await tx.invitationPrintOrder.update({
          where: { id: parsedOrderId },
          data: {
            status: 'HANDED_OVER',
            handedOverAt: currentTime,
            evidenceReference: input.evidenceReference,
            revision: nextRevision,
          },
        });

        await tx.invitationPrintAudit.create({
          data: {
            id: randomUUID(),
            bookingId,
            orderId: parsedOrderId,
            actorId: scoped.actorId,
            action: 'invitation.print-order-handed-over',
            fromStatus: order.status,
            toStatus: 'HANDED_OVER',
            metadata: asJson({
              handedOverAt: currentTime.toISOString(),
              evidenceReference: input.evidenceReference,
            }),
          },
        });

        return this.mapOrderView(updatedOrder, lines, currentRev, null);
      },
      { action: 'print-order.handover', resourceId: parsedOrderId },
    );
  }

  async recordCancellationIntent(
    bookingId: string,
    orderId: string,
    body: unknown,
    idempotencyKey: string,
    context: MediaRequestContext,
  ): Promise<{ confirmed: true; orderId: string }> {
    const input = parseStudio(cancellationIntentBodySchema, body);
    const parsedBookingId = parseStudio(id, bookingId);
    const parsedOrderId = parseStudio(id, orderId);

    return this.repository.command(
      parsedBookingId,
      context,
      idempotencyKey,
      input,
      async (scoped) => {
        await this.authorization.booking(parsedBookingId, scoped, 'COUPLE');
      },
      async (tx, scoped) => {
        const order = await tx.invitationPrintOrder.findFirst({
          where: { id: parsedOrderId, bookingId: parsedBookingId },
        });
        if (order === null) {
          throw new NotFoundError();
        }

        if (order.revision !== input.expectedRevision) {
          throw printOrderConflict('PRINT_QUOTE_STALE');
        }

        if (order.status !== 'APPROVED') {
          throw printOrderConflict('PRINT_ORDER_STATE_INVALID');
        }

        await tx.invitationPrintAudit.create({
          data: {
            id: randomUUID(),
            bookingId: parsedBookingId,
            orderId: parsedOrderId,
            actorId: scoped.actorId,
            action: 'invitation.print-cancellation-intent-confirmed',
            fromStatus: 'APPROVED',
            toStatus: 'APPROVED',
            metadata: asJson({
              revision: order.revision,
              commercialRevisionId: order.currentCommercialRevisionId,
              reason: input.reason ?? null,
            }),
          },
        });

        return { confirmed: true, orderId: parsedOrderId };
      },
      { action: 'print-order.cancellation-intent', resourceId: parsedOrderId },
    );
  }

  async cancelPrintOrder(
    bookingId: string | null,
    orderId: string,
    body: unknown,
    idempotencyKey: string,
    context: MediaRequestContext,
    actorType: 'COUPLE' | 'MANAGER',
  ): Promise<PrintOrderView> {
    const input = parseStudio(cancelOrderBodySchema, body);
    const parsedOrderId = parseStudio(id, orderId);

    const existingOrder = await this.repository.prisma.invitationPrintOrder.findUnique({
      where: { id: parsedOrderId },
    });
    if (existingOrder === null) {
      throw new NotFoundError();
    }
    const resolvedBookingId = existingOrder.bookingId;
    if (bookingId !== null && bookingId !== resolvedBookingId) {
      throw new NotFoundError();
    }

    return this.repository.command(
      resolvedBookingId,
      context,
      idempotencyKey,
      input,
      async (scoped) => {
        if (actorType === 'COUPLE') {
          await this.authorization.booking(resolvedBookingId, scoped, 'COUPLE');
        } else {
          await this.authorization.manager(scoped);
        }
      },
      async (tx, scoped) => {
        const order = await tx.invitationPrintOrder.findUniqueOrThrow({
          where: { id: parsedOrderId },
        });

        if (order.revision !== input.expectedRevision) {
          throw printOrderConflict('PRINT_QUOTE_STALE');
        }

        if (
          order.status === 'IN_PRODUCTION' ||
          order.status === 'READY_FOR_HANDOVER' ||
          order.status === 'HANDED_OVER' ||
          order.status === 'CANCELLED'
        ) {
          throw printOrderConflict('PRINT_CANCELLATION_NOT_ALLOWED');
        }

        const lines = await tx.invitationPrintLine.findMany({
          where: { orderId: parsedOrderId },
        });

        let currentRev: {
          id: string;
          revisionNumber: number;
          linesJson: Prisma.JsonValue;
          orderTotalVnd: Prisma.Decimal;
          estimatedHandoverAt: Date;
          expiresAt: Date;
          createdAt: Date;
        } | null = null;
        if (order.currentCommercialRevisionId !== null) {
          currentRev = await tx.invitationCommercialRevision.findUnique({
            where: { id: order.currentCommercialRevisionId },
          });
        }

        if (order.status === 'REQUESTED' || order.status === 'QUOTED') {
          const nextRevision = order.revision + 1;
          const updatedOrder = await tx.invitationPrintOrder.update({
            where: { id: parsedOrderId },
            data: {
              status: 'CANCELLED',
              revision: nextRevision,
            },
          });

          await tx.invitationPrintAudit.create({
            data: {
              id: randomUUID(),
              bookingId: resolvedBookingId,
              orderId: parsedOrderId,
              actorId: scoped.actorId,
              action: 'invitation.print-order-cancelled',
              fromStatus: order.status,
              toStatus: 'CANCELLED',
              metadata: asJson({ reason: input.reason ?? null }),
            },
          });

          return this.mapOrderView(updatedOrder, lines, currentRev, null);
        }

        if (order.status === 'APPROVED') {
          if (actorType !== 'MANAGER') {
            throw new NotFoundError();
          }

          const intentAudit = await tx.invitationPrintAudit.findFirst({
            where: {
              orderId: parsedOrderId,
              action: 'invitation.print-cancellation-intent-confirmed',
            },
            orderBy: { createdAt: 'desc' },
          });

          if (intentAudit === null) {
            throw printOrderConflict('PRINT_CANCELLATION_NOT_ALLOWED');
          }

          const intentMeta = intentAudit.metadata as {
            revision?: number;
            commercialRevisionId?: string;
          } | null;
          if (
            intentMeta?.revision !== order.revision ||
            intentMeta?.commercialRevisionId !== order.currentCommercialRevisionId
          ) {
            throw printOrderConflict('PRINT_CANCELLATION_NOT_ALLOWED');
          }

          if (currentRev === null || order.receivableChargeId === null) {
            throw new ValidationError();
          }

          const adjustmentId = randomUUID();
          const contracted = lines.some((l) => l.commercialSource !== null);
          if (!contracted)
            await this.billing.registerCredit(
              {
                bookingId: resolvedBookingId,
                receivableChargeId: order.receivableChargeId,
                sourceAdjustmentId: adjustmentId,
                amountVnd: currentRev.orderTotalVnd.toNumber(),
                reason: 'PRINT_CANCELLED',
                acceptedAt: this.now().toISOString(),
              },
              contractContext(scoped),
            );

          const nextRevision = order.revision + 1;
          const updatedOrder = await tx.invitationPrintOrder.update({
            where: { id: parsedOrderId },
            data: {
              status: 'CANCELLED',
              revision: nextRevision,
            },
          });

          await tx.invitationPrintAudit.create({
            data: {
              id: randomUUID(),
              bookingId: resolvedBookingId,
              orderId: parsedOrderId,
              actorId: scoped.actorId,
              action: 'invitation.print-order-cancelled',
              fromStatus: order.status,
              toStatus: 'CANCELLED',
              metadata: asJson({
                adjustmentId,
                creditedAmountVnd: contracted ? 0 : currentRev.orderTotalVnd.toNumber(),
                reason: input.reason ?? null,
              }),
            },
          });

          return this.mapOrderView(updatedOrder, lines, currentRev, null);
        }

        throw printOrderConflict('PRINT_CANCELLATION_NOT_ALLOWED');
      },
      { action: 'print-order.cancel', resourceId: parsedOrderId },
    );
  }

  async proposeReplacement(
    orderId: string,
    body: unknown,
    idempotencyKey: string,
    context: MediaRequestContext,
  ): Promise<PrintOrderView> {
    const input = parseStudio(replacementProposalBodySchema, body);
    const parsedOrderId = parseStudio(id, orderId);

    const existingOrder = await this.repository.prisma.invitationPrintOrder.findUnique({
      where: { id: parsedOrderId },
    });
    if (existingOrder === null) {
      throw new NotFoundError();
    }
    const bookingId = existingOrder.bookingId;

    return this.repository.command(
      bookingId,
      context,
      idempotencyKey,
      input,
      async (scoped) => {
        await this.authorization.manager(scoped);
      },
      async (tx, scoped) => {
        const order = await tx.invitationPrintOrder.findUniqueOrThrow({
          where: { id: parsedOrderId },
        });

        if (order.revision !== input.expectedRevision) {
          throw printOrderConflict('PRINT_QUOTE_STALE');
        }

        if (order.status !== 'APPROVED') {
          throw printOrderConflict('PRINT_ORDER_STATE_INVALID');
        }

        const lines = await tx.invitationPrintLine.findMany({
          where: { orderId: parsedOrderId },
        });

        if (lines.some((l) => l.commercialSource !== null))
          throw printOrderConflict('CONTRACT_PRINT_REPLACEMENT_REQUIRES_NEW_ORDER');

        if (lines.length !== input.lines.length) {
          throw new ValidationError();
        }

        const linesWithQuantity = lines.map((l) => ({
          lineId: l.id,
          designId: l.designId,
          quantity: l.quantity,
        }));

        const quoteInputs = input.lines.map((l) => ({
          lineId: l.lineId,
          unitPriceVnd: l.unitPriceVnd,
        }));

        const { quotedLines, orderTotalVnd } = computeCommercialTotal(
          linesWithQuantity,
          quoteInputs,
        );

        const currentTime = this.now();
        const estimatedHandoverDate = new Date(input.estimatedHandoverAt);
        assertValidEstimatedHandover(estimatedHandoverDate, currentTime);

        const expiresAt = new Date(currentTime.getTime() + QUOTE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

        const quotedLinesWithDesignRevision: Array<QuotedLineView & { designRevisionId: string }> =
          [];
        for (const q of quotedLines) {
          const design = await tx.invitationDesign.findUniqueOrThrow({
            where: { id: q.designId },
          });
          quotedLinesWithDesignRevision.push({
            ...q,
            designRevisionId: design.currentRevisionId,
          });
        }

        const lastRev = await tx.invitationCommercialRevision.findFirst({
          where: { orderId: parsedOrderId },
          orderBy: { revisionNumber: 'desc' },
        });
        const nextRevisionNumber = (lastRev?.revisionNumber ?? 1) + 1;
        const newCommercialRevisionId = randomUUID();

        const createdCommercialRevision = await tx.invitationCommercialRevision.create({
          data: {
            id: newCommercialRevisionId,
            orderId: parsedOrderId,
            bookingId,
            revisionNumber: nextRevisionNumber,
            linesJson: asJson(quotedLinesWithDesignRevision),
            orderTotalVnd,
            estimatedHandoverAt: estimatedHandoverDate,
            expiresAt,
          },
        });

        const currentApprovedRev = await tx.invitationCommercialRevision.findUniqueOrThrow({
          where: { id: order.currentCommercialRevisionId! },
        });

        const updatedOrder = await tx.invitationPrintOrder.update({
          where: { id: parsedOrderId },
          data: { revision: { increment: 1 } },
        });

        await this.repository.printQuotationIssuedEvent(tx, bookingId, scoped, {
          printOrderId: parsedOrderId,
          commercialRevisionId: newCommercialRevisionId,
          quotedAt: currentTime.toISOString(),
          expiresAt: expiresAt.toISOString(),
        });

        await tx.invitationPrintAudit.create({
          data: {
            id: randomUUID(),
            bookingId,
            orderId: parsedOrderId,
            actorId: scoped.actorId,
            action: 'invitation.print-replacement-proposed',
            fromStatus: order.status,
            toStatus: order.status,
            metadata: asJson({
              newCommercialRevisionId,
              revisionNumber: nextRevisionNumber,
              orderTotalVnd,
            }),
          },
        });

        return this.mapOrderView(
          updatedOrder,
          lines,
          currentApprovedRev,
          createdCommercialRevision,
        );
      },
      { action: 'print-order.replacement-propose', resourceId: parsedOrderId },
    );
  }

  async approveReplacement(
    bookingId: string,
    orderId: string,
    body: unknown,
    idempotencyKey: string,
    context: MediaRequestContext,
  ): Promise<PrintOrderView> {
    const input = parseStudio(replacementApprovalBodySchema, body);
    const parsedBookingId = parseStudio(id, bookingId);
    const parsedOrderId = parseStudio(id, orderId);

    return this.repository.command(
      parsedBookingId,
      context,
      idempotencyKey,
      input,
      async (scoped) => {
        await this.authorization.booking(parsedBookingId, scoped, 'COUPLE');
      },
      async (tx, scoped) => {
        const order = await tx.invitationPrintOrder.findFirst({
          where: { id: parsedOrderId, bookingId: parsedBookingId },
        });
        if (order === null) {
          throw new NotFoundError();
        }

        if (order.revision !== input.expectedRevision) {
          throw printOrderConflict('PRINT_QUOTE_STALE');
        }

        if (order.status !== 'APPROVED') {
          throw printOrderConflict('PRINT_ORDER_STATE_INVALID');
        }

        const oldApprovedRevision = await tx.invitationCommercialRevision.findUniqueOrThrow({
          where: { id: order.currentCommercialRevisionId! },
        });

        const newRevision = await tx.invitationCommercialRevision.findUnique({
          where: { id: input.commercialRevisionId },
        });
        if (newRevision === null || newRevision.orderId !== parsedOrderId) {
          throw new NotFoundError();
        }

        const latestProposal = await tx.invitationCommercialRevision.findFirst({
          where: { orderId: parsedOrderId },
          orderBy: { revisionNumber: 'desc' },
          select: { id: true },
        });
        if (
          latestProposal?.id !== newRevision.id ||
          newRevision.revisionNumber <= oldApprovedRevision.revisionNumber
        ) {
          throw printOrderConflict('PRINT_QUOTE_STALE');
        }

        const currentTime = this.now();
        assertQuoteNotExpired(newRevision.expiresAt, currentTime);

        const lines = await tx.invitationPrintLine.findMany({
          where: { orderId: parsedOrderId },
        });

        const quotedLines = newRevision.linesJson as unknown as Array<
          QuotedLineView & { designRevisionId: string }
        >;
        const quotedMap = new Map(quotedLines.map((q) => [q.lineId, q]));

        const updatedLines: Array<{
          id: string;
          designId: string;
          quantity: number;
          printableRevisionId: string | null;
        }> = [];

        for (const line of lines) {
          const qLine = quotedMap.get(line.id);
          if (qLine === undefined) {
            throw new ValidationError();
          }

          const captureResult = await this.printable.capture(
            { bookingId: parsedBookingId, designRevisionId: qLine.designRevisionId },
            contractContext(scoped),
          );

          await tx.invitationPrintLine.update({
            where: { id: line.id },
            data: { printableRevisionId: captureResult.printableRevisionId },
          });

          updatedLines.push({
            id: line.id,
            designId: line.designId,
            quantity: line.quantity,
            printableRevisionId: captureResult.printableRevisionId,
          });
        }

        await this.billing.registerCredit(
          {
            bookingId: parsedBookingId,
            receivableChargeId: order.receivableChargeId!,
            sourceAdjustmentId: oldApprovedRevision.id,
            amountVnd: oldApprovedRevision.orderTotalVnd.toNumber(),
            reason: 'PRINT_REPLACED',
            acceptedAt: currentTime.toISOString(),
          },
          contractContext(scoped),
        );

        const chargeResult = await this.billing.registerAcceptedCharge({
          bookingId: parsedBookingId,
          sourceType: 'PRINT_ORDER',
          sourceRevisionId: newRevision.id,
          amountVnd: newRevision.orderTotalVnd.toNumber(),
          acceptedAt: currentTime,
        });

        const nextRevision = order.revision + 1;
        const updatedOrder = await tx.invitationPrintOrder.update({
          where: { id: parsedOrderId },
          data: {
            currentCommercialRevisionId: newRevision.id,
            receivableChargeId: chargeResult.receivableChargeId,
            approvedAt: currentTime,
            revision: nextRevision,
          },
        });

        await this.repository.printOrderApprovedEvent(tx, parsedBookingId, scoped, {
          printOrderId: parsedOrderId,
          commercialRevisionId: newRevision.id,
          receivableChargeId: chargeResult.receivableChargeId,
          approvedAt: currentTime.toISOString(),
        });

        await tx.invitationPrintAudit.create({
          data: {
            id: randomUUID(),
            bookingId: parsedBookingId,
            orderId: parsedOrderId,
            actorId: scoped.actorId,
            action: 'invitation.print-order-replacement-approved',
            fromStatus: 'APPROVED',
            toStatus: 'APPROVED',
            metadata: asJson({
              oldCommercialRevisionId: oldApprovedRevision.id,
              newCommercialRevisionId: newRevision.id,
              newReceivableChargeId: chargeResult.receivableChargeId,
            }),
          },
        });

        return this.mapOrderView(updatedOrder, updatedLines, newRevision, null);
      },
      { action: 'print-order.replacement-approve', resourceId: parsedOrderId },
    );
  }

  async getPrintOrder(
    bookingId: string | null,
    orderId: string,
    context: MediaRequestContext,
  ): Promise<PrintOrderView> {
    const parsedOrderId = parseStudio(id, orderId);
    const order = await this.repository.prisma.invitationPrintOrder.findUnique({
      where: { id: parsedOrderId },
    });
    if (order === null) {
      throw new NotFoundError();
    }

    if (bookingId !== null) {
      const parsedBookingId = parseStudio(id, bookingId);
      if (order.bookingId !== parsedBookingId) {
        throw new NotFoundError();
      }
      await this.authorization.booking(parsedBookingId, context, 'COUPLE');
    } else {
      await this.authorization.manager(context);
    }

    const lines = await this.repository.prisma.invitationPrintLine.findMany({
      where: { orderId: parsedOrderId },
    });

    let currentRev: {
      id: string;
      revisionNumber: number;
      linesJson: Prisma.JsonValue;
      orderTotalVnd: Prisma.Decimal;
      estimatedHandoverAt: Date;
      expiresAt: Date;
      createdAt: Date;
    } | null = null;
    if (order.currentCommercialRevisionId !== null) {
      currentRev = await this.repository.prisma.invitationCommercialRevision.findUnique({
        where: { id: order.currentCommercialRevisionId },
      });
    }

    let pendingProposal: typeof currentRev = null;
    if (order.status === 'APPROVED' && currentRev !== null) {
      pendingProposal = await this.repository.prisma.invitationCommercialRevision.findFirst({
        where: {
          orderId: order.id,
          revisionNumber: { gt: currentRev.revisionNumber },
          expiresAt: { gt: this.now() },
        },
        orderBy: { revisionNumber: 'desc' },
      });
    }

    return this.mapOrderView(order, lines, currentRev, pendingProposal);
  }

  async listPrintOrders(
    bookingId: string,
    query: { cursor?: string | undefined; limit: number },
    context: MediaRequestContext,
  ): Promise<{ items: PrintOrderView[]; nextCursor: string | null }> {
    const parsedBookingId = parseStudio(id, bookingId);
    await this.authorization.booking(parsedBookingId, context, 'COUPLE');

    const limit = query.limit;
    let cursorOrder: { createdAt: Date; id: string } | null = null;
    if (query.cursor) {
      cursorOrder = await this.repository.prisma.invitationPrintOrder.findUnique({
        where: { id: query.cursor },
        select: { id: true, createdAt: true },
      });
    }

    const where: Prisma.InvitationPrintOrderWhereInput = {
      bookingId: parsedBookingId,
      ...(cursorOrder
        ? {
            OR: [
              { createdAt: { lt: cursorOrder.createdAt } },
              { createdAt: cursorOrder.createdAt, id: { lt: cursorOrder.id } },
            ],
          }
        : {}),
    };

    const orders = await this.repository.prisma.invitationPrintOrder.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = orders.length > limit;
    const pageOrders = hasMore ? orders.slice(0, limit) : orders;
    const nextCursor = hasMore ? pageOrders[pageOrders.length - 1]!.id : null;

    const items: PrintOrderView[] = [];
    for (const order of pageOrders) {
      const lines = await this.repository.prisma.invitationPrintLine.findMany({
        where: { orderId: order.id },
      });
      let currentRev: {
        id: string;
        revisionNumber: number;
        linesJson: Prisma.JsonValue;
        orderTotalVnd: Prisma.Decimal;
        estimatedHandoverAt: Date;
        expiresAt: Date;
        createdAt: Date;
      } | null = null;
      if (order.currentCommercialRevisionId !== null) {
        currentRev = await this.repository.prisma.invitationCommercialRevision.findUnique({
          where: { id: order.currentCommercialRevisionId },
        });
      }
      let pendingProposal: typeof currentRev = null;
      if (order.status === 'APPROVED' && currentRev !== null) {
        pendingProposal = await this.repository.prisma.invitationCommercialRevision.findFirst({
          where: {
            orderId: order.id,
            revisionNumber: { gt: currentRev.revisionNumber },
            expiresAt: { gt: this.now() },
          },
          orderBy: { revisionNumber: 'desc' },
        });
      }
      items.push(this.mapOrderView(order, lines, currentRev, pendingProposal));
    }
    return { items, nextCursor };
  }

  async listManagementPrintOrders(
    query: { bookingId?: string | undefined; cursor?: string | undefined; limit: number },
    context: MediaRequestContext,
  ): Promise<{ items: PrintOrderView[]; nextCursor: string | null }> {
    await this.authorization.manager(context);

    const limit = query.limit;
    let cursorOrder: { createdAt: Date; id: string } | null = null;
    if (query.cursor) {
      cursorOrder = await this.repository.prisma.invitationPrintOrder.findUnique({
        where: { id: query.cursor },
        select: { id: true, createdAt: true },
      });
    }

    const where: Prisma.InvitationPrintOrderWhereInput = {};
    if (query.bookingId !== undefined) {
      where.bookingId = parseStudio(id, query.bookingId);
    }
    if (cursorOrder) {
      where.AND = [
        ...(where.bookingId ? [{ bookingId: where.bookingId }] : []),
        {
          OR: [
            { createdAt: { lt: cursorOrder.createdAt } },
            { createdAt: cursorOrder.createdAt, id: { lt: cursorOrder.id } },
          ],
        },
      ];
      delete where.bookingId;
    }

    const orders = await this.repository.prisma.invitationPrintOrder.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = orders.length > limit;
    const pageOrders = hasMore ? orders.slice(0, limit) : orders;
    const nextCursor = hasMore ? pageOrders[pageOrders.length - 1]!.id : null;

    const items: PrintOrderView[] = [];
    for (const order of pageOrders) {
      const lines = await this.repository.prisma.invitationPrintLine.findMany({
        where: { orderId: order.id },
      });
      let currentRev: {
        id: string;
        revisionNumber: number;
        linesJson: Prisma.JsonValue;
        orderTotalVnd: Prisma.Decimal;
        estimatedHandoverAt: Date;
        expiresAt: Date;
        createdAt: Date;
      } | null = null;
      if (order.currentCommercialRevisionId !== null) {
        currentRev = await this.repository.prisma.invitationCommercialRevision.findUnique({
          where: { id: order.currentCommercialRevisionId },
        });
      }
      let pendingProposal: typeof currentRev = null;
      if (order.status === 'APPROVED' && currentRev !== null) {
        pendingProposal = await this.repository.prisma.invitationCommercialRevision.findFirst({
          where: {
            orderId: order.id,
            revisionNumber: { gt: currentRev.revisionNumber },
            expiresAt: { gt: this.now() },
          },
          orderBy: { revisionNumber: 'desc' },
        });
      }
      items.push(this.mapOrderView(order, lines, currentRev, pendingProposal));
    }
    return { items, nextCursor };
  }
}
