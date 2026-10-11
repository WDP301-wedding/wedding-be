import { randomUUID } from 'node:crypto';
import { AppError } from '../../../core/errors/app-error.js';
import type { ApprovedCommercialContract } from '../../booking-lifecycle/application/commercial-contract.port.js';
import type { BillingLedgerRepository } from './billing-ledger.port.js';
import type { ContractContext } from './payments-billing.providers.js';

// Register only with proven deposit money. Failed checkouts must not leave a stale
// charge when the still-unconfirmed contract is revised. No network in this UoW.
export async function registerContractCharge(
  ledger: Pick<BillingLedgerRepository, 'getLedger' | 'append'>,
  snapshot: ApprovedCommercialContract,
  context: ContractContext,
) {
  const entries = (await ledger.getLedger(snapshot.bookingId, context)).entries;
  const conflict = entries.some(
    (entry) =>
      ['BASE_BOOKING', 'PRINT_ORDER'].includes(entry.sourceType) ||
      (entry.sourceType === 'CONTRACT' && entry.sourceRevisionId !== snapshot.contractRevisionId),
  );
  if (conflict)
    throw new AppError({
      status: 409,
      code: 'FINANCIAL_SOURCE_CONFLICT',
      message: 'The agreed obligation already has incompatible financial evidence.',
    });
  return ledger.append(
    {
      id: randomUUID(),
      bookingId: snapshot.bookingId,
      kind: 'CHARGE',
      sourceType: 'CONTRACT',
      sourceRevisionId: snapshot.contractRevisionId,
      amountVnd: snapshot.contractTotalVnd,
      occurredAt: snapshot.approvedAt,
      sourceEntryId: null,
      paymentAttemptId: null,
      decisionId: null,
      approvedRefundableVnd: null,
      reason: null,
      evidenceReference: null,
    },
    context,
  );
}
