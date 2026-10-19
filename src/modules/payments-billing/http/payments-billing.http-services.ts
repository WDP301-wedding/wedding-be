import type { z } from 'zod';
import { AppError, NotFoundError } from '../../../core/errors/app-error.js';
import type { AuthenticatedActor } from '../../identity-access/authorization/authenticated-actor.middleware.js';
import type { AuthenticatedActorResolver } from '../../identity-access/authorization/authenticated-actor.middleware.js';
import { createFinalInvoiceRouter } from './final-invoice.router.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { createPaymentsBillingProviders } from '../payments-billing.providers.js';
import type { ContractContext } from '../application/payments-billing.providers.js';
import { billingCommandResultSchema } from '../application/billing-operations.port.js';
import { createBillingHttpIdempotency } from '../infrastructure/billing-http-idempotency.js';
import {
  balanceBodySchema,
  depositBodySchema,
  manualBodySchema,
  refundBodySchema,
  refundApprovalBodySchema,
  checkoutResponseSchema,
  paymentResponseSchema,
  refundResponseSchema,
  refundApprovalResponseSchema,
  attemptResponseSchema,
} from './payments-billing.schemas.js';

type Providers = ReturnType<typeof createPaymentsBillingProviders>;
export type BillingHttpOperation = 'DEPOSIT' | 'BALANCE' | 'MANUAL' | 'REFUND' | 'APPROVAL';
const routes = {
  DEPOSIT: '/bookings/{bookingId}/payments/deposit',
  BALANCE: '/bookings/{bookingId}/payments/balance',
  MANUAL: '/management/billing/payments/manual',
  REFUND: '/management/billing/refunds',
  APPROVAL: '/management/billing/refund-approvals',
} as const;
const schemas = {
  DEPOSIT: depositBodySchema,
  BALANCE: balanceBodySchema,
  MANUAL: manualBodySchema,
  REFUND: refundBodySchema,
  APPROVAL: refundApprovalBodySchema,
};
function forbidden() {
  return new AppError({ status: 403, code: 'FORBIDDEN', message: 'The request is forbidden.' });
}
function unavailable() {
  return new AppError({
    status: 503,
    code: 'PAYMENT_PROVIDER_UNAVAILABLE',
    message: 'VNPay is unavailable.',
  });
}
function context(actor: AuthenticatedActor, requestId: string): ContractContext {
  return {
    requestId,
    causationId: requestId,
    actorAccountId: actor.accountId,
    authority: 'AUTHENTICATED',
  };
}

export function createPaymentsBillingHttpServices(prisma: PrismaClient, providers: Providers) {
  const idempotency = createBillingHttpIdempotency(prisma);
  async function authorize(
    bookingId: string,
    actor: AuthenticatedActor,
    minimum: 'RESTRICTED' | 'FULL',
    managerOnly = false,
    ownOnly = false,
  ) {
    const account = await prisma.account.findUnique({
      where: { id: actor.accountId },
      select: { status: true, roles: { select: { role: true } } },
    });
    if (account?.status !== 'ACTIVE') throw forbidden();
    const manager = account.roles.some(({ role }) => role === 'MANAGER');
    if (managerOnly && !manager) throw forbidden();
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { consultationId: true, currentTimelineRevisionId: true, phase: true },
    });
    if (booking === null) throw new NotFoundError();
    if (!manager || ownOnly) {
      const grant = await prisma.consultationAccess.findUnique({
        where: {
          accountId_consultationId: {
            accountId: actor.accountId,
            consultationId: booking.consultationId,
          },
        },
        select: { level: true },
      });
      if (grant === null) throw new NotFoundError();
      if (minimum === 'FULL' && grant.level !== 'FULL') throw forbidden();
    }
    if (
      !manager &&
      account.roles.some(({ role }) => role === 'STAFF') &&
      !account.roles.some(({ role }) => role === 'COUPLE')
    )
      throw forbidden();
    return booking;
  }
  async function refundBooking(sourcePaymentId: string, actor: AuthenticatedActor) {
    // Check Manager authority before looking up a globally addressed private payment.
    const account = await prisma.account.findUnique({
      where: { id: actor.accountId },
      select: { status: true, roles: { select: { role: true } } },
    });
    if (account?.status !== 'ACTIVE' || !account.roles.some(({ role }) => role === 'MANAGER'))
      throw forbidden();
    const source = await prisma.billingLedgerEntry.findUnique({
      where: { id: sourcePaymentId },
      select: { bookingId: true, kind: true },
    });
    if (source?.kind !== 'PAYMENT') throw new NotFoundError();
    return source.bookingId;
  }
  return Object.freeze({
    commercialRouter: (resolver: AuthenticatedActorResolver) =>
      createFinalInvoiceRouter(
        prisma,
        { expenses: providers.expenses, invoices: providers.finalInvoices },
        resolver,
      ),
    async mutate(
      input: Readonly<{
        operation: BillingHttpOperation;
        bookingId?: string;
        body: unknown;
        key: string;
        actor: AuthenticatedActor;
        requestId: string;
        ip: string;
      }>,
    ) {
      const body = schemas[input.operation].parse(input.body);
      const bookingId =
        input.operation === 'REFUND'
          ? await refundBooking(refundBodySchema.parse(body).sourcePaymentId, input.actor)
          : input.operation === 'MANUAL'
            ? manualBodySchema.parse(body).bookingId
            : input.operation === 'APPROVAL'
              ? refundApprovalBodySchema.parse(body).bookingId
              : input.bookingId!;
      const booking = await authorize(
        bookingId,
        input.actor,
        input.operation === 'DEPOSIT' ? 'RESTRICTED' : 'FULL',
        ['MANUAL', 'REFUND', 'APPROVAL'].includes(input.operation),
        input.operation === 'DEPOSIT',
      );
      if (['DEPOSIT', 'BALANCE'].includes(input.operation) && providers.vnpay === null)
        throw unavailable();
      const ctx = context(input.actor, input.requestId);
      return idempotency.run(
        {
          actorAccountId: input.actor.accountId,
          route: routes[input.operation],
          key: input.key,
          payload: { bookingId, body },
        },
        async (commandId) => {
          if (input.operation === 'DEPOSIT' || input.operation === 'BALANCE') {
            const vnpay = providers.vnpay!;
            const result =
              input.operation === 'DEPOSIT'
                ? await vnpay.startCheckout(
                    { bookingId, commandId, ...depositBodySchema.parse(body) },
                    input.ip,
                    ctx,
                  )
                : await vnpay.startBalanceCheckout(
                    { bookingId, commandId, ...balanceBodySchema.parse(body) },
                    input.ip,
                    ctx,
                  );
            return {
              status: 201,
              body: checkoutResponseSchema.parse({
                data: {
                  paymentAttemptId: result.attempt.id,
                  status: result.attempt.state,
                  checkoutUrl: result.checkoutUrl,
                  expiresAt: result.attempt.expiresAt,
                },
              }),
            };
          }
          // A committed owner result wins before resolving mutable timeline/revision/
          // approval metadata, including after response persistence or process failure.
          const previous = await prisma.billingOperationCommand.findUnique({
            where: { commandId },
          });
          let result;
          if (previous !== null) {
            if (
              previous.bookingId !== bookingId ||
              previous.actorAccountId !== input.actor.accountId ||
              previous.kind !==
                { MANUAL: 'MANUAL_PAYMENT', REFUND: 'REFUND', APPROVAL: 'REFUND_APPROVAL' }[
                  input.operation
                ]
            )
              throw new AppError({
                status: 422,
                code: 'IDEMPOTENCY_KEY_REUSED',
                message: 'The intent identity conflicts.',
              });
            result = billingCommandResultSchema.parse(previous.result);
          } else if (input.operation === 'MANUAL') {
            const manual = manualBodySchema.parse(body);
            if (manual.purpose === 'DEPOSIT') {
              if (booking.currentTimelineRevisionId === null)
                throw new AppError({
                  status: 409,
                  code: 'DEPOSIT_NOT_ELIGIBLE',
                  message: 'An approved timeline is required.',
                });
              result = await providers.operations.recordManualPayment(
                {
                  ...manual,
                  commandId,
                  purpose: 'DEPOSIT',
                  timelineRevisionId: booking.currentTimelineRevisionId,
                },
                ctx,
              );
            } else {
              const ledger = await providers.ledger.getLedger(bookingId, ctx);
              result = await providers.operations.recordManualPayment(
                {
                  ...manual,
                  commandId,
                  purpose: 'BALANCE',
                  expectedBillingRevision: ledger.revision,
                },
                ctx,
              );
            }
          } else if (input.operation === 'APPROVAL') {
            const approval = refundApprovalBodySchema.parse(body);
            let basis;
            if (approval.basis.kind === 'CREDIT') basis = approval.basis;
            else {
              if (booking.phase !== 'CANCELLED')
                throw new AppError({
                  status: 409,
                  code: 'PAYMENT_EVIDENCE_CONFLICT',
                  message: 'A recorded booking cancellation is required.',
                });
              const cancellation = await prisma.bookingReportingSnapshot.findFirst({
                where: { bookingId, value: { path: ['phase'], equals: 'CANCELLED' } },
                orderBy: { sequence: 'desc' },
              });
              if (cancellation === null)
                throw new AppError({
                  status: 409,
                  code: 'PAYMENT_EVIDENCE_CONFLICT',
                  message: 'A recorded booking cancellation is required.',
                });
              basis = { kind: 'CANCELLATION' as const, sequence: cancellation.sequence };
            }
            result = await providers.operations.approveRefund(
              { ...approval, basis, commandId },
              ctx,
            );
          } else {
            const refund = refundBodySchema.parse(body);
            const ledger = await providers.ledger.getLedger(bookingId, ctx);
            const decisions = await prisma.billingRefundApproval.findMany({
              where: { bookingId },
              orderBy: [{ approvedAt: 'asc' }, { id: 'asc' }],
            });
            const decision = decisions.find(
              (row) =>
                Number(row.approvedRefundableVnd) -
                  ledger.entries
                    .filter((entry) => entry.kind === 'REFUND' && entry.decisionId === row.id)
                    .reduce((sum, entry) => sum + entry.amountVnd, 0) >=
                refund.amountVnd,
            );
            if (decision === undefined)
              throw new AppError({
                status: 409,
                code: 'BILLING_REFUND_APPROVAL_REQUIRED',
                message: 'A recorded refund approval is required.',
              });
            result = await providers.operations.recordRefund(
              {
                ...refund,
                bookingId,
                commandId,
                decisionId: decision.id,
                recordedAt: new Date().toISOString(),
              },
              ctx,
            );
          }
          return {
            status: 201,
            body:
              input.operation === 'MANUAL'
                ? paymentResponseSchema.parse({
                    data: {
                      paymentId: result.resourceId,
                      paymentAttemptId: result.paymentAttemptId,
                    },
                  })
                : input.operation === 'APPROVAL'
                  ? refundApprovalResponseSchema.parse({
                      data: { refundApprovalId: result.resourceId },
                    })
                  : refundResponseSchema.parse({ data: { refundId: result.resourceId } }),
          };
        },
      );
    },
    async read(
      bookingId: string,
      query: Readonly<{
        limit: number;
        cursor?: string | undefined;
        throughBillingRevision?: number | undefined;
      }>,
      actor: AuthenticatedActor,
      requestId: string,
    ) {
      await authorize(bookingId, actor, 'FULL');
      return providers.views.read({ bookingId, ...query }, context(actor, requestId));
    },
    async attempt(
      bookingId: string,
      attemptId: string,
      actor: AuthenticatedActor,
      requestId: string,
    ) {
      await authorize(bookingId, actor, 'RESTRICTED');
      const ctx = context(actor, requestId);
      const attempt = await providers.ledger.getAttempt(bookingId, attemptId, ctx);
      if (attempt.purpose === 'BALANCE') await authorize(bookingId, actor, 'FULL');
      let status = attempt.state;
      let applicationStatus: 'PENDING' | 'SUCCEEDED' | null = null;
      let checkoutUrl: string | undefined;
      if (attempt.provider === 'VNPAY' && providers.vnpay !== null) {
        const result = await providers.vnpay.reconcile(bookingId, attemptId, {
          ...ctx,
          actorAccountId: null,
          authority: 'SYSTEM',
        });
        status = result.status;
        applicationStatus = result.applicationStatus;
        checkoutUrl = result.checkoutUrl;
      } else if (status === 'SUCCEEDED') {
        const ledger = await providers.ledger.getLedger(bookingId, ctx);
        const payment = ledger.entries.find(
          (entry) => entry.kind === 'PAYMENT' && entry.paymentAttemptId === attempt.id,
        );
        applicationStatus =
          payment !== undefined &&
          (attempt.purpose === 'BALANCE' ||
            (await providers.ledger.isDepositApplied(bookingId, payment.id, ctx)))
            ? 'SUCCEEDED'
            : 'PENDING';
      }
      await authorize(bookingId, actor, attempt.purpose === 'DEPOSIT' ? 'RESTRICTED' : 'FULL');
      return attemptResponseSchema.parse({
        data: {
          paymentAttemptId: attempt.id,
          ...(checkoutUrl === undefined ? {} : { checkoutUrl }),
          status,
          purpose: attempt.purpose,
          amountVnd: attempt.amountVnd,
          ...(attempt.invoiceRevisionId
            ? {
                invoiceRevisionId: attempt.invoiceRevisionId,
                invoiceDigest: attempt.invoiceDigest,
                sourceBillingRevision: attempt.sourceBillingRevision,
              }
            : {}),
          applicationStatus,
          expiresAt: attempt.expiresAt,
        },
      });
    },
    ipn(rawQuery: string) {
      return providers.vnpay === null
        ? Promise.resolve({ RspCode: '99' as const, Message: 'Processing failure' })
        : providers.vnpay.processIpn(rawQuery);
    },
    async auditDenial(
      requestId: string,
      actorId: string | null,
      operation: string,
      error: AppError,
    ) {
      await prisma.auditLog.create({
        data: {
          requestId,
          actorType: actorId === null ? 'SYSTEM' : 'USER',
          actorId,
          action: 'billing.access-denied',
          entityType: 'billing-access',
          metadata: { operation, code: error.code, status: error.status },
        },
      });
    },
  });
}
export type PaymentsBillingHttpServices = ReturnType<typeof createPaymentsBillingHttpServices>;
export type ManualPaymentBody = z.infer<typeof manualBodySchema>;
