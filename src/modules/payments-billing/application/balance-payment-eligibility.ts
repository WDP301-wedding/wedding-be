import { AppError } from '../../../core/errors/app-error.js';
import type { InvoiceBalancePin } from '../infrastructure/invoice-balance.reader.js';
import type { LedgerSnapshot } from './billing-ledger.port.js';
import type { BillingOperationsRepository } from './billing-operations.port.js';
import type { ContractContext } from './payments-billing.providers.js';

export const balancePaymentBlockActions = {
  BALANCE_NOT_ELIGIBLE: 'CONTACT_RESTAURANT',
  INVOICE_FINALIZATION_REQUIRED: 'WAIT_FOR_FINAL_INVOICE',
  FINANCIAL_SOURCE_CONFLICT: 'CONTACT_RESTAURANT',
  PAYMENT_ATTEMPT_ACTIVE: 'CHECK_EXISTING_PAYMENT',
  BILLING_BALANCE_LIMIT_EXCEEDED: 'NONE',
  PAYMENT_PROVIDER_AMOUNT_UNSUPPORTED: 'CONTACT_RESTAURANT',
  PAYMENT_PROVIDER_UNAVAILABLE: 'CONTACT_RESTAURANT',
  STALE_BILLING_REVISION: 'REFRESH_BILLING',
} as const;
type BlockReason = keyof typeof balancePaymentBlockActions;
export type BalancePaymentEligibility = Readonly<
  { billingRevision: number } & (
    | { canPay: true; reasonCode: null; nextAction: 'PAY_BALANCE' }
    | {
        canPay: false;
        reasonCode: BlockReason;
        nextAction: (typeof balancePaymentBlockActions)[BlockReason];
      }
  )
>;
type BalanceFacts = Readonly<{ bookingId: string; phase: string; ledger: LedgerSnapshot }>;
export type BalancePaymentDependencies = Readonly<{
  operations: Pick<BillingOperationsRepository, 'requireBalanceAvailable'>;
  invoice?: {
    getApplicable(bookingId: string, context: ContractContext): Promise<InvoiceBalancePin | null>;
  };
}>;

// Both command admission and its advisory GET use the same financial prerequisites.
// Callers authorize first and enlist every read in the booking boundary snapshot.
export async function requireBalancePayment(
  input: BalanceFacts,
  dependencies: BalancePaymentDependencies,
  context: ContractContext,
) {
  const reject = (code: string) =>
    new AppError({
      status: 409,
      code,
      message: 'The billing command conflicts with its authority or evidence.',
    });
  if (!['CONFIRMED', 'COMPLETED'].includes(input.phase)) throw reject('BALANCE_NOT_ELIGIBLE');
  const invoicePin = (await dependencies.invoice?.getApplicable(input.bookingId, context)) ?? null;
  if (invoicePin && invoicePin.totalVnd !== input.ledger.totals.acceptedChargesVnd)
    throw reject('FINANCIAL_SOURCE_CONFLICT');
  await dependencies.operations.requireBalanceAvailable(input.bookingId, context);
  if (input.ledger.totals.outstandingVnd === 0) throw reject('BILLING_BALANCE_LIMIT_EXCEEDED');
  return { amountVnd: input.ledger.totals.outstandingVnd, invoicePin };
}

export async function readBalancePaymentEligibility(
  input: BalanceFacts & Readonly<{ throughBillingRevision: number }>,
  dependencies: BalancePaymentDependencies & Readonly<{ providerEnabled: boolean }>,
  context: ContractContext,
): Promise<BalancePaymentEligibility> {
  const blocked = (reasonCode: BlockReason): BalancePaymentEligibility =>
    Object.freeze({
      canPay: false,
      reasonCode,
      nextAction: balancePaymentBlockActions[reasonCode],
      billingRevision: input.ledger.revision,
    });
  // Historical totals must never advertise a checkout for a newer ledger balance.
  if (input.throughBillingRevision !== input.ledger.revision)
    return blocked('STALE_BILLING_REVISION');
  try {
    const due = await requireBalancePayment(input, dependencies, context);
    if (due.amountVnd > 9_999_999_999) return blocked('PAYMENT_PROVIDER_AMOUNT_UNSUPPORTED');
    if (!dependencies.providerEnabled) return blocked('PAYMENT_PROVIDER_UNAVAILABLE');
    return Object.freeze({
      canPay: true,
      reasonCode: null,
      nextAction: 'PAY_BALANCE',
      billingRevision: input.ledger.revision,
    });
  } catch (error) {
    // Never disguise infrastructure, authorization or unknown failures as eligibility.
    if (
      error instanceof AppError &&
      error.status === 409 &&
      Object.hasOwn(balancePaymentBlockActions, error.code)
    )
      return blocked(error.code as BlockReason);
    throw error;
  }
}
