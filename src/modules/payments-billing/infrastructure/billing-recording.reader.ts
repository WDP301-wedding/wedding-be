import { AppError } from '../../../core/errors/app-error.js';
import type { createBookingBoundaryUnitOfWork } from '../../../core/database/booking-unit-of-work.js';
import type { ContractContext } from '../application/payments-billing.providers.js';
import type { BillingOperationsRepository } from '../application/billing-operations.port.js';
import {
  requireBalancePayment,
  balancePaymentBlockActions,
  type BalancePaymentDependencies,
} from '../application/balance-payment-eligibility.js';
import { readReceivables } from './billing-persistence.queries.js';
import { recordingResponseSchema } from '../http/billing-recording.schemas.js';
import { readCancellationRefundPolicy } from '../../booking-lifecycle/infrastructure/cancellation-refund.reader.js';

/** Read-only advisory snapshot. Every command still rechecks its financial authority atomically. */
export function createBillingRecordingReader(
  scope: ReturnType<typeof createBookingBoundaryUnitOfWork>,
  operations: BillingOperationsRepository,
  invoice: NonNullable<BalancePaymentDependencies['invoice']>,
) {
  return (
    bookingId: string,
    query: { afterRevision: number; limit: number },
    context: ContractContext,
  ) =>
    scope.readBoundary.run({ bookingId, context }, async (scoped) => {
      await operations.requireManager(bookingId, scoped);
      return scope.withClient(bookingId, scoped, async (tx) => {
        const booking = await tx.booking.findUniqueOrThrow({
          where: { id: bookingId },
          select: {
            phase: true,
            revision: true,
            commercialModelVersion: true,
            currentTimelineRevisionId: true,
            currentTimelineRevision: {
              select: { managerApprovedAt: true, coupleApprovedAt: true },
            },
            commercialContract: {
              select: {
                currentRevision: {
                  select: {
                    id: true,
                    state: true,
                    timelineRevisionId: true,
                    documentDigest: true,
                    depositAmountVnd: true,
                  },
                },
              },
            },
            proposalSnapshot: { select: { depositAmountVnd: true } },
            depositSettlement: { select: { bookingId: true, amountVnd: true, settledAt: true } },
            depositIntents: {
              where: { status: { in: ['ACTIVE', 'UNKNOWN'] } },
              take: 1,
              select: { id: true },
            },
            billingPaymentAttempts: {
              where: { state: { in: ['CREATED', 'PENDING', 'UNKNOWN'] } },
              take: 1,
              select: { id: true },
            },
          },
        });
        const head = await tx.billingLedgerEntry.aggregate({
          where: { bookingId },
          _max: { revision: true },
        });
        const revision = head._max.revision ?? 0;
        const totals = await readReceivables(tx, bookingId);
        let balance: { canPay: boolean; reasonCode: string | null };
        try {
          await requireBalancePayment(
            { bookingId, phase: booking.phase, ledger: { revision, totals, entries: [] } },
            { operations, invoice },
            scoped,
          );
          balance = { canPay: true, reasonCode: null };
        } catch (cause) {
          if (
            !(cause instanceof AppError) ||
            cause.status !== 409 ||
            !(cause.code in balancePaymentBlockActions)
          )
            throw cause;
          balance = { canPay: false, reasonCode: cause.code };
        }
        const current = booking.commercialContract?.currentRevision;
        const fullContract =
          booking.commercialContract !== null ||
          booking.commercialModelVersion === 'FULL_CONTRACT_V1';
        const approved =
          current?.state === 'APPROVED' &&
          current.timelineRevisionId === booking.currentTimelineRevisionId;
        const reason =
          !['DRAFT', 'AWAITING_DEPOSIT'].includes(booking.phase) || booking.depositSettlement
            ? 'BOOKING_NOT_PAYABLE'
            : booking.depositIntents.length || booking.billingPaymentAttempts.length
              ? 'PAYMENT_ATTEMPT_ACTIVE'
              : !booking.currentTimelineRevision?.managerApprovedAt ||
                  !booking.currentTimelineRevision.coupleApprovedAt
                ? 'TIMELINE_NOT_MUTUALLY_APPROVED'
                : fullContract && !approved
                  ? 'CONTRACT_APPROVAL_REQUIRED'
                  : null;
        // Capacity follows the existing single-decision / single-credit cancellation resolver.
        // SQL aggregates all refunds, not merely a displayed history page. No per-payment query.
        const [capacity] = await tx.$queryRaw<Array<{ available: unknown }>>`
        WITH used AS (SELECT "decisionId", SUM("amountVnd") AS amount FROM "BillingLedgerEntry" WHERE "bookingId"=${bookingId}::uuid AND "kind"='REFUND' GROUP BY "decisionId"),
        decisions AS (SELECT a.*, GREATEST(0,a."approvedRefundableVnd"-COALESCE(u.amount,0)) AS remaining FROM "BillingRefundApproval" a LEFT JOIN used u ON u."decisionId"=a.id WHERE a."bookingId"=${bookingId}::uuid),
        allocations AS (SELECT "basisId",SUM("approvedRefundableVnd") AS amount FROM decisions WHERE "basisKind"='CREDIT' GROUP BY "basisId")
        SELECT GREATEST(0,
          COALESCE((SELECT MAX(remaining) FROM decisions),0),
          COALESCE((SELECT MAX(e."amountVnd"-COALESCE(a.amount,0)) FROM "BillingLedgerEntry" e LEFT JOIN allocations a ON a."basisId"=e.id WHERE e."bookingId"=${bookingId}::uuid AND e."kind"='CREDIT_ADJUSTMENT'),0),
          CASE WHEN ${booking.phase}='CANCELLED' AND EXISTS(SELECT 1 FROM "BookingReportingSnapshot" WHERE "bookingId"=${bookingId}::uuid AND value->>'phase'='CANCELLED')
          THEN ${totals.paidVnd}::numeric-COALESCE((SELECT SUM("approvedRefundableVnd") FROM decisions WHERE "basisKind"='CANCELLATION' AND "basisId"=${bookingId}::uuid),0) ELSE 0 END
        ) AS available`;
        const policy = await readCancellationRefundPolicy(tx, bookingId);
        const refundedDeposit = policy.depositPaymentId
          ? await tx.billingLedgerEntry.aggregate({
              where: { bookingId, kind: 'REFUND', sourceEntryId: policy.depositPaymentId },
              _sum: { amountVnd: true },
            })
          : null;
        const alreadyRefundedVnd = Number(refundedDeposit?._sum.amountVnd ?? 0);
        const remainingVnd = Math.max(0, (policy.entitledVnd ?? 0) - alreadyRefundedVnd);
        const canRefund =
          booking.phase === 'CANCELLED' && policy.ratePercent !== null && remainingVnd > 0;
        const maxRefund = Math.min(
          totals.netPaidVnd,
          remainingVnd,
          Number(capacity?.available ?? 0),
        );
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            revision: number;
            occurredAt: Date;
            amountVnd: unknown;
            refundedVnd: unknown;
            purpose: 'DEPOSIT' | 'BALANCE' | null;
            provider: 'MANUAL' | 'VNPAY' | null;
          }>
        >`
        WITH returned AS (SELECT "sourceEntryId", SUM("amountVnd") AS amount FROM "BillingLedgerEntry" WHERE "bookingId"=${bookingId}::uuid AND "kind"='REFUND' GROUP BY "sourceEntryId")
        SELECT p.id,p.revision,p."occurredAt",p."amountVnd",COALESCE(r.amount,0) AS "refundedVnd",a.purpose,a.provider
        FROM "BillingLedgerEntry" p LEFT JOIN returned r ON r."sourceEntryId"=p.id LEFT JOIN "BillingPaymentAttempt" a ON a.id=p."paymentAttemptId" AND a."bookingId"=p."bookingId"
        WHERE p."bookingId"=${bookingId}::uuid AND p.kind='PAYMENT' AND p.revision>${query.afterRevision} AND p."amountVnd">COALESCE(r.amount,0)
        ORDER BY p.revision ASC LIMIT ${query.limit + 1}`;
        const page = rows.slice(0, query.limit);
        return recordingResponseSchema.parse({
          data: {
            bookingId,
            bookingRevision: booking.revision,
            bookingPhase: booking.phase,
            billingRevision: revision,
            cancellationRefund: {
              ...policy,
              canRecord: canRefund,
              alreadyRefundedVnd,
              remainingVnd,
              options: ([100, 50, 0] as const).map((percent) => ({
                percent,
                amountVnd:
                  percent === 100
                    ? policy.depositReceivedVnd
                    : percent === 50
                      ? Math.floor(policy.depositReceivedVnd / 2)
                      : 0,
              })),
            },
            deposit: {
              isSettled: booking.depositSettlement !== null,
              settledAmountVnd: Number(booking.depositSettlement?.amountVnd ?? 0),
              settledAt: booking.depositSettlement?.settledAt.toISOString() ?? null,
              canRecord: reason === null,
              amountVnd: Number(
                approved
                  ? current.depositAmountVnd
                  : (booking.proposalSnapshot?.depositAmountVnd ?? 0),
              ),
              reasonCode: reason,
              contractRevisionId: approved ? current.id : null,
              documentDigest: approved ? current.documentDigest : null,
              timelineRevisionId: booking.currentTimelineRevisionId,
            },
            balance: {
              canRecord: balance.canPay,
              maxAmountVnd: totals.outstandingVnd,
              reasonCode: balance.canPay ? null : balance.reasonCode,
            },
            refundablePayments: page.map((row) => {
              const amount = Number(row.amountVnd),
                returned = Number(row.refundedVnd);
              return {
                paymentId: row.id,
                revision: row.revision,
                occurredAt: row.occurredAt.toISOString(),
                purpose: row.purpose,
                provider: row.provider,
                amountVnd: amount,
                refundedVnd: returned,
                maxRefundVnd:
                  canRefund && row.id === policy.depositPaymentId
                    ? Math.max(0, Math.min(amount - returned, maxRefund))
                    : 0,
              };
            }),
            nextAfterRevision: rows.length > query.limit ? page.at(-1)!.revision : null,
          },
        });
      });
    });
}
