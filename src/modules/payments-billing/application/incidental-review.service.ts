import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { PrismaClient, Prisma } from '../../../generated/prisma/client.js';
import { NotFoundError } from '../../../core/errors/app-error.js';
import type { AuthenticatedActor } from '../../identity-access/authorization/authenticated-actor.middleware.js';
import { commercialConflict } from '../../booking-lifecycle/domain/commercial-contract.js';
import {
  expenseReviewCommandSchema,
  expenseReviewDecisionSchema,
  expenseReviewReopenSchema,
  invoiceAdjustmentSchema,
} from '../domain/final-invoice.js';
import {
  readExpenseDraft,
  financialContext,
  type IncidentalExpenseOptions,
} from './incidental-expense.service.js';
import {
  expenseReviewView,
  resolveExpenseLine,
  expenseReviewDigest,
} from './incidental-review.persistence.js';

export function createIncidentalReviewService(options: IncidentalExpenseOptions) {
  async function run(
    bookingId: string,
    expected: number | undefined,
    actor: AuthenticatedActor,
    requestId: string,
    manager: boolean,
    work: (
      client: PrismaClient,
      draft: Awaited<ReturnType<typeof readExpenseDraft>>,
    ) => Promise<void>,
  ) {
    return options.boundary.run(
      { bookingId, context: financialContext(actor, requestId) },
      (context) =>
        options.scope.withClient(bookingId, context, async (client) => {
          await options.operations.requireReadAccess(bookingId, context);
          if (manager) await options.operations.requireManager(bookingId, context);
          const booking = await client.booking.findUniqueOrThrow({
            where: { id: bookingId },
            include: { consultation: true },
          });
          if (booking.incidentalPolicyVersion !== 1)
            throw commercialConflict('EXPENSE_APPROVAL_NOT_APPLICABLE');
          if (
            manager
              ? booking.consultation.managerAccountId !== actor.accountId
              : !actor.roles.includes('COUPLE') || actor.roles.includes('MANAGER')
          )
            throw new NotFoundError();
          await options.event(client).requireEnded(bookingId);
          const draft = await readExpenseDraft(client, bookingId);
          if (expected !== undefined && draft.revision !== expected)
            throw commercialConflict('EXPENSE_REVISION_STALE');
          await client.incidentalExpenseDraft.upsert({
            where: { bookingId },
            create: { bookingId },
            update: {},
          });
          await work(client, draft);
          return readExpenseDraft(client, bookingId);
        }),
    );
  }
  async function audit(
    client: PrismaClient,
    bookingId: string,
    actor: AuthenticatedActor,
    requestId: string,
    action: string,
    details: Prisma.InputJsonObject,
  ) {
    await client.auditLog.create({
      data: {
        requestId,
        actorType: 'USER',
        actorId: actor.accountId,
        action: 'billing.expense-' + action,
        entityType: 'incidental-review',
        entityId: bookingId,
        metadata: { bookingId, ...details },
      },
    });
  }
  async function create(
    client: PrismaClient,
    bookingId: string,
    draft: Awaited<ReturnType<typeof readExpenseDraft>>,
    actor: AuthenticatedActor,
    requestId: string,
    type: 'NONE' | 'EXPENSES' | 'ADJUSTMENT',
    adjustment?: z.infer<typeof invoiceAdjustmentSchema>,
  ) {
    if (
      draft.currentReview &&
      draft.currentReview.state !== 'WITHDRAWN' &&
      !(
        draft.finalized &&
        (draft.currentReview.type !== 'ADJUSTMENT' ||
          (draft.currentReview.state === 'APPROVED' &&
            draft.currentReview.document.adjustment?.expectedInvoiceRevisionId !==
              adjustment?.expectedInvoiceRevisionId))
      )
    )
      throw commercialConflict('EXPENSE_REOPEN_REQUIRED');
    const last = await client.incidentalExpenseReview.findFirst({
      where: { bookingId },
      orderBy: { revisionNumber: 'desc' },
    });
    const document = {
      lines: draft.lines,
      totalVnd: draft.totalVnd,
      ...(adjustment ? { adjustment } : {}),
    };
    const row = await client.incidentalExpenseReview.create({
      data: {
        id: randomUUID(),
        bookingId,
        draftRevision: draft.revision,
        revisionNumber: (last?.revisionNumber ?? 0) + 1,
        type,
        state: type === 'NONE' ? 'APPROVED' : 'AWAITING_APPROVAL',
        document,
        documentDigest: expenseReviewDigest(document),
        managerAccountId: actor.accountId,
        managerApprovedAt: new Date(),
      },
    });
    await client.incidentalExpenseDraft.update({
      where: { bookingId },
      data: { currentReviewId: row.id },
    });
    await audit(client, bookingId, actor, requestId, 'submitted', {
      review: expenseReviewView(row),
    });
  }
  return {
    async submit(
      bookingId: string,
      raw: z.infer<typeof expenseReviewCommandSchema>,
      actor: AuthenticatedActor,
      requestId: string,
      none = false,
    ) {
      const input = expenseReviewCommandSchema.parse(raw);
      return run(
        bookingId,
        input.expectedRevision,
        actor,
        requestId,
        true,
        async (client, draft) => {
          if (draft.finalized) throw commercialConflict('INVOICE_FINALIZED');
          if (none ? draft.lines.length !== 0 : draft.lines.length === 0)
            throw commercialConflict('EXPENSE_DECLARATION_INVALID');
          await create(client, bookingId, draft, actor, requestId, none ? 'NONE' : 'EXPENSES');
        },
      );
    },
    async reopen(
      bookingId: string,
      raw: z.infer<typeof expenseReviewReopenSchema>,
      actor: AuthenticatedActor,
      requestId: string,
    ) {
      const input = expenseReviewReopenSchema.parse(raw);
      return run(
        bookingId,
        input.expectedRevision,
        actor,
        requestId,
        true,
        async (client, draft) => {
          const review = draft.currentReview;
          if (
            !review ||
            review.id !== input.reviewId ||
            review.documentDigest !== input.documentDigest ||
            review.state === 'WITHDRAWN' ||
            (draft.finalized && review.type !== 'ADJUSTMENT')
          )
            throw commercialConflict('EXPENSE_REVIEW_NOT_EDITABLE');
          if (draft.finalized) {
            const head = await client.finalInvoiceHead.findUnique({ where: { bookingId } });
            if (review.document.adjustment?.expectedInvoiceRevisionId !== head?.currentRevisionId)
              throw commercialConflict('EXPENSE_REVIEW_NOT_EDITABLE');
          }
          if (
            await client.billingPaymentAttempt.findFirst({
              where: {
                bookingId,
                OR: [
                  { state: { in: ['CREATED', 'PENDING', 'UNKNOWN'] } },
                  { state: 'SUCCEEDED', paymentEntries: { none: {} } },
                ],
              },
            })
          )
            throw commercialConflict('PAYMENT_ATTEMPT_ACTIVE');
          await client.incidentalExpenseReview.update({
            where: { id: review.id },
            data: { state: 'WITHDRAWN', decisionReason: review.decisionReason ?? input.reason },
          });
          await audit(client, bookingId, actor, requestId, 'reopened', {
            reviewId: review.id,
            documentDigest: review.documentDigest,
            reason: input.reason,
          });
        },
      );
    },
    async decide(
      bookingId: string,
      raw: z.infer<typeof expenseReviewDecisionSchema>,
      actor: AuthenticatedActor,
      requestId: string,
    ) {
      const input = expenseReviewDecisionSchema.parse(raw);
      return run(
        bookingId,
        input.expectedRevision,
        actor,
        requestId,
        false,
        async (client, draft) => {
          const review = draft.currentReview;
          if (
            !review ||
            review.id !== input.reviewId ||
            review.documentDigest !== input.documentDigest ||
            review.state !== 'AWAITING_APPROVAL' ||
            review.managerAccountId === actor.accountId ||
            review.draftRevision !== draft.revision
          )
            throw commercialConflict('EXPENSE_REVIEW_STALE');
          if (review.type === 'ADJUSTMENT') {
            const head = await client.finalInvoiceHead.findUnique({ where: { bookingId } });
            if (head?.currentRevisionId !== review.document.adjustment?.expectedInvoiceRevisionId)
              throw commercialConflict('INVOICE_REVISION_STALE');
          } else if (draft.finalized) throw commercialConflict('INVOICE_FINALIZED');
          await client.incidentalExpenseReview.update({
            where: { id: review.id },
            data:
              input.decision === 'APPROVE'
                ? {
                    state: 'APPROVED',
                    coupleAccountId: actor.accountId,
                    coupleApprovedAt: new Date(),
                  }
                : {
                    state: 'CHANGES_REQUESTED',
                    coupleAccountId: actor.accountId,
                    decisionReason: input.reason!,
                  },
          });
          await audit(client, bookingId, actor, requestId, input.decision.toLowerCase(), {
            reviewId: review.id,
            documentDigest: review.documentDigest,
            reason: input.reason ?? null,
          });
        },
      );
    },
    async proposeAdjustment(
      bookingId: string,
      raw: z.infer<typeof invoiceAdjustmentSchema>,
      actor: AuthenticatedActor,
      requestId: string,
    ) {
      const { reviewId: ignored, ...input } = invoiceAdjustmentSchema.parse(raw);
      void ignored;
      return run(bookingId, undefined, actor, requestId, true, async (client, draft) => {
        const head = await client.finalInvoiceHead.findUnique({ where: { bookingId } });
        if (!head?.currentRevisionId || head.currentRevisionId !== input.expectedInvoiceRevisionId)
          throw commercialConflict('INVOICE_REVISION_STALE');
        const normalized = [];
        for (const { kind, ...line } of input.lines) {
          const { totalVnd: unusedTotal, ...resolved } = await resolveExpenseLine(
            client,
            bookingId,
            line,
          );
          void unusedTotal;
          normalized.push({ kind, ...resolved });
        }
        await create(client, bookingId, draft, actor, requestId, 'ADJUSTMENT', {
          ...input,
          lines: normalized,
        });
      });
    },
  };
}
