import type { createBookingBoundaryUnitOfWork } from '../../../core/database/booking-unit-of-work.js';
import { AppError } from '../../../core/errors/app-error.js';
import type { ContractContext } from '../application/payments-billing.providers.js';
import { cancellationRefundPolicySchema } from '../../booking-lifecycle/domain/cancellation-refund-policy.js';

export function createCancellationRefundGuard(
  scope: ReturnType<typeof createBookingBoundaryUnitOfWork>,
) {
  return (
    bookingId: string,
    amountVnd: number,
    sourcePaymentId: string | undefined,
    context: ContractContext,
  ) =>
    scope.withClient(bookingId, context, async (tx) => {
      const booking = await tx.booking.findUniqueOrThrow({
        where: { id: bookingId },
        select: { cancellationRefundPolicy: true },
      });
      if (!booking.cancellationRefundPolicy) return; // Retained historical decisions keep their original checks.
      const policy = cancellationRefundPolicySchema.parse(booking.cancellationRefundPolicy);
      const refunded = policy.depositPaymentId
        ? await tx.billingLedgerEntry.aggregate({
            where: { bookingId, kind: 'REFUND', sourceEntryId: policy.depositPaymentId },
            _sum: { amountVnd: true },
          })
        : null;
      if (
        policy.entitledVnd === null ||
        (sourcePaymentId !== undefined && sourcePaymentId !== policy.depositPaymentId) ||
        amountVnd > Math.max(0, (policy.entitledVnd ?? 0) - Number(refunded?._sum.amountVnd ?? 0))
      ) {
        throw new AppError({
          status: 409,
          code: 'BILLING_REFUND_LIMIT_EXCEEDED',
          message: 'Khoản hoàn vượt chính sách hủy đã xác nhận hoặc thiếu căn cứ đối soát.',
        });
      }
    });
}
