import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createManualBillingFixture, seedBillingManager } from './operations-fixture.js';
import { ipnFixture, queryFixture } from './vnpay-fixture.js';
import type { VnpayStatusGateway } from '../../../src/modules/payments-billing/application/vnpay.port.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)('VNPay reopen and verified expiry', () => {
  const database = new CatalogTestDatabase('billing_reopen_expiry');
  beforeAll(async () => {
    await database.connect();
    await seedBillingManager(database.prisma);
  }, 60_000);
  afterAll(() => database.disconnect());
  afterEach(() => vi.useRealTimers());

  async function fixture(purpose: 'DEPOSIT' | 'BALANCE' = 'DEPOSIT') {
    const query = vi.fn<VnpayStatusGateway['query']>();
    const f = await createManualBillingFixture(database.prisma, { query });
    if (purpose === 'BALANCE') await f.operations.recordManualPayment(f.deposit, f.manager);
    const checkout =
      purpose === 'DEPOSIT'
        ? await f.vnpay.startCheckout(f.command, '127.0.0.1', f.context)
        : await f.vnpay.startBalanceCheckout(f.balance, '127.0.0.1', f.context);
    const id = checkout.attempt.id;
    const unpaid = queryFixture(id, {
      vnp_Amount: String(checkout.attempt.amountVnd * 100),
      vnp_TransactionStatus: '01',
      vnp_TransactionNo: '0',
      vnp_PayDate: undefined,
    });
    query.mockResolvedValue(unpaid);
    const at = (offset: number) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(Date.parse(checkout.attempt.expiresAt) + offset));
    };
    return { ...f, checkout, id, query, unpaid, at };
  }

  it('reopens the identical UNKNOWN checkout repeatedly without creating another attempt', async () => {
    const f = await fixture();
    for (let i = 0; i < 2; i++) {
      expect(await f.vnpay.reconcile(f.bookingId, f.id, f.system)).toMatchObject({
        status: 'UNKNOWN',
        checkoutUrl: f.checkout.checkoutUrl,
      });
    }
    expect(
      await database.prisma.billingPaymentAttempt.count({ where: { bookingId: f.bookingId } }),
    ).toBe(1);
    expect(
      await database.prisma.billingVnpayCheckout.count({ where: { paymentAttemptId: f.id } }),
    ).toBe(1);
  });

  it.each([0, 15 * 60_000])('omits the URL but keeps UNKNOWN at expiry + %i ms', async (offset) => {
    const f = await fixture();
    f.at(offset);
    const result = await f.vnpay.reconcile(f.bookingId, f.id, f.system);
    expect(result.status).toBe('UNKNOWN');
    expect(result).not.toHaveProperty('checkoutUrl');
  });

  it.each(['DEPOSIT', 'BALANCE'] as const)(
    'closes signed unpaid %s after grace and permits a replacement',
    async (purpose) => {
      const f = await fixture(purpose);
      // The exact signed payload was already stored as UNKNOWN before grace.
      await f.vnpay.reconcile(f.bookingId, f.id, f.system);
      f.at(15 * 60_000 + 1);
      expect(await f.vnpay.reconcile(f.bookingId, f.id, f.system)).toEqual({
        status: 'FAILED',
        applicationStatus: null,
      });
      expect(await f.vnpay.reconcile(f.bookingId, f.id, f.system)).toEqual({
        status: 'FAILED',
        applicationStatus: null,
      });
      if (purpose === 'DEPOSIT') {
        expect(
          await database.prisma.bookingDepositIntent.findUniqueOrThrow({ where: { id: f.id } }),
        ).toMatchObject({ status: 'RELEASED' });
        // Simulate the Manager renewing the now-expired hold before a new deposit.
        await database.prisma.bookingSlotHold.updateMany({
          where: { bookingId: f.bookingId, status: 'ACTIVE' },
          data: { expiresAt: new Date(Date.now() + 15 * 60_000) },
        });
        const replacement = await f.vnpay.startCheckout(
          { ...f.command, commandId: randomUUID() },
          '127.0.0.1',
          f.context,
        );
        expect(replacement.attempt.id).not.toBe(f.id);
      } else {
        expect(
          (await f.providers.views.read({ bookingId: f.bookingId, limit: 25 }, f.context))
            .balancePaymentEligibility.canPay,
        ).toBe(true);
        const replacement = await f.vnpay.startBalanceCheckout(
          { ...f.balance, commandId: randomUUID() },
          '127.0.0.1',
          f.context,
        );
        expect(replacement.attempt.id).not.toBe(f.id);
      }
      expect(
        await database.prisma.billingLedgerEntry.count({ where: { paymentAttemptId: f.id } }),
      ).toBe(0);
      const terminal = await database.prisma.billingPaymentAttempt.findUniqueOrThrow({
        where: { id: f.id },
      });
      expect(
        await database.prisma.auditLog.findFirst({
          where: { entityId: terminal.terminalEvidenceId! },
        }),
      ).toMatchObject({
        metadata: { resolutionReason: 'EXPIRED_UNPAID', nonPaymentReason: 'UNPAID' },
      });
      expect(
        await database.prisma.billingProviderEvidence.count({
          where: { paymentAttemptId: f.id, outcome: 'UNKNOWN' },
        }),
      ).toBe(1);
    },
  );

  it.each(['MISSING_ORDER', 'EMPTY_UNPAID'] as const)(
    'closes authenticated %s only after grace',
    async (kind) => {
      const f = await fixture();
      const missing = kind === 'MISSING_ORDER';
      f.query.mockResolvedValue(
        queryFixture(f.id, {
          vnp_ResponseCode: missing ? '91' : '00',
          vnp_Message: missing ? 'Order not found' : 'Success',
          vnp_Amount: missing ? undefined : String(f.checkout.attempt.amountVnd * 100),
          vnp_BankCode: missing ? undefined : '',
          vnp_PayDate: missing ? undefined : '',
          vnp_TransactionNo: missing ? undefined : '0',
          vnp_TransactionType: missing ? undefined : '01',
          vnp_TransactionStatus: missing ? undefined : '01',
        }),
      );
      expect((await f.vnpay.reconcile(f.bookingId, f.id, f.system)).status).toBe('UNKNOWN');
      f.at(15 * 60_000 + 1);
      expect((await f.vnpay.reconcile(f.bookingId, f.id, f.system)).status).toBe('FAILED');
    },
  );

  it.each([
    'timeout',
    'signature',
    'wrong-order',
    'wrong-amount',
    'processing',
    'reversed',
    'positive-transaction',
  ])('keeps expired %s evidence unresolved', async (kind) => {
    const f = await fixture();
    f.at(15 * 60_000 + 1);
    const changes: Record<string, string | undefined> = {
      vnp_TransactionNo: '0',
      vnp_TransactionStatus: '01',
      vnp_PayDate: undefined,
    };
    if (kind === 'timeout') f.query.mockRejectedValue(new Error('controlled timeout'));
    else {
      if (kind === 'signature') changes.vnp_SecureHash = 'invalid';
      if (kind === 'wrong-order') changes.vnp_TxnRef = randomUUID();
      if (kind === 'wrong-amount') changes.vnp_Amount = '100';
      if (kind === 'processing') changes.vnp_TransactionStatus = '05';
      if (kind === 'reversed') changes.vnp_TransactionStatus = '04';
      if (kind === 'positive-transaction') changes.vnp_TransactionNo = '123456';
      f.query.mockResolvedValue(queryFixture(f.id, changes));
    }
    expect((await f.vnpay.reconcile(f.bookingId, f.id, f.system)).status).toBe('UNKNOWN');
    expect(
      await database.prisma.bookingDepositIntent.findUniqueOrThrow({ where: { id: f.id } }),
    ).toMatchObject({ status: 'UNKNOWN' });
  });

  it('accepts a verified success after grace instead of expiring it', async () => {
    const f = await fixture();
    f.at(15 * 60_000 + 1);
    f.query.mockResolvedValue(queryFixture(f.id));
    expect(await f.vnpay.reconcile(f.bookingId, f.id, f.system)).toEqual({
      status: 'SUCCEEDED',
      applicationStatus: 'SUCCEEDED',
    });
    expect(
      await database.prisma.billingLedgerEntry.count({ where: { paymentAttemptId: f.id } }),
    ).toBe(1);
  });

  it('does not let an in-flight expiry query overwrite an IPN success', async () => {
    const f = await fixture();
    f.at(15 * 60_000 + 1);
    let complete!: (value: unknown) => void;
    let started!: () => void;
    const queried = new Promise<void>((resolve) => {
      started = resolve;
    });
    f.query.mockImplementation(() => {
      started();
      return new Promise((resolve) => {
        complete = resolve;
      });
    });
    const reconciliation = f.vnpay.reconcile(f.bookingId, f.id, f.system);
    await queried;
    expect(await f.vnpay.processIpn(ipnFixture(f.id))).toMatchObject({ RspCode: '00' });
    complete(f.unpaid);
    expect(await reconciliation).toEqual({ status: 'SUCCEEDED', applicationStatus: 'SUCCEEDED' });
    expect(
      await database.prisma.billingLedgerEntry.count({ where: { paymentAttemptId: f.id } }),
    ).toBe(1);
  });

  it('retains success received after committed expiry failure as a reconciliation conflict', async () => {
    const f = await fixture();
    f.at(15 * 60_000 + 1);
    expect((await f.vnpay.reconcile(f.bookingId, f.id, f.system)).status).toBe('FAILED');
    expect(await f.vnpay.processIpn(ipnFixture(f.id))).toMatchObject({ RspCode: '99' });
    expect(
      await database.prisma.billingProviderEvidence.findFirst({
        where: { paymentAttemptId: f.id, outcome: 'SUCCEEDED' },
      }),
    ).toMatchObject({ decision: 'CONFLICT' });
    expect(
      await database.prisma.bookingDepositIntent.findUniqueOrThrow({ where: { id: f.id } }),
    ).toMatchObject({ status: 'RELEASED' });
    expect(
      await database.prisma.billingLedgerEntry.count({ where: { paymentAttemptId: f.id } }),
    ).toBe(0);
  });
});
