import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { createBookingBoundaryUnitOfWork } from '../../../core/database/booking-unit-of-work.js';
import { AppError } from '../../../core/errors/app-error.js';
import type { ContractContext } from '../application/payments-billing.providers.js';
import type { BillingLedgerRepository } from '../application/billing-ledger.port.js';
import type { RefundApproval } from '../application/billing-operations.port.js';

/** Manager confirmation records the decision and refund in the same booking transaction.
 * Existing credit/cancellation limits remain authoritative; this never transfers money. */
export function createManualRefundDecisionResolver(
  scope: ReturnType<typeof createBookingBoundaryUnitOfWork>,
) {
  return async (
    input: {
      bookingId: string;
      commandId: string;
      amountVnd: number;
      reason: string;
      evidenceReference: string;
      ledger: Awaited<ReturnType<BillingLedgerRepository['getLedger']>>;
    },
    context: ContractContext,
  ): Promise<RefundApproval> => {
    return scope.withClient(input.bookingId, context, async (tx: PrismaClient) => {
      if (!context.actorAccountId || context.authority !== 'AUTHENTICATED')
        throw new AppError({
          status: 403,
          code: 'FORBIDDEN',
          message: 'Manager authority is required.',
        });
      const deny = () =>
        new AppError({
          status: 409,
          code: 'BILLING_REFUND_LIMIT_EXCEEDED',
          message: 'The refund exceeds the supported credit/cancellation entitlement.',
        });
      if (input.amountVnd > input.ledger.totals.netPaidVnd) throw deny();
      const decisions = await tx.billingRefundApproval.findMany({
        where: { bookingId: input.bookingId },
        orderBy: [{ approvedAt: 'asc' }, { id: 'asc' }],
      });
      const refunded = new Map<string, number>();
      for (const entry of input.ledger.entries)
        if (entry.kind === 'REFUND' && entry.decisionId)
          refunded.set(entry.decisionId, (refunded.get(entry.decisionId) ?? 0) + entry.amountVnd);
      const retained = decisions.find(
        (row) => Number(row.approvedRefundableVnd) - (refunded.get(row.id) ?? 0) >= input.amountVnd,
      );
      if (retained)
        return {
          ...retained,
          basisKind: retained.basisKind as RefundApproval['basisKind'],
          approvedRefundableVnd: Number(retained.approvedRefundableVnd),
          approvedAt: retained.approvedAt.toISOString(),
        };
      const allocations = new Map<string, number>();
      for (const row of decisions) {
        const key = `${row.basisKind}:${row.basisId}`;
        allocations.set(key, (allocations.get(key) ?? 0) + Number(row.approvedRefundableVnd));
      }
      const allocated = (kind: string, id: string) => allocations.get(`${kind}:${id}`) ?? 0;
      const credit = input.ledger.entries.find(
        (entry) =>
          entry.kind === 'CREDIT_ADJUSTMENT' &&
          entry.amountVnd - allocated('CREDIT', entry.id) >= input.amountVnd,
      );
      let basis: {
        basisKind: RefundApproval['basisKind'];
        basisId: string;
        cancellationSequence: number | null;
      };
      if (credit) basis = { basisKind: 'CREDIT', basisId: credit.id, cancellationSequence: null };
      else {
        const booking = await tx.booking.findUniqueOrThrow({
          where: { id: input.bookingId },
          select: { phase: true },
        });
        if (
          booking.phase !== 'CANCELLED' ||
          input.amountVnd > input.ledger.totals.paidVnd - allocated('CANCELLATION', input.bookingId)
        )
          throw deny();
        const proof = await tx.bookingReportingSnapshot.findFirst({
          where: { bookingId: input.bookingId, value: { path: ['phase'], equals: 'CANCELLED' } },
          orderBy: { sequence: 'desc' },
        });
        if (!proof) throw deny();
        basis = {
          basisKind: 'CANCELLATION',
          basisId: input.bookingId,
          cancellationSequence: proof.sequence,
        };
      }
      const approvedAt = new Date();
      await tx.billingRefundApproval.create({
        data: {
          id: input.commandId,
          bookingId: input.bookingId,
          ...basis,
          approvedRefundableVnd: input.amountVnd,
          reason: input.reason,
          evidenceReference: input.evidenceReference,
          approvedByAccountId: context.actorAccountId,
          approvedAt,
        },
      });
      return {
        id: input.commandId,
        bookingId: input.bookingId,
        ...basis,
        approvedRefundableVnd: input.amountVnd,
        reason: input.reason,
        evidenceReference: input.evidenceReference,
        approvedByAccountId: context.actorAccountId,
        approvedAt: approvedAt.toISOString(),
      };
    });
  };
}
