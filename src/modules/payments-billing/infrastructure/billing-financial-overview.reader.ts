import type { createBookingBoundaryUnitOfWork } from '../../../core/database/booking-unit-of-work.js';
import { NotFoundError } from '../../../core/errors/app-error.js';
import {
  commercialConflict,
  contractDocumentSchema,
  documentDigest,
} from '../../booking-lifecycle/domain/commercial-contract.js';
import { createContractFinancialReader } from '../../booking-lifecycle/infrastructure/contract-financial.reader.js';
import { createEffectiveCommercialReader } from '../../booking-lifecycle/infrastructure/effective-commercial.reader.js';
import { readReceivables } from './billing-persistence.queries.js';
import {
  billingFinancialOverviewSchema,
  type BillingFinancialOverviewReader,
} from '../application/billing-financial-overview.js';

export function createBillingFinancialOverviewReader(
  scope: ReturnType<typeof createBookingBoundaryUnitOfWork>,
): BillingFinancialOverviewReader {
  // Called only after read authorization, inside the same repeatable-read ledger snapshot.
  return (bookingId, context) =>
    scope.withClient(bookingId, context, async (client) => {
      const booking = await client.booking.findUnique({
        where: { id: bookingId },
        select: {
          revision: true,
          phase: true,
          commercialModelVersion: true,
          commercialContract: { select: { currentRevision: true } },
          proposalSnapshot: {
            select: {
              baseChargeVnd: true,
              depositAmountVnd: true,
              commercialRevisionId: true,
              commercialAcceptedAt: true,
            },
          },
          depositSettlement: {
            select: {
              contractRevisionId: true,
              documentDigest: true,
              amountVnd: true,
              promotionStatus: true,
            },
          },
        },
      });
      if (booking === null) throw new NotFoundError();
      const received = await client.billingLedgerEntry.aggregate({
        where: {
          bookingId,
          kind: 'PAYMENT',
          paymentAttempt: { purpose: 'DEPOSIT', state: 'SUCCEEDED' },
        },
        _sum: { amountVnd: true },
      });
      const depositReceivedVnd = received._sum.amountVnd?.toNumber() ?? 0;
      const settledRevision = booking.depositSettlement?.contractRevisionId;
      let row = booking.commercialContract?.currentRevision ?? null;
      if (settledRevision && settledRevision !== row?.id) {
        row = await client.commercialContractRevision.findFirst({
          where: { bookingId, id: settledRevision },
        });
        if (row === null) throw commercialConflict('FINANCIAL_SOURCE_CONFLICT');
      }
      let totalVnd: number | null = null;
      let requiredDepositVnd: number | null = null;
      let state: 'NOT_CREATED' | 'DRAFT' | 'AWAITING_APPROVAL' | 'APPROVED' | 'SUPERSEDED' =
        'NOT_CREATED';
      let source: 'CONTRACT' | 'LEGACY_PROPOSAL' | 'NONE' = 'NONE';
      let revisionId: string | null = null;
      let revisionNumber: number | null = null;
      if (row !== null) {
        const document = contractDocumentSchema.parse(row.document);
        if (
          documentDigest(document) !== row.documentDigest ||
          document.contractTotalVnd !== row.contractTotalVnd.toNumber() ||
          document.depositAmountVnd !== row.depositAmountVnd.toNumber()
        ) {
          throw commercialConflict('FINANCIAL_SOURCE_CONFLICT');
        }
        if (row.state === 'APPROVED' || settledRevision) {
          await createContractFinancialReader(client).resolveApproved(bookingId, row.id);
        }
        if (
          settledRevision &&
          (booking.depositSettlement?.documentDigest !== row.documentDigest ||
            booking.depositSettlement.amountVnd.toNumber() !== document.depositAmountVnd)
        )
          throw commercialConflict('FINANCIAL_SOURCE_CONFLICT');
        source = 'CONTRACT';
        state = settledRevision ? 'APPROVED' : row.state;
        revisionId = row.id;
        revisionNumber = row.revisionNumber;
        totalVnd = document.contractTotalVnd;
        requiredDepositVnd = document.depositAmountVnd;
      } else if (
        booking.commercialModelVersion === 'LEGACY_PROPOSAL_V1' &&
        booking.proposalSnapshot
      ) {
        const proposal = booking.proposalSnapshot;
        source = 'LEGACY_PROPOSAL';
        state = proposal.commercialAcceptedAt !== null ? 'APPROVED' : 'DRAFT';
        revisionId = proposal.commercialRevisionId;
        totalVnd = proposal.baseChargeVnd.toNumber();
        requiredDepositVnd = proposal.depositAmountVnd.toNumber();
      }
      const ledger = await readReceivables(client, bookingId);
      const effectiveContractVnd = settledRevision
        ? (await createEffectiveCommercialReader(client).getEffective(bookingId)).totalVnd
        : totalVnd;
      // Before a proven deposit the agreement is visible without manufacturing a ledger charge.
      // Once charged, the ledger includes approved appendices and finalized expenses exactly once.
      const payableVnd =
        booking.phase === 'CANCELLED' || ledger.acceptedChargesVnd > 0 || booking.depositSettlement
          ? ledger.acceptedChargesVnd
          : state === 'APPROVED'
            ? effectiveContractVnd
            : null;
      return billingFinancialOverviewSchema.parse({
        bookingRevision: booking.revision,
        phase: booking.phase,
        source,
        state,
        revisionId,
        revisionNumber,
        totalVnd,
        requiredDepositVnd,
        depositReceivedVnd,
        depositRemainingVnd:
          requiredDepositVnd === null ? null : Math.max(0, requiredDepositVnd - depositReceivedVnd),
        depositApplied: booking.depositSettlement?.promotionStatus === 'SUCCEEDED',
        settlementSummary: {
          effectiveContractVnd,
          payableVnd,
          netReceivedVnd: ledger.netPaidVnd,
          outstandingVnd: payableVnd === null ? null : Math.max(0, payableVnd - ledger.netPaidVnd),
          creditVnd: payableVnd === null ? 0 : Math.max(0, ledger.netPaidVnd - payableVnd),
        },
      });
    });
}
