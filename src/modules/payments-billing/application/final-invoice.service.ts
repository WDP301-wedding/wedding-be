import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { PrismaClient, FinalInvoiceRevision } from '../../../generated/prisma/client.js';
import type {
  createBookingBoundaryUnitOfWork,
  BookingBoundaryUnitOfWork,
} from '../../../core/database/booking-unit-of-work.js';
import { NotFoundError } from '../../../core/errors/app-error.js';
import type { AuthenticatedActor } from '../../identity-access/authorization/authenticated-actor.middleware.js';
import type { BillingOperationsRepository } from './billing-operations.port.js';
import type { BillingLedgerRepository } from './billing-ledger.port.js';
import type { ContractContext } from './payments-billing.providers.js';
import type { EffectiveCommercialReader } from '../../booking-lifecycle/infrastructure/effective-commercial.reader.js';
import type { createEventEndReader } from '../../booking-lifecycle/infrastructure/event-end.reader.js';
import type { createCommercialFinancialService } from './commercial-financial.service.js';
import {
  commercialConflict,
  deepFreeze,
} from '../../booking-lifecycle/domain/commercial-contract.js';
import {
  finalizeInvoiceSchema,
  invoiceAdjustmentSchema,
  expenseLineSchema,
  calculateExpenseLine,
  signedAdjustmentTotal,
  finalInvoiceDocumentSchema,
  finalInvoiceDigest,
  finalInvoiceViewSchema,
  type FinalInvoiceDocument,
} from '../domain/final-invoice.js';
import { financialContext, readExpenseDraft } from './incidental-expense.service.js';

type Options = {
  scope: ReturnType<typeof createBookingBoundaryUnitOfWork>;
  boundary: BookingBoundaryUnitOfWork;
  operations: BillingOperationsRepository;
  ledger: BillingLedgerRepository;
  financial: ReturnType<typeof createCommercialFinancialService>;
  commercial: (client: PrismaClient) => EffectiveCommercialReader;
  event: (client: PrismaClient) => ReturnType<typeof createEventEndReader>;
  now?: () => Date;
};
export function finalInvoiceView(row: FinalInvoiceRevision) {
  const document = finalInvoiceDocumentSchema.parse(row.document);
  if (
    finalInvoiceDigest(document) !== row.documentDigest ||
    document.totalVnd !== row.totalVnd.toNumber()
  )
    throw commercialConflict('FINANCIAL_SOURCE_CONFLICT');
  return deepFreeze(
    finalInvoiceViewSchema.parse({
      invoiceRevisionId: row.id,
      bookingId: row.bookingId,
      revisionNumber: row.revisionNumber,
      predecessorRevisionId: row.predecessorRevisionId,
      invoiceNumber: row.invoiceNumber,
      documentDigest: row.documentDigest,
      document,
      sourceBillingRevision: row.sourceBillingRevision,
      issuedAt: row.issuedAt.toISOString(),
      issuedByAccountId: row.issuedByAccountId,
    }),
  );
}
export function createFinalInvoiceService(options: Options) {
  const now = options.now ?? (() => new Date());
  async function write(
    bookingId: string,
    actor: AuthenticatedActor,
    requestId: string,
    work: (client: PrismaClient, context: ContractContext) => Promise<FinalInvoiceRevision>,
  ) {
    return options.boundary.run(
      { bookingId, context: financialContext(actor, requestId) },
      (scoped) =>
        options.scope.withClient(bookingId, scoped, async (client) => {
          await options.operations.requireManager(bookingId, scoped);
          await options.event(client).requireEnded(bookingId);
          return finalInvoiceView(await work(client, scoped));
        }),
    );
  }
  async function activate(
    client: PrismaClient,
    document: FinalInvoiceDocument,
    id: string,
    predecessor: FinalInvoiceRevision | null,
    deltaVnd: number,
    expectedBillingRevision: number,
    context: ContractContext,
  ) {
    const bookingId = document.bookingId;
    const ledger = await options.ledger.getLedger(bookingId, context);
    if (ledger.revision !== expectedBillingRevision)
      throw commercialConflict('STALE_BILLING_REVISION');
    await options.financial.requireUnpinned(bookingId, context);
    const revisionNumber = (predecessor?.revisionNumber ?? 0) + 1,
      issuedAt = predecessor === null ? now() : new Date(document.adjustments.at(-1)!.occurredAt);
    await client.finalInvoiceHead.upsert({
      where: { bookingId },
      create: { bookingId },
      update: {},
    });
    const row = await client.finalInvoiceRevision.create({
      data: {
        id,
        bookingId,
        revisionNumber,
        predecessorRevisionId: predecessor?.id ?? null,
        invoiceNumber: 'INV-' + id,
        document,
        documentDigest: finalInvoiceDigest(document),
        totalVnd: document.totalVnd,
        deltaVnd,
        sourceBillingRevision: ledger.revision + (deltaVnd === 0 ? 0 : 1),
        issuedByAccountId: context.actorAccountId!,
        issuedAt,
      },
    });
    if (deltaVnd !== 0)
      await options.ledger.append(
        {
          id: randomUUID(),
          bookingId,
          kind: deltaVnd > 0 ? 'CHARGE' : 'CREDIT_ADJUSTMENT',
          sourceType: predecessor === null ? 'INCIDENTAL_FINALIZATION' : 'INVOICE_ADJUSTMENT',
          sourceRevisionId: id,
          amountVnd: Math.abs(deltaVnd),
          occurredAt: issuedAt.toISOString(),
          reason: predecessor === null ? null : document.adjustments.at(-1)!.reason,
          sourceEntryId: null,
          paymentAttemptId: null,
          decisionId: null,
          approvedRefundableVnd: null,
          evidenceReference: null,
        },
        context,
      );
    const after = await options.ledger.getLedger(bookingId, context);
    if (after.totals.acceptedChargesVnd !== document.totalVnd)
      throw commercialConflict('FINANCIAL_SOURCE_CONFLICT');
    await client.finalInvoiceHead.update({ where: { bookingId }, data: { currentRevisionId: id } });
    const payload = {
      bookingId,
      invoiceRevisionId: id,
      predecessorRevisionId: predecessor?.id ?? null,
      documentDigest: row.documentDigest,
      totalVnd: document.totalVnd,
      deltaVnd,
      sourceBillingRevision: after.revision,
    };
    await client.auditLog.create({
      data: {
        requestId: context.requestId,
        actorType: 'USER',
        actorId: context.actorAccountId,
        action: 'billing.final-invoice-issued',
        entityType: 'final-invoice',
        entityId: id,
        metadata: payload,
      },
    });
    await client.billingOutboxEvent.create({
      data: {
        id: randomUUID(),
        ledgerEntryId: after.entries.at(-1)!.id,
        invoiceRevisionId: id,
        eventType: 'billing.final-invoice-issued',
        eventVersion: 1,
        correlationId: context.requestId,
        causationId: context.causationId,
        aggregateId: bookingId,
        aggregateRevision: after.revision,
        occurredAt: issuedAt,
        payload,
      },
    });
    return row;
  }
  return Object.freeze({
    async read(
      bookingId: string,
      revisionId: string,
      actor: AuthenticatedActor,
      requestId: string,
    ) {
      return options.boundary.run(
        { bookingId, context: financialContext(actor, requestId) },
        (scoped) =>
          options.scope.withClient(bookingId, scoped, async (client) => {
            await options.operations.requireReadAccess(bookingId, scoped);
            const row = await client.finalInvoiceRevision.findFirst({
              where: { id: revisionId, bookingId },
            });
            if (!row) throw new NotFoundError();
            return finalInvoiceView(row);
          }),
      );
    },
    async list(bookingId: string, actor: AuthenticatedActor, requestId: string, cursor?: string) {
      return options.boundary.run(
        { bookingId, context: financialContext(actor, requestId) },
        (scoped) =>
          options.scope.withClient(bookingId, scoped, async (client) => {
            await options.operations.requireReadAccess(bookingId, scoped);
            if (
              cursor &&
              !(await client.finalInvoiceRevision.findFirst({ where: { id: cursor, bookingId } }))
            )
              throw new NotFoundError();
            const head = await client.finalInvoiceHead.findUnique({ where: { bookingId } });
            const rows = await client.finalInvoiceRevision.findMany({
              where: { bookingId },
              orderBy: { revisionNumber: 'desc' },
              take: 51,
              ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            });
            return {
              bookingId,
              currentRevisionId: head?.currentRevisionId ?? null,
              revisions: rows.slice(0, 50).map(finalInvoiceView),
              nextCursor: rows.length > 50 ? rows[49]!.id : null,
            };
          }),
      );
    },
    async finalize(
      bookingId: string,
      raw: z.infer<typeof finalizeInvoiceSchema>,
      actor: AuthenticatedActor,
      requestId: string,
    ) {
      const input = finalizeInvoiceSchema.parse(raw);
      return write(bookingId, actor, requestId, async (client, context) => {
        const existing = await client.finalInvoiceRevision.findFirst({
          where: { bookingId, revisionNumber: 1 },
        });
        if (existing) {
          const document = finalInvoiceDocumentSchema.parse(existing.document);
          if (
            document.expenseDraftRevision === input.expectedDraftRevision &&
            document.effectiveCommercialRevisionId === input.expectedCommercialRevisionId &&
            existing.sourceBillingRevision - (existing.deltaVnd.isZero() ? 0 : 1) ===
              input.expectedBillingRevision
          )
            return existing;
          throw commercialConflict('INVOICE_FINALIZED');
        }
        const draft = await readExpenseDraft(client, bookingId);
        if (draft.revision !== input.expectedDraftRevision)
          throw commercialConflict('EXPENSE_REVISION_STALE');
        const effective = await options.commercial(client).getEffective(bookingId);
        if (effective.revisionId !== input.expectedCommercialRevisionId)
          throw commercialConflict('COMMERCIAL_PREDECESSOR_STALE');
        const totalVnd = effective.totalVnd + draft.totalVnd;
        if (!Number.isSafeInteger(totalVnd)) throw commercialConflict('COMMERCIAL_AMOUNT_OVERFLOW');
        const document = finalInvoiceDocumentSchema.parse({
          modelVersion: 'FINAL_INVOICE_V1',
          bookingId,
          contract: {
            revisionId: effective.contract.contractRevisionId,
            documentDigest: effective.contract.documentDigest,
            document: effective.contract.document,
          },
          appendices: effective.appendices.map((a) => ({
            revisionId: a.revisionId,
            documentDigest: a.documentDigest,
            document: a.document,
          })),
          effectiveCommercialRevisionId: effective.revisionId,
          commercialTotalVnd: effective.totalVnd,
          expenseDraftRevision: draft.revision,
          incidentalLines: draft.lines,
          incidentalTotalVnd: draft.totalVnd,
          adjustments: [],
          totalVnd,
        });
        return activate(
          client,
          document,
          randomUUID(),
          null,
          draft.totalVnd,
          input.expectedBillingRevision,
          context,
        );
      });
    },
    async adjust(
      bookingId: string,
      raw: z.infer<typeof invoiceAdjustmentSchema>,
      actor: AuthenticatedActor,
      requestId: string,
    ) {
      const input = invoiceAdjustmentSchema.parse(raw);
      return write(bookingId, actor, requestId, async (client, context) => {
        const head = await client.finalInvoiceHead.findUnique({ where: { bookingId } });
        if (!head?.currentRevisionId) throw commercialConflict('INVOICE_FINALIZATION_REQUIRED');
        if (head.currentRevisionId !== input.expectedInvoiceRevisionId)
          throw commercialConflict('INVOICE_REVISION_STALE');
        const prior = await client.finalInvoiceRevision.findUniqueOrThrow({
          where: { id: head.currentRevisionId },
        });
        const before = finalInvoiceView(prior).document,
          deltaVnd = signedAdjustmentTotal(input.lines),
          totalVnd = before.totalVnd + deltaVnd;
        if (!Number.isSafeInteger(totalVnd) || totalVnd < 0)
          throw commercialConflict('FINANCIAL_SOURCE_CONFLICT');
        const id = randomUUID();
        const adjustment = {
          id,
          predecessorRevisionId: prior.id,
          reason: input.reason,
          actorAccountId: actor.accountId,
          occurredAt: now().toISOString(),
          lines: input.lines.map(({ kind, ...line }) => ({
            id: randomUUID(),
            kind,
            ...calculateExpenseLine(expenseLineSchema.parse(line)),
          })),
          deltaVnd,
        };
        const document = finalInvoiceDocumentSchema.parse({
          ...before,
          adjustments: [...before.adjustments, adjustment],
          totalVnd,
        });
        return activate(
          client,
          document,
          id,
          prior,
          deltaVnd,
          input.expectedBillingRevision,
          context,
        );
      });
    },
  });
}
