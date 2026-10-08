import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';
import { createManualBillingFixture, seedBillingManager } from './operations-fixture.js';
import { ipnFixture, queryFixture } from './vnpay-fixture.js';
import type { VnpayStatusGateway } from '../../../src/modules/payments-billing/application/vnpay.port.js';

const databaseDescribe = catalogMigrationDatabaseUrl ? describe : describe.skip;
databaseDescribe('W5 VNPay balance durability and recovery', () => {
  const database = new CatalogTestDatabase('billing_balance_vnpay');
  beforeAll(async () => {
    await database.connect();
    await seedBillingManager(database.prisma);
  }, 60000);
  afterAll(async () => {
    await database.disconnect();
  });
  async function fixture(gateway?: VnpayStatusGateway) {
    const f = await createManualBillingFixture(database.prisma, gateway);
    await f.operations.recordManualPayment(f.deposit, f.manager);
    const checkout = await f.vnpay.startBalanceCheckout(f.balance, '127.0.0.1', f.context);
    return { ...f, checkout, id: checkout.attempt.id };
  }
  function balanceIpn(id: string, changes: Record<string, string | undefined> = {}) {
    return ipnFixture(id, { vnp_Amount: '3500000000', vnp_OrderInfo: `Balance ${id}`, ...changes });
  }
  it('replays frozen checkout and concurrent verified successes append one balance without owner promotion', async () => {
    const f = await fixture();
    expect(f.checkout.attempt).toMatchObject({
      purpose: 'BALANCE',
      state: 'PENDING',
      amountVnd: 35_000_000,
    });
    expect(new URL(f.checkout.checkoutUrl).searchParams.get('vnp_OrderInfo')).toBe(
      `Balance ${f.id}`,
    );
    expect(await f.vnpay.startBalanceCheckout(f.balance, '192.0.2.1', f.context)).toEqual({
      ...f.checkout,
      replayed: true,
    });
    const before = await database.prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
    const callback = balanceIpn(f.id);
    expect(
      (await Promise.all([f.vnpay.processIpn(callback), f.vnpay.processIpn(callback)]))
        .map((v) => v.RspCode)
        .sort(),
    ).toEqual(['00', '02']);
    expect((await f.providers.ledger.getLedger(f.bookingId)).totals).toMatchObject({
      paidVnd: 50_000_000,
      outstandingVnd: 0,
    });
    expect(await database.prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } })).toEqual(
      before,
    );
    expect(
      await database.prisma.billingDepositApplication.count({
        where: { payment: { bookingId: f.bookingId } },
      }),
    ).toBe(1);
    expect(
      await database.prisma.billingLedgerEntry.count({ where: { paymentAttemptId: f.id } }),
    ).toBe(1);
    expect(await f.vnpay.reconcile(f.bookingId, f.id, f.system)).toEqual({
      status: 'SUCCEEDED',
      applicationStatus: 'SUCCEEDED',
    });
    await expect(
      f.operations.createBalance(
        { ...f.balance, commandId: randomUUID(), expectedBillingRevision: 3 },
        f.context,
      ),
    ).rejects.toMatchObject({ code: 'BILLING_BALANCE_LIMIT_EXCEEDED' });
  });
  it('holds UNKNOWN beyond expiry and queries the original checkout before recovering once', async () => {
    const query = vi.fn<VnpayStatusGateway['query']>().mockRejectedValueOnce(new Error('timeout'));
    const f = await fixture({ query });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.parse(f.checkout.attempt.expiresAt) + 1000));
    try {
      expect(await f.vnpay.reconcile(f.bookingId, f.id, f.system)).toEqual({
        status: 'UNKNOWN',
        applicationStatus: null,
      });
      await expect(
        f.operations.createBalance({ ...f.balance, commandId: randomUUID() }, f.context),
      ).rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_ACTIVE' });
    } finally {
      vi.useRealTimers();
    }
    expect(await database.prisma.bookingDepositIntent.count({ where: { id: f.id } })).toBe(0);
    query.mockResolvedValueOnce(queryFixture(f.id, { vnp_Amount: '3500000000' }));
    expect(await f.vnpay.reconcile(f.bookingId, f.id, f.system)).toEqual({
      status: 'SUCCEEDED',
      applicationStatus: 'SUCCEEDED',
    });
    expect(query.mock.calls[1]![0].vnp_TransactionDate).toBe(
      new URL(f.checkout.checkoutUrl).searchParams.get('vnp_CreateDate'),
    );
    expect(
      await database.prisma.billingLedgerEntry.count({ where: { paymentAttemptId: f.id } }),
    ).toBe(1);
  });
  it('does not recollect a durable success when money append failed, then recovers without querying', async () => {
    const query = vi.fn<VnpayStatusGateway['query']>();
    const f = await fixture({ query });
    await database.prisma
      .$executeRawUnsafe(`CREATE FUNCTION w5_balance_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW."paymentAttemptId" = '${f.id}'::uuid THEN RAISE EXCEPTION 'controlled balance append failure'; END IF; RETURN NEW; END $$`);
    await database.prisma.$executeRawUnsafe(
      'CREATE TRIGGER w5_balance_fault BEFORE INSERT ON "BillingLedgerEntry" FOR EACH ROW EXECUTE FUNCTION w5_balance_fault()',
    );
    try {
      expect(await f.vnpay.processIpn(balanceIpn(f.id))).toMatchObject({ RspCode: '00' });
      expect(await f.vnpay.reconcile(f.bookingId, f.id, f.system)).toEqual({
        status: 'SUCCEEDED',
        applicationStatus: 'PENDING',
      });
      await expect(
        f.operations.createBalance({ ...f.balance, commandId: randomUUID() }, f.context),
      ).rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_ACTIVE' });
      expect((await f.providers.ledger.getLedger(f.bookingId)).totals.paidVnd).toBe(15_000_000);
    } finally {
      await database.prisma.$executeRawUnsafe(
        'DROP TRIGGER w5_balance_fault ON "BillingLedgerEntry"',
      );
      await database.prisma.$executeRawUnsafe('DROP FUNCTION w5_balance_fault()');
    }
    expect(await f.vnpay.reconcile(f.bookingId, f.id, f.system)).toEqual({
      status: 'SUCCEEDED',
      applicationStatus: 'SUCCEEDED',
    });
    expect(query).not.toHaveBeenCalled();
    expect(
      await database.prisma.billingLedgerEntry.count({ where: { paymentAttemptId: f.id } }),
    ).toBe(1);
  });
  it('records true late balance as credit even after a print credit and cancellation', async () => {
    const f = await createManualBillingFixture(database.prisma);
    await f.operations.recordManualPayment(f.deposit, f.manager);
    const charge = await f.providers.charges.registerAcceptedCharge({
      bookingId: f.bookingId,
      sourceType: 'PRINT_ORDER',
      sourceRevisionId: randomUUID(),
      amountVnd: 4_000_000,
      acceptedAt: new Date(),
    });
    const checkout = await f.vnpay.startBalanceCheckout(
      { ...f.balance, expectedBillingRevision: 3 },
      '127.0.0.1',
      f.context,
    );
    expect(checkout.attempt.amountVnd).toBe(39_000_000);
    await f.providers.charges.registerCredit(
      {
        bookingId: f.bookingId,
        receivableChargeId: charge.receivableChargeId,
        sourceAdjustmentId: randomUUID(),
        amountVnd: 4_000_000,
        reason: 'PRINT_CANCELLED',
        acceptedAt: new Date().toISOString(),
      },
      f.system,
    );
    await database.prisma.booking.update({
      where: { id: f.bookingId },
      data: { phase: 'CANCELLED' },
    });
    expect(
      await f.vnpay.processIpn(balanceIpn(checkout.attempt.id, { vnp_Amount: '3900000000' })),
    ).toMatchObject({ RspCode: '00' });
    expect((await f.providers.ledger.getLedger(f.bookingId)).totals).toMatchObject({
      acceptedChargesVnd: 50_000_000,
      paidVnd: 54_000_000,
      creditVnd: 4_000_000,
      outstandingVnd: 0,
    });
    expect(await database.prisma.booking.findUnique({ where: { id: f.bookingId } })).toMatchObject({
      phase: 'CANCELLED',
    });
  });
  it('verified balance failure permits a fresh intent without deposit release', async () => {
    const f = await fixture();
    const failure = balanceIpn(f.id, {
      vnp_TransactionNo: '0',
      vnp_ResponseCode: '24',
      vnp_TransactionStatus: '02',
      vnp_PayDate: undefined,
    });
    expect(await f.vnpay.processIpn(failure)).toMatchObject({ RspCode: '00' });
    expect(await f.vnpay.reconcile(f.bookingId, f.id, f.system)).toEqual({
      status: 'FAILED',
      applicationStatus: null,
    });
    expect(
      (
        await f.vnpay.startBalanceCheckout(
          { ...f.balance, commandId: randomUUID() },
          '127.0.0.1',
          f.context,
        )
      ).attempt.id,
    ).not.toBe(f.id);
    expect(await database.prisma.booking.findUnique({ where: { id: f.bookingId } })).toMatchObject({
      phase: 'CONFIRMED',
    });
  });
});
