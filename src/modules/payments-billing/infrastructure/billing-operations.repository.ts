import { createBookingBoundaryUnitOfWork } from '../../../core/database/booking-unit-of-work.js';
import {
  AppError,
  IdempotencyKeyReusedError,
  NotFoundError,
} from '../../../core/errors/app-error.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { invoiceSnapshotSchema } from '../application/billing-ledger.port.js';
import {
  billingCommandResultSchema,
  type BillingCommandKind,
  type BillingOperationsRepository,
} from '../application/billing-operations.port.js';
import type { ContractContext } from '../application/payments-billing.providers.js';
import { BillingPersistenceConflict } from './billing.persistence.js';

export function createBillingOperationsRepository(
  prisma: PrismaClient,
  scope: ReturnType<typeof createBookingBoundaryUnitOfWork> = createBookingBoundaryUnitOfWork(
    prisma,
  ),
): BillingOperationsRepository {
  function enlisted<T>(
    bookingId: string,
    context: ContractContext,
    work: (client: PrismaClient) => Promise<T>,
  ) {
    if (context.transactionScopeId === undefined)
      throw new BillingPersistenceConflict('INVALID_TRANSACTION_SCOPE');
    return scope.withClient(bookingId, context, work);
  }
  async function actor(client: PrismaClient, context: ContractContext) {
    if (context.authority !== 'AUTHENTICATED' || context.actorAccountId === null) throw forbidden();
    const account = await client.account.findUnique({
      where: { id: context.actorAccountId },
      select: { status: true, roles: { select: { role: true } } },
    });
    if (account?.status !== 'ACTIVE') throw forbidden();
    return account;
  }
  return Object.freeze<BillingOperationsRepository>({
    requireBalanceAvailable(bookingId, context) {
      return enlisted(bookingId, context, async (client) => {
        if (
          (await client.billingPaymentAttempt.findFirst({
            where: {
              bookingId,
              purpose: 'BALANCE',
              OR: [
                { state: { in: ['CREATED', 'PENDING', 'UNKNOWN'] } },
                { state: 'SUCCEEDED', paymentEntries: { none: {} } },
              ],
            },
            select: { id: true },
          })) !== null
        )
          throw new BillingPersistenceConflict('PAYMENT_ATTEMPT_ACTIVE');
      });
    },
    requireManager(bookingId, context) {
      return enlisted(bookingId, context, async (client) => {
        if (!(await actor(client, context)).roles.some(({ role }) => role === 'MANAGER'))
          throw forbidden();
        if (
          (await client.booking.findUnique({ where: { id: bookingId }, select: { id: true } })) ===
          null
        )
          throw new NotFoundError();
      });
    },
    requireReadAccess(bookingId, context) {
      return enlisted(bookingId, context, async (client) => {
        const account = await actor(client, context);
        const booking = await client.booking.findUnique({
          where: { id: bookingId },
          select: { consultationId: true, phase: true },
        });
        if (booking === null) throw new NotFoundError();
        if (!account.roles.some(({ role }) => role === 'MANAGER')) {
          const grant = await client.consultationAccess.findUnique({
            where: {
              accountId_consultationId: {
                accountId: context.actorAccountId!,
                consultationId: booking.consultationId,
              },
            },
          });
          if (grant === null) throw new NotFoundError();
          if (grant.level !== 'FULL') throw forbidden();
        }
        return { phase: booking.phase };
      });
    },
    findCommand(bookingId, commandId, context) {
      return enlisted(bookingId, context, async (client) => {
        const row = await client.billingOperationCommand.findUnique({ where: { commandId } });
        if (row === null) return null;
        if (row.bookingId !== bookingId) throw new IdempotencyKeyReusedError();
        return Object.freeze({
          commandId: row.commandId,
          bookingId: row.bookingId,
          actorAccountId: row.actorAccountId,
          kind: row.kind as BillingCommandKind,
          bodyHash: row.bodyHash,
          result: billingCommandResultSchema.parse(row.result),
        });
      });
    },
    saveCommand(command, context) {
      return enlisted(command.bookingId, context, async (client) => {
        if (command.actorAccountId !== context.actorAccountId) throw forbidden();
        await client.billingOperationCommand.create({
          data: { ...command, result: billingCommandResultSchema.parse(command.result) },
        });
        await client.auditLog.create({
          data: {
            requestId: context.requestId,
            actorType: 'USER',
            actorId: context.actorAccountId,
            action: 'billing.command-completed',
            entityType: 'billing',
            entityId: command.commandId,
            metadata: {
              bookingId: command.bookingId,
              kind: command.kind,
              resourceId: command.result.resourceId,
            },
          },
        });
      });
    },
    getApproval(bookingId, decisionId, context) {
      return enlisted(bookingId, context, async (client) => {
        const row = await client.billingRefundApproval.findUnique({ where: { id: decisionId } });
        if (row === null || row.bookingId !== bookingId) throw new NotFoundError();
        return Object.freeze({
          ...row,
          basisKind: row.basisKind as 'CREDIT' | 'CANCELLATION',
          approvedRefundableVnd: Number(row.approvedRefundableVnd),
          approvedAt: row.approvedAt.toISOString(),
        });
      });
    },
    saveApproval(approval, context) {
      return enlisted(approval.bookingId, context, async (client) => {
        await client.billingRefundApproval.create({
          data: { ...approval, approvedAt: new Date(approval.approvedAt) },
        });
      });
    },
    getApprovedTotal(bookingId, basisKind, basisId, context) {
      return enlisted(bookingId, context, async (client) => {
        const sum = await client.billingRefundApproval.aggregate({
          where: { bookingId, basisKind, basisId },
          _sum: { approvedRefundableVnd: true },
        });
        return Number(sum._sum.approvedRefundableVnd ?? 0);
      });
    },
    getInvoice(bookingId, invoiceId, context) {
      return enlisted(bookingId, context, async (client) => {
        const row = await client.billingInvoice.findUnique({ where: { id: invoiceId } });
        if (row === null || row.bookingId !== bookingId) throw new NotFoundError();
        return Object.freeze({
          ...row,
          issuedAt: row.issuedAt.toISOString(),
          snapshot: invoiceSnapshotSchema.parse(row.snapshot),
        });
      });
    },
  });
}
function forbidden() {
  return new AppError({ status: 403, code: 'FORBIDDEN', message: 'The request is forbidden.' });
}
