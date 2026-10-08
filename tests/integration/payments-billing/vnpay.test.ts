import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { seedVenueCatalog } from '../../../scripts/catalog-seed.js';
import { createPaymentsBillingProviders } from '../../../src/modules/payments-billing/payments-billing.providers.js';
import type { VnpayStatusGateway } from '../../../src/modules/payments-billing/application/vnpay.port.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';
import { createPayableBooking } from './deposit-fixture.js';
import { controlledVnpay, ipnFixture, queryFixture } from './vnpay-fixture.js';

const databaseDescribe = catalogMigrationDatabaseUrl ? describe : describe.skip;
databaseDescribe('PB-W4 verified VNPay with real Booking/Identity/PostgreSQL', () => {
  const database = new CatalogTestDatabase('billing_vnpay');
  beforeAll(async () => {
    await database.connect();
    await seedVenueCatalog(database.prisma);
  }, 60000);
  afterAll(async () => {
    await database.disconnect();
  });
  async function fixture(
    gateway: VnpayStatusGateway = {
      query: vi.fn(() => Promise.reject(new Error('controlled timeout'))),
    },
  ) {
    const booking = await createPayableBooking(database.prisma);
    const providers = createPaymentsBillingProviders(database.prisma, {
      vnpay: controlledVnpay,
      gateway,
    });
    const vnpay = providers.vnpay!;
    const checkout = await vnpay.startCheckout(booking.command, '127.0.0.1', booking.context);
    return { ...booking, providers, vnpay, gateway, checkout, id: checkout.attempt.id };
  }
  async function paid(bookingId: string) {
    return database.prisma.billingLedgerEntry.count({ where: { bookingId, kind: 'PAYMENT' } });
  }
  it('commits checkout before exposure; same command retains dates/IP/URL, ReturnURL has no money or access effect', async () => {
    const f = await fixture();
    expect(f.checkout.attempt.state).toBe('PENDING');
    expect(
      await database.prisma.billingVnpayCheckout.count({ where: { paymentAttemptId: f.id } }),
    ).toBe(1);
    expect(await f.vnpay.startCheckout(f.command, '192.0.2.2', f.context)).toEqual({
      ...f.checkout,
      replayed: true,
    });
    expect(f.vnpay.verifyReturnHint(ipnFixture(f.id)).outcome).toBe('SUCCEEDED');
    expect(await paid(f.bookingId)).toBe(0);
    expect(
      await database.prisma.billingProviderEvidence.count({ where: { paymentAttemptId: f.id } }),
    ).toBe(0);
    expect(
      (await database.prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } })).phase,
    ).toBe('AWAITING_DEPOSIT');
    await expect(f.vnpay.startCheckout(f.command, 'not-an-IP', f.context)).rejects.toThrow();
    await expect(f.vnpay.reconcile(f.bookingId, f.id, f.context)).rejects.toMatchObject({
      status: 403,
    });
    expect(
      createPaymentsBillingProviders(database.prisma, { vnpay: { enabled: false } }).vnpay,
    ).toBeNull();
  });
  it('rejects bad signatures/duplicate keys/foreign merchant, records amount mismatch, and recognizes unknown orders', async () => {
    const f = await fixture();
    const signed = ipnFixture(f.id);
    expect(await f.vnpay.processIpn(signed.replace('1500000000', '1500000001'))).toMatchObject({
      RspCode: '97',
    });
    expect(await f.vnpay.processIpn(`${signed}&vnp_%41mount=1`)).toMatchObject({ RspCode: '99' });
    expect(await f.vnpay.processIpn(ipnFixture(f.id, { vnp_TmnCode: 'OTHER001' }))).toMatchObject({
      RspCode: '99',
    });
    expect(await f.vnpay.processIpn(ipnFixture(randomUUID()))).toMatchObject({ RspCode: '01' });
    expect(await f.vnpay.processIpn(ipnFixture(f.id, { vnp_Amount: '100' }))).toMatchObject({
      RspCode: '04',
    });
    const foreignCurrency = ipnFixture(f.id, { vnp_CurrCode: 'USD' });
    expect(await f.vnpay.processIpn(foreignCurrency)).toMatchObject({ RspCode: '99' });
    expect(await f.vnpay.processIpn(foreignCurrency)).toMatchObject({ RspCode: '99' });
    expect(await paid(f.bookingId)).toBe(0);
    expect(
      await database.prisma.billingProviderEvidence.findMany({ where: { paymentAttemptId: f.id } }),
    ).toMatchObject([{ decision: 'AMOUNT_MISMATCH' }, { decision: 'CONFLICT' }]);
    expect(
      (await database.prisma.billingPaymentAttempt.findUniqueOrThrow({ where: { id: f.id } }))
        .state,
    ).toBe('PENDING');
  });
  it('serializes concurrent IPNs, promotes the reserved account once and quarantines changed/reordered evidence', async () => {
    const f = await fixture();
    const signed = ipnFixture(f.id);
    const transactionId = new URLSearchParams(signed).get('vnp_TransactionNo')!;
    const results = await Promise.all([f.vnpay.processIpn(signed), f.vnpay.processIpn(signed)]);
    expect(results.map((result) => result.RspCode).sort()).toEqual(['00', '02']);
    expect(await paid(f.bookingId)).toBe(1);
    expect(
      (
        await database.prisma.consultationAccess.findUniqueOrThrow({
          where: {
            accountId_consultationId: { accountId: f.accountId, consultationId: f.consultationId },
          },
        })
      ).level,
    ).toBe('FULL');
    expect(
      await database.prisma.billingProviderEvidence.count({ where: { paymentAttemptId: f.id } }),
    ).toBe(1);
    expect(await database.prisma.billingDepositApplication.count()).toBe(1);
    expect(
      await f.vnpay.processIpn(
        ipnFixture(f.id, {
          vnp_TransactionNo: transactionId,
          vnp_OrderInfo: 'Changed signed payload',
        }),
      ),
    ).toMatchObject({ RspCode: '99' });
    expect(
      await f.vnpay.processIpn(
        ipnFixture(f.id, {
          vnp_TransactionNo: transactionId,
          vnp_ResponseCode: '24',
          vnp_TransactionStatus: '02',
        }),
      ),
    ).toMatchObject({ RspCode: '99' });
    expect(await f.vnpay.processIpn(signed)).toMatchObject({ RspCode: '02' });
    expect(
      (await database.prisma.billingPaymentAttempt.findUniqueOrThrow({ where: { id: f.id } }))
        .state,
    ).toBe('SUCCEEDED');
    expect(await paid(f.bookingId)).toBe(1);
    expect(
      await database.prisma.billingOutboxEvent.count({
        where: { aggregateId: f.bookingId, eventType: 'billing.payment-succeeded' },
      }),
    ).toBe(1);
    const another = await fixture();
    expect(
      await another.vnpay.processIpn(
        ipnFixture(another.id, { vnp_TransactionNo: `0${transactionId}` }),
      ),
    ).toMatchObject({ RspCode: '99' });
    expect(await paid(another.bookingId)).toBe(0);
  });
  it('holds UNKNOWN through timeout/expiry and recovers from a signed querydr success without a second payment', async () => {
    const query = vi.fn<VnpayStatusGateway['query']>().mockRejectedValueOnce(new Error('timeout'));
    const f = await fixture({ query });
    expect(await f.vnpay.reconcile(f.bookingId, f.id, f.system)).toEqual({
      status: 'UNKNOWN',
      applicationStatus: null,
    });
    expect(
      (
        await database.prisma.bookingSlotHold.findFirstOrThrow({
          where: { bookingId: f.bookingId },
        })
      ).depositIntentPin,
    ).toBe('UNKNOWN');
    await expect(
      f.providers.deposits.createDeposit({ ...f.command, commandId: randomUUID() }, f.context),
    ).rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_ACTIVE' });
    const recoveredProof = queryFixture(f.id);
    query.mockResolvedValueOnce(recoveredProof);
    expect(await f.vnpay.reconcile(f.bookingId, f.id, f.system)).toEqual({
      status: 'SUCCEEDED',
      applicationStatus: 'SUCCEEDED',
    });
    const request = query.mock.calls[1]![0];
    const params = new URL(f.checkout.checkoutUrl).searchParams;
    expect(request.vnp_TransactionDate).toBe(params.get('vnp_CreateDate'));
    expect(request.vnp_TxnRef).toBe(f.id);
    const restarted = createPaymentsBillingProviders(database.prisma, {
      vnpay: controlledVnpay,
      gateway: { query },
    }).vnpay!;
    expect(await restarted.reconcile(f.bookingId, f.id, f.system)).toEqual({
      status: 'SUCCEEDED',
      applicationStatus: 'SUCCEEDED',
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(
      await restarted.processIpn(
        ipnFixture(f.id, { vnp_TransactionNo: recoveredProof.vnp_TransactionNo! }),
      ),
    ).toMatchObject({ RspCode: '02' });
    expect(await paid(f.bookingId)).toBe(1);
  });
  it('retains a successful IPN when the concurrent query times out after settlement', async () => {
    let releaseQuery!: () => void;
    let queryStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      queryStarted = resolve;
    });
    const delayed = new Promise<void>((resolve) => {
      releaseQuery = resolve;
    });
    const f = await fixture({
      query: async () => {
        queryStarted();
        await delayed;
        throw new Error('controlled timeout after IPN');
      },
    });
    const reconciliation = f.vnpay.reconcile(f.bookingId, f.id, f.system);
    await started;
    expect(await f.vnpay.processIpn(ipnFixture(f.id))).toMatchObject({ RspCode: '00' });
    releaseQuery();
    expect(await reconciliation).toEqual({ status: 'SUCCEEDED', applicationStatus: 'SUCCEEDED' });
    expect(await paid(f.bookingId)).toBe(1);
  });
  it('releases only signed IPN terminal failure and quarantines later contradictory success', async () => {
    const f = await fixture();
    const failure = ipnFixture(f.id, {
      vnp_TransactionNo: '0',
      vnp_ResponseCode: '24',
      vnp_TransactionStatus: '02',
      vnp_PayDate: undefined,
    });
    expect(await f.vnpay.processIpn(failure)).toMatchObject({ RspCode: '00' });
    expect(await f.vnpay.processIpn(failure)).toMatchObject({ RspCode: '02' });
    expect(await f.vnpay.processIpn(ipnFixture(f.id))).toMatchObject({ RspCode: '99' });
    expect(
      (await database.prisma.billingPaymentAttempt.findUniqueOrThrow({ where: { id: f.id } }))
        .state,
    ).toBe('FAILED');
    expect(await f.vnpay.reconcile(f.bookingId, f.id, f.system)).toEqual({
      status: 'FAILED',
      applicationStatus: null,
    });
    expect(await paid(f.bookingId)).toBe(0);
  });
  it('preserves true late money while an ineligible Booking application remains pending', async () => {
    const f = await fixture();
    await database.prisma.booking.update({
      where: { id: f.bookingId },
      data: { phase: 'CANCELLED' },
    });
    expect(await f.vnpay.processIpn(ipnFixture(f.id))).toMatchObject({ RspCode: '00' });
    expect(await f.vnpay.reconcile(f.bookingId, f.id, f.system)).toEqual({
      status: 'SUCCEEDED',
      applicationStatus: 'PENDING',
    });
    expect(await paid(f.bookingId)).toBe(1);
    expect((await f.providers.ledger.getLedger(f.bookingId)).totals.paidVnd).toBe(15_000_000);
    expect(
      (
        await database.prisma.consultationAccess.findUniqueOrThrow({
          where: {
            accountId_consultationId: { accountId: f.accountId, consultationId: f.consultationId },
          },
        })
      ).level,
    ).toBe('RESTRICTED');
  });
  it('does not invent provider proof for historical terminal attempts or expose unprepared checkout', async () => {
    const f = await fixture();
    await f.providers.ledger.transitionAttempt(
      {
        bookingId: f.bookingId,
        paymentAttemptId: f.id,
        evidence: 'VERIFIED_SUCCESS',
        providerEvidenceId: randomUUID(),
      },
      f.system,
    );
    expect(await f.vnpay.reconcile(f.bookingId, f.id, f.system)).toEqual({
      status: 'SUCCEEDED',
      applicationStatus: 'PENDING',
    });
    expect(await f.vnpay.processIpn(ipnFixture(f.id))).toMatchObject({ RspCode: '99' });
    expect(await paid(f.bookingId)).toBe(0);
    const b = await createPayableBooking(database.prisma);
    const p = createPaymentsBillingProviders(database.prisma, {
      vnpay: controlledVnpay,
      gateway: f.gateway,
    });
    const { attempt } = await p.deposits.createDeposit(b.command, b.context);
    await expect(p.vnpay!.reconcile(b.bookingId, attempt.id, b.system)).rejects.toMatchObject({
      status: 503,
    });
  });
  it.each([
    { vnp_ResponseCode: '91' },
    { vnp_TransactionStatus: '01' },
    { vnp_TransactionStatus: '04' },
    { vnp_SecureHash: 'invalid' },
    { vnp_TxnRef: randomUUID() },
    { vnp_TransactionType: '02' },
    { vnp_Amount: '100' },
  ])('keeps unresolved or conflicting query result UNKNOWN %j', async (changes) => {
    const query = vi.fn<VnpayStatusGateway['query']>();
    const f = await fixture({ query });
    query.mockResolvedValue(queryFixture(f.id, changes));
    expect(await f.vnpay.reconcile(f.bookingId, f.id, f.system)).toEqual({
      status: 'UNKNOWN',
      applicationStatus: null,
    });
    expect(await paid(f.bookingId)).toBe(0);
    expect(
      (
        await database.prisma.bookingDepositIntent.findUniqueOrThrow({
          where: { id: f.id },
        })
      ).status,
    ).toBe('UNKNOWN');
  });
  it('acknowledges signed UNKNOWN and resolves only verified terminal failure, allowing a replacement intent', async () => {
    const query = vi.fn<VnpayStatusGateway['query']>();
    const f = await fixture({ query });
    const unknown = ipnFixture(f.id, {
      vnp_TransactionNo: '0',
      vnp_TransactionStatus: '01',
      vnp_PayDate: undefined,
    });
    expect(await f.vnpay.processIpn(unknown)).toMatchObject({ RspCode: '00' });
    expect(await f.vnpay.processIpn(unknown)).toMatchObject({ RspCode: '02' });
    query.mockResolvedValue(
      queryFixture(f.id, {
        vnp_TransactionNo: '0',
        vnp_TransactionStatus: '02',
        vnp_PayDate: undefined,
      }),
    );
    expect(await f.vnpay.reconcile(f.bookingId, f.id, f.system)).toEqual({
      status: 'FAILED',
      applicationStatus: null,
    });
    expect(
      (await database.prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } })).phase,
    ).toBe('DRAFT');
    expect(
      (
        await database.prisma.bookingDepositIntent.findUniqueOrThrow({
          where: { id: f.id },
        })
      ).status,
    ).toBe('RELEASED');
    expect(await paid(f.bookingId)).toBe(0);
    expect(
      (
        await f.vnpay.startCheckout(
          { ...f.command, commandId: randomUUID() },
          '127.0.0.1',
          f.context,
        )
      ).attempt.id,
    ).not.toBe(f.id);
  });
  it('serializes a signed query success and IPN success for the same transaction', async () => {
    const query = vi.fn<VnpayStatusGateway['query']>();
    const f = await fixture({ query });
    const signed = ipnFixture(f.id);
    const txn = new URLSearchParams(signed).get('vnp_TransactionNo')!;
    query.mockResolvedValue(queryFixture(f.id, { vnp_TransactionNo: txn }));
    const results = await Promise.all([
      f.vnpay.reconcile(f.bookingId, f.id, f.system),
      f.vnpay.processIpn(signed),
    ]);
    expect(results[0]).toEqual({ status: 'SUCCEEDED', applicationStatus: 'SUCCEEDED' });
    expect(['00', '02']).toContain(results[1].RspCode);
    expect(await paid(f.bookingId)).toBe(1);
    expect(
      await database.prisma.billingProviderTransaction.count({ where: { transactionId: txn } }),
    ).toBe(1);
  });
  it('returns processing failure if proof cannot commit and recovers a durable success after money write failure', async () => {
    const f = await fixture();
    const signed = ipnFixture(f.id);
    await database.prisma.$executeRawUnsafe(
      `CREATE FUNCTION billing_w4_fault() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled W4 fault'; END; $$`,
    );
    await database.prisma.$executeRawUnsafe(
      `CREATE TRIGGER billing_w4_fault BEFORE INSERT ON "BillingProviderEvidence" FOR EACH ROW EXECUTE FUNCTION billing_w4_fault()`,
    );
    try {
      expect(await f.vnpay.processIpn(signed)).toMatchObject({ RspCode: '99' });
      expect(
        await database.prisma.billingProviderEvidence.count({ where: { paymentAttemptId: f.id } }),
      ).toBe(0);
      expect(
        (await database.prisma.billingPaymentAttempt.findUniqueOrThrow({ where: { id: f.id } }))
          .state,
      ).toBe('PENDING');
    } finally {
      await database.prisma.$executeRawUnsafe(
        `DROP TRIGGER billing_w4_fault ON "BillingProviderEvidence"`,
      );
    }
    await database.prisma.$executeRawUnsafe(
      `CREATE TRIGGER billing_w4_fault BEFORE INSERT ON "BillingLedgerEntry" FOR EACH ROW WHEN (NEW."kind" = 'PAYMENT') EXECUTE FUNCTION billing_w4_fault()`,
    );
    try {
      expect(await f.vnpay.processIpn(signed)).toMatchObject({ RspCode: '00' });
      expect(await paid(f.bookingId)).toBe(0);
      expect(
        (await database.prisma.billingPaymentAttempt.findUniqueOrThrow({ where: { id: f.id } }))
          .state,
      ).toBe('SUCCEEDED');
      expect(await f.vnpay.reconcile(f.bookingId, f.id, f.system)).toEqual({
        status: 'SUCCEEDED',
        applicationStatus: 'PENDING',
      });
    } finally {
      await database.prisma.$executeRawUnsafe(
        `DROP TRIGGER billing_w4_fault ON "BillingLedgerEntry"`,
      );
      await database.prisma.$executeRawUnsafe(`DROP FUNCTION billing_w4_fault()`);
    }
    expect(await f.vnpay.reconcile(f.bookingId, f.id, f.system)).toEqual({
      status: 'SUCCEEDED',
      applicationStatus: 'SUCCEEDED',
    });
    expect(await f.vnpay.processIpn(signed)).toMatchObject({ RspCode: '02' });
    expect(await paid(f.bookingId)).toBe(1);
  });
});
