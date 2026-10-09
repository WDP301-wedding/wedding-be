import { randomUUID } from 'node:crypto';

import { ledgerFactSchema, type BillingLedgerRepository } from './billing-ledger.port.js';
import type {
  BookingChargeRegistrar,
  BookingChargeAdjustmentRegistrar,
  ContractContext,
} from './payments-billing.providers.js';

// Owner-to-owner port: invitation-studio must freeze/authorize its commercial
// revision or cancellation decision before invoking this registrar.
export function createChargeRegistrationService(
  options: Readonly<{
    ledger: Pick<BillingLedgerRepository, 'append'>;
    context: () => ContractContext;
  }>,
): BookingChargeRegistrar & BookingChargeAdjustmentRegistrar {
  return Object.freeze({
    async registerAcceptedCharge(
      input: Parameters<BookingChargeRegistrar['registerAcceptedCharge']>[0],
    ) {
      const fact = ledgerFactSchema.parse({
        id: randomUUID(),
        bookingId: input.bookingId,
        kind: 'CHARGE',
        sourceType: input.sourceType,
        sourceRevisionId: input.sourceRevisionId,
        amountVnd: input.amountVnd,
        occurredAt: input.acceptedAt.toISOString(),
        sourceEntryId: null,
        paymentAttemptId: null,
        decisionId: null,
        approvedRefundableVnd: null,
        reason: null,
        evidenceReference: null,
      });
      const result = await options.ledger.append(fact, options.context());
      return Object.freeze({ receivableChargeId: result.entry.id, replayed: result.replayed });
    },
    async registerCredit(
      input: Parameters<BookingChargeAdjustmentRegistrar['registerCredit']>[0],
      context: ContractContext,
    ) {
      const fact = ledgerFactSchema.parse({
        id: randomUUID(),
        bookingId: input.bookingId,
        kind: 'CREDIT_ADJUSTMENT',
        sourceType: 'PRINT_CREDIT',
        sourceRevisionId: input.sourceAdjustmentId,
        amountVnd: input.amountVnd,
        occurredAt: input.acceptedAt,
        sourceEntryId: input.receivableChargeId,
        paymentAttemptId: null,
        decisionId: null,
        approvedRefundableVnd: null,
        reason: input.reason,
        evidenceReference: null,
      });
      const result = await options.ledger.append(fact, context);
      return Object.freeze({ adjustmentId: result.entry.id, replayed: result.replayed });
    },
  });
}
