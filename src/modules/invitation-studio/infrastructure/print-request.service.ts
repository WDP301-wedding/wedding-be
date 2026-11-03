import { randomUUID } from 'node:crypto';
import { NotFoundError } from '../../../core/errors/app-error.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import { createPrintAppendixWorkflow } from '../../booking-lifecycle/application/print-appendix.workflow.js';
import { createEffectiveCommercialReader } from '../../booking-lifecycle/infrastructure/effective-commercial.reader.js';
import type { MediaRequestContext } from '../application/media.contracts.js';
import {
  fixedPrintLine,
  printRequestInputSchema,
  printRequestConfirmSchema,
  printRequestDocumentSchema,
  printRequestViewSchema,
  withdrawPrintRequestSchema,
} from '../domain/print-request.js';
import { printOrderConflict } from '../domain/print-policy.js';
import { digest, parseStudio } from '../domain/studio-policy.js';
import { contractContext, type StudioRepository } from './studio.repository.js';
import type { StudioAuthorization } from './studio-authorization.js';
import type { PrintableService } from './printable.service.js';

export class PrintRequestService {
  constructor(
    readonly repository: StudioRepository,
    readonly access: StudioAuthorization,
    readonly printable: PrintableService,
    readonly now = () => new Date(),
  ) {}

  private async eligible(
    tx: Prisma.TransactionClient,
    bookingId: string,
    context: MediaRequestContext,
  ) {
    const booking = await tx.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { depositSettlement: true },
    });
    if (booking.phase !== 'CONFIRMED' || !booking.depositSettlement?.contractRevisionId)
      throw printOrderConflict('SETTLED_CONTRACT_REQUIRED');
    await createPrintAppendixWorkflow(tx, contractContext(context)).requireMutable(bookingId);
  }

  async preview(bookingId: string, raw: unknown, key: string, context: MediaRequestContext) {
    const input = parseStudio(printRequestInputSchema, raw);
    return this.repository.command(
      bookingId,
      context,
      key,
      input,
      (ctx) => this.access.booking(bookingId, ctx, 'COUPLE'),
      async (tx, scoped) => {
        await this.eligible(tx, bookingId, scoped);
        const effective = await createEffectiveCommercialReader(tx).getEffective(bookingId);
        const quoteId = randomUUID();
        const lines = [];
        for (const selection of input.lines) {
          const design = await tx.invitationDesign.findFirst({
            where: { id: selection.designId, bookingId },
          });
          if (!design) throw new NotFoundError();
          if (design.currentRevisionId !== selection.designRevisionId)
            throw printOrderConflict('PRINT_QUOTE_STALE');
          const revision = await tx.invitationDesignRevision.findUniqueOrThrow({
            where: { id: selection.designRevisionId },
          });
          const content = revision.content as { title: string };
          const captured = await this.printable.capture(
            { bookingId, designRevisionId: selection.designRevisionId },
            contractContext(scoped),
            false,
          );
          lines.push({
            ...selection,
            title: content.title,
            printableRevisionId: captured.printableRevisionId,
            contentDigest: captured.contentDigest,
            line: fixedPrintLine({
              sourceId: randomUUID(),
              sourceRevisionId: quoteId,
              title: content.title,
              quantity: selection.quantity,
            }),
          });
        }
        const document = printRequestDocumentSchema.parse({
          predecessorRevisionId: effective.revisionId,
          lines,
          totalVnd: lines.reduce((sum, line) => sum + line.line.lineTotalVnd, 0),
        });
        const hash = digest(document),
          expiresAt = new Date(this.now().getTime() + 30 * 60 * 1000);
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
      { action: 'print-request.preview' },
    );
  }

  async confirm(bookingId: string, raw: unknown, key: string, context: MediaRequestContext) {
    const input = parseStudio(printRequestConfirmSchema, raw);
    const requestId = await this.repository.command(
      bookingId,
      context,
      key,
      input,
      (ctx) => this.access.booking(bookingId, ctx, 'COUPLE'),
      async (tx, scoped) => {
        const quote = await tx.invitationPrintPurchaseQuote.findFirst({
          where: { id: input.quoteId, bookingId, actorId: scoped.actorId },
        });
        if (!quote || quote.digest !== input.digest || digest(quote.document) !== input.digest)
          throw printOrderConflict('PRINT_QUOTE_STALE');
        const existing = await tx.invitationPrintRequest.findUnique({
          where: { quoteId: quote.id },
        });
        if (existing) return existing.id;
        if (quote.expiresAt <= this.now()) throw printOrderConflict('PRINT_QUOTE_EXPIRED');
        await this.eligible(tx, bookingId, scoped);
        const document = printRequestDocumentSchema.parse(quote.document);
        for (const line of document.lines) {
          const design = await tx.invitationDesign.findFirst({
            where: { id: line.designId, bookingId },
          });
          if (!design || design.currentRevisionId !== line.designRevisionId)
            throw printOrderConflict('PRINT_QUOTE_STALE');
          const captured = await this.printable.capture(
            { bookingId, designRevisionId: line.designRevisionId },
            contractContext(scoped),
            false,
          );
          if (captured.contentDigest !== line.contentDigest)
            throw printOrderConflict('PRINT_QUOTE_STALE');
        }
        const effective = await createEffectiveCommercialReader(tx).getEffective(bookingId);
        if (effective.revisionId !== document.predecessorRevisionId)
          throw printOrderConflict('COMMERCIAL_PREDECESSOR_STALE');
        const appendix = await createPrintAppendixWorkflow(tx, contractContext(scoped)).create(
          bookingId,
          document.lines.map((line) => line.line),
          scoped.actorId,
          'Đặt in thiệp sau đặt cọc',
        );
        const id = randomUUID();
        await tx.invitationPrintRequest.create({
          data: { id, bookingId, quoteId: quote.id, appendixRevisionId: appendix.id, document },
        });
        return id;
      },
      { action: 'print-request.confirm' },
    );
    return this.get(bookingId, requestId, context);
  }

  async list(bookingId: string, context: MediaRequestContext) {
    return this.repository.boundary.run(
      { bookingId, context: contractContext(context) },
      async (scope) => {
        await this.access.booking(bookingId, {
          ...context,
          transactionScopeId: scope.transactionScopeId!,
        });
        const tx = this.repository.boundary.requireScope(bookingId, scope);
        const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
        const rows = await tx.invitationPrintRequest.findMany({
          where: { bookingId },
          orderBy: { createdAt: 'desc' },
          take: 100,
        });
        const appendices = await tx.commercialAppendixRevision.findMany({
          where: { id: { in: rows.map((row) => row.appendixRevisionId) } },
        });
        return {
          items: rows.map((row) =>
            printRequestViewSchema.parse({
              requestId: row.id,
              bookingId,
              bookingRevision: booking.revision,
              appendixRevisionId: row.appendixRevisionId,
              state: appendices.find((a) => a.id === row.appendixRevisionId)?.state,
              orderId: row.orderId,
              document: row.document,
            }),
          ),
        };
      },
    );
  }
  private async get(bookingId: string, requestId: string, context: MediaRequestContext) {
    const found = (await this.list(bookingId, context)).items.find(
      (row) => row.requestId === requestId,
    );
    if (!found) throw new NotFoundError();
    return found;
  }
  async withdraw(
    bookingId: string,
    requestId: string,
    raw: unknown,
    key: string,
    context: MediaRequestContext,
  ) {
    const input = parseStudio(withdrawPrintRequestSchema, raw);
    await this.repository.command(
      bookingId,
      context,
      key,
      input,
      (ctx) => this.access.booking(bookingId, ctx, 'COUPLE'),
      async (tx, scoped) => {
        await this.eligible(tx, bookingId, scoped);
        const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
        if (booking.revision !== input.expectedRevision)
          throw printOrderConflict('CONTRACT_REVISION_STALE');
        const request = await tx.invitationPrintRequest.findFirst({
          where: { id: requestId, bookingId },
        });
        if (!request) throw new NotFoundError();
        if (request.orderId) throw printOrderConflict('PRINT_APPENDIX_CHANGE_REQUIRED');
        const head = await tx.commercialAppendixHead.findUniqueOrThrow({ where: { bookingId } });
        if (head.currentRevisionId !== request.appendixRevisionId)
          throw printOrderConflict('COMMERCIAL_PREDECESSOR_STALE');
        await createPrintAppendixWorkflow(tx, contractContext(scoped)).withdraw(
          bookingId,
          request.appendixRevisionId,
        );
        return { requestId };
      },
      { action: 'print-request.withdraw', resourceId: requestId },
    );
    return this.get(bookingId, requestId, context);
  }
}
