import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../core/errors/app-error.js';
import type { LedgerSnapshot } from './billing-ledger.port.js';
import {
  readBalancePaymentEligibility,
  requireBalancePayment,
} from './balance-payment-eligibility.js';
import { billingResponseSchema } from '../http/payments-billing.schemas.js';

const bookingId = '00000000-0000-4000-8000-000000000001';
const context = {
  authority: 'AUTHENTICATED' as const,
  actorAccountId: bookingId,
  requestId: bookingId,
  causationId: bookingId,
};
function fixture() {
  const ledger = {
    revision: 2,
    entries: [],
    totals: {
      acceptedChargesVnd: 17_500_000,
      paidVnd: 5_250_000,
      refundedVnd: 0,
      netPaidVnd: 5_250_000,
      outstandingVnd: 12_250_000,
      creditVnd: 0,
    },
  } satisfies LedgerSnapshot;
  const input = { bookingId, phase: 'CONFIRMED', ledger, throughBillingRevision: 2 };
  const dependencies = {
    invoice: { getApplicable: vi.fn().mockResolvedValue(null) },
    operations: { requireBalanceAvailable: vi.fn().mockResolvedValue(undefined) },
    providerEnabled: true,
  };
  const read = () => readBalancePaymentEligibility(input, dependencies, context);
  return { input, dependencies, read };
}
const conflict = (code: string) => new AppError({ status: 409, code, message: 'Conflict' });

describe('balance payment eligibility', () => {
  it('exposes the full-contract invoice prerequisite and keeps command rejection', async () => {
    const f = fixture();
    f.dependencies.invoice.getApplicable.mockRejectedValue(
      conflict('INVOICE_FINALIZATION_REQUIRED'),
    );
    expect(await f.read()).toEqual({
      canPay: false,
      reasonCode: 'INVOICE_FINALIZATION_REQUIRED',
      nextAction: 'WAIT_FOR_FINAL_INVOICE',
      billingRevision: 2,
    });
    await expect(requireBalancePayment(f.input, f.dependencies, context)).rejects.toMatchObject({
      code: 'INVOICE_FINALIZATION_REQUIRED',
    });
    expect(f.dependencies.operations.requireBalanceAvailable).not.toHaveBeenCalled();
  });

  it('allows legacy balances without an invoice and invoice-backed balances with exact totals', async () => {
    const f = fixture();
    const allowed = {
      canPay: true,
      reasonCode: null,
      nextAction: 'PAY_BALANCE',
      billingRevision: 2,
    };
    expect(await f.read()).toEqual(allowed);
    f.dependencies.invoice.getApplicable.mockResolvedValue({
      invoiceRevisionId: bookingId,
      invoiceDigest: 'a'.repeat(64),
      totalVnd: 17_500_000,
    });
    expect(await f.read()).toEqual(allowed);
    expect(f.dependencies.invoice.getApplicable).toHaveBeenLastCalledWith(bookingId, context);
  });

  it('cannot offer another checkout while an attempt remains unresolved', async () => {
    const f = fixture();
    f.dependencies.operations.requireBalanceAvailable.mockRejectedValue(
      conflict('PAYMENT_ATTEMPT_ACTIVE'),
    );
    expect(await f.read()).toMatchObject({
      canPay: false,
      reasonCode: 'PAYMENT_ATTEMPT_ACTIVE',
      nextAction: 'CHECK_EXISTING_PAYMENT',
    });
  });

  it.each(['DRAFT', 'AWAITING_DEPOSIT', 'CANCELLED'])(
    'blocks phase %s before invoice/attempt reads',
    async (phase) => {
      const f = fixture();
      f.input.phase = phase;
      expect(await f.read()).toMatchObject({ canPay: false, reasonCode: 'BALANCE_NOT_ELIGIBLE' });
      expect(f.dependencies.invoice.getApplicable).not.toHaveBeenCalled();
    },
  );

  it('never enables checkout using a historical pagination fence', async () => {
    const f = fixture();
    f.input.throughBillingRevision = 1;
    expect(await f.read()).toEqual({
      canPay: false,
      reasonCode: 'STALE_BILLING_REVISION',
      nextAction: 'REFRESH_BILLING',
      billingRevision: 2,
    });
    expect(f.dependencies.invoice.getApplicable).not.toHaveBeenCalled();
  });

  it('blocks invoice/ledger disagreement, zero balance, unsupported gateway amounts and disabled provider', async () => {
    const f = fixture();
    f.dependencies.invoice.getApplicable.mockResolvedValue({ totalVnd: 99 });
    expect(await f.read()).toMatchObject({ reasonCode: 'FINANCIAL_SOURCE_CONFLICT' });
    f.dependencies.invoice.getApplicable.mockResolvedValue(null);
    f.input.ledger.totals.outstandingVnd = 0;
    expect(await f.read()).toMatchObject({
      canPay: false,
      reasonCode: 'BILLING_BALANCE_LIMIT_EXCEEDED',
      nextAction: 'NONE',
    });
    f.input.ledger.totals.outstandingVnd = 10_000_000_000;
    expect(await f.read()).toMatchObject({ reasonCode: 'PAYMENT_PROVIDER_AMOUNT_UNSUPPORTED' });
    f.input.ledger.totals.outstandingVnd = 12_250_000;
    f.dependencies.providerEnabled = false;
    expect(await f.read()).toMatchObject({
      canPay: false,
      reasonCode: 'PAYMENT_PROVIDER_UNAVAILABLE',
      nextAction: 'CONTACT_RESTAURANT',
    });
  });

  it('propagates unexpected, authorization and database failures rather than reporting a business block', async () => {
    const f = fixture();
    for (const error of [
      new Error('database down'),
      conflict('INVALID_TRANSACTION_SCOPE'),
      new AppError({ status: 403, code: 'FORBIDDEN', message: 'Forbidden' }),
      Object.assign(new Error('untrusted code'), { code: 'PAYMENT_ATTEMPT_ACTIVE' }),
    ]) {
      f.dependencies.invoice.getApplicable.mockRejectedValue(error);
      await expect(f.read()).rejects.toBe(error);
    }
  });

  it('publishes a strict schema and rejects contradictory eligibility states', async () => {
    const f = fixture();
    const body = {
      data: {
        bookingId,
        billingRevision: 2,
        totals: f.input.ledger.totals,
        history: [],
        nextCursor: null,
        balancePaymentEligibility: await f.read(),
      },
    };
    expect(billingResponseSchema.parse(body)).toEqual(body);
    f.dependencies.invoice.getApplicable.mockRejectedValue(
      conflict('INVOICE_FINALIZATION_REQUIRED'),
    );
    expect(
      billingResponseSchema.parse({
        data: { ...body.data, balancePaymentEligibility: await f.read() },
      }).data.balancePaymentEligibility,
    ).toMatchObject({
      canPay: false,
      reasonCode: 'INVOICE_FINALIZATION_REQUIRED',
      nextAction: 'WAIT_FOR_FINAL_INVOICE',
    });
    for (const value of [
      {
        ...body.data.balancePaymentEligibility,
        canPay: true,
        reasonCode: 'PAYMENT_ATTEMPT_ACTIVE',
      },
      { ...body.data.balancePaymentEligibility, canPay: false, reasonCode: null },
      {
        canPay: false,
        reasonCode: 'INVOICE_FINALIZATION_REQUIRED',
        nextAction: 'NONE',
        billingRevision: 2,
      },
      { ...body.data.balancePaymentEligibility, nextAction: 'UNRECOGNIZED' },
      { ...body.data.balancePaymentEligibility, extra: true },
    ])
      expect(
        billingResponseSchema.safeParse({
          data: { ...body.data, balancePaymentEligibility: value },
        }).success,
      ).toBe(false);
  });
});
