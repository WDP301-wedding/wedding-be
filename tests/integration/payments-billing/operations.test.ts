import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedVenueCatalog, CATALOG_SEED_IDS } from '../../../scripts/catalog-seed.js';
import { createPaymentsBillingProviders } from '../../../src/modules/payments-billing/payments-billing.providers.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';
import { createPayableBooking } from './deposit-fixture.js';

const databaseDescribe = catalogMigrationDatabaseUrl ? describe : describe.skip;
databaseDescribe('W5 manual payments, balance races and approved refunds with real owners', () => {
  const database = new CatalogTestDatabase('billing_operations');
  beforeAll(async () => {
    await database.connect();
    await seedVenueCatalog(database.prisma);
    await database.prisma.account.create({
      data: {
        id: CATALOG_SEED_IDS.actor,
        emailNormalized: 'w5-manager@example.com',
        displayEmail: 'w5-manager@example.com',
        roles: { create: { role: 'MANAGER' } },
      },
    });
  }, 60000);
  afterAll(async () => {
    await database.disconnect();
  });
  async function fixture() {
    const f = await createPayableBooking(database.prisma);
    const providers = createPaymentsBillingProviders(database.prisma, {
      vnpay: { enabled: false },
    });
    const manager = { ...f.context, actorAccountId: CATALOG_SEED_IDS.actor };
    const deposit = {
      bookingId: f.bookingId,
      commandId: randomUUID(),
      purpose: 'DEPOSIT' as const,
      timelineRevisionId: f.timelineRevisionId,
      amountVnd: 15_000_000,
      settledAt: '2026-10-08T16:00:00Z',
      reason: 'Manager verified deposit receipt',
      evidenceReference: 'DEPOSIT-RECEIPT',
    };
    return { ...f, providers, manager, deposit, operations: providers.operations };
  }
  it('records a Manager manual deposit atomically, promotes the reserved account and replays exact evidence', async () => {
    const f = await fixture();
    await expect(f.operations.recordManualPayment(f.deposit, f.context)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const first = await f.operations.recordManualPayment(f.deposit, f.manager);
    expect(first.replayed).toBe(false);
    expect(await f.operations.recordManualPayment(f.deposit, f.manager)).toMatchObject({
      ...first,
      replayed: true,
    });
    await expect(
      f.operations.recordManualPayment({ ...f.deposit, reason: 'changed' }, f.manager),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect((await f.providers.ledger.getLedger(f.bookingId)).totals).toMatchObject({
      acceptedChargesVnd: 50_000_000,
      paidVnd: 15_000_000,
      outstandingVnd: 35_000_000,
    });
    expect(await database.prisma.booking.findUnique({ where: { id: f.bookingId } })).toMatchObject({
      phase: 'CONFIRMED',
    });
    expect(
      await database.prisma.consultationAccess.findUnique({
        where: {
          accountId_consultationId: { accountId: f.accountId, consultationId: f.consultationId },
        },
      }),
    ).toMatchObject({ level: 'FULL', sourcePaymentId: first.resourceId });
    expect(
      await database.prisma.billingDepositApplication.count({
        where: { paymentId: first.resourceId },
      }),
    ).toBe(1);
    expect(
      await database.prisma.billingOutboxEvent.count({
        where: { aggregateId: f.bookingId, eventType: 'billing.payment-succeeded' },
      }),
    ).toBe(1);
  });
  it('derives full outstanding balance and serializes two intents against manual collection', async () => {
    const f = await fixture();
    await f.operations.recordManualPayment(f.deposit, f.manager);
    const revision = (await f.providers.ledger.getLedger(f.bookingId)).revision;
    const input = {
      bookingId: f.bookingId,
      commandId: randomUUID(),
      expectedBillingRevision: revision,
    };
    const alternate = { ...input, commandId: randomUUID() };
    const results = await Promise.allSettled([
      f.operations.createBalance(input, f.context),
      f.operations.createBalance(alternate, f.context),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const first = await f.operations.createBalance(
      results[0].status === 'fulfilled' ? input : alternate,
      f.context,
    );
    expect(first.attempt.amountVnd).toBe(35_000_000);
    await expect(
      f.operations.recordManualPayment(
        {
          bookingId: f.bookingId,
          commandId: randomUUID(),
          purpose: 'BALANCE',
          amountVnd: 15_000_000,
          settledAt: f.deposit.settledAt,
          reason: f.deposit.reason,
          evidenceReference: f.deposit.evidenceReference,
          expectedBillingRevision: revision,
        },
        f.manager,
      ),
    ).rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_ACTIVE' });
    expect((await f.providers.ledger.getLedger(f.bookingId)).totals.paidVnd).toBe(15_000_000);
  });
  it('allows bounded partial manual balance, rejects overcollection and preserves replay after revision changes', async () => {
    const f = await fixture();
    await f.operations.recordManualPayment(f.deposit, f.manager);
    const input = {
      bookingId: f.bookingId,
      commandId: randomUUID(),
      purpose: 'BALANCE' as const,
      expectedBillingRevision: 2,
      amountVnd: 20_000_000,
      settledAt: '2026-10-08T16:01:00Z',
      reason: 'Verified balance receipt',
      evidenceReference: 'BALANCE-RECEIPT',
    };
    const first = await f.operations.recordManualPayment(input, f.manager);
    expect(await f.operations.recordManualPayment(input, f.manager)).toMatchObject({
      ...first,
      replayed: true,
    });
    await expect(
      f.operations.recordManualPayment(
        { ...input, commandId: randomUUID(), expectedBillingRevision: 3, amountVnd: 15_000_001 },
        f.manager,
      ),
    ).rejects.toMatchObject({ code: 'BILLING_BALANCE_LIMIT_EXCEEDED' });
    const race = {
      ...input,
      commandId: randomUUID(),
      expectedBillingRevision: 3,
      amountVnd: 15_000_000,
    };
    const results = await Promise.allSettled([
      f.operations.recordManualPayment(race, f.manager),
      f.operations.recordManualPayment({ ...race, commandId: randomUUID() }, f.manager),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await f.providers.ledger.getLedger(f.bookingId)).totals).toMatchObject({
      paidVnd: 50_000_000,
      outstandingVnd: 0,
      creditVnd: 0,
    });
  });
  it('locks source and recorded credit approval for two refunds, with no access demotion or audit evidence text', async () => {
    const f = await fixture();
    const payment = await f.operations.recordManualPayment(f.deposit, f.manager);
    const print = {
      bookingId: f.bookingId,
      sourceType: 'PRINT_ORDER' as const,
      sourceRevisionId: randomUUID(),
      amountVnd: 4_000_000,
      acceptedAt: new Date('2026-10-08T16:00:00Z'),
    };
    const charge = await f.providers.charges.registerAcceptedCharge(print);
    expect(await f.providers.charges.registerAcceptedCharge(print)).toEqual({
      ...charge,
      replayed: true,
    });
    const credit = await f.providers.charges.registerCredit(
      {
        bookingId: f.bookingId,
        receivableChargeId: charge.receivableChargeId,
        sourceAdjustmentId: randomUUID(),
        amountVnd: 4_000_000,
        reason: 'PRINT_CANCELLED',
        acceptedAt: '2026-10-08T16:02:00Z',
      },
      f.system,
    );
    const decision = await f.operations.approveRefund(
      {
        bookingId: f.bookingId,
        commandId: randomUUID(),
        basis: { kind: 'CREDIT', sourceEntryId: credit.adjustmentId },
        approvedRefundableVnd: 3_000_000,
        reason: 'Sensitive approved cancellation note',
        evidenceReference: 'PRIVATE-APPROVAL-REF',
      },
      f.manager,
    );
    const input = {
      bookingId: f.bookingId,
      commandId: randomUUID(),
      sourcePaymentId: payment.resourceId,
      decisionId: decision.resourceId,
      amountVnd: 2_000_000,
      expectedBillingRevision: 4,
      reason: 'Sensitive manual refund note',
      evidenceReference: 'PRIVATE-REFUND-REF',
      recordedAt: '2026-10-08T16:03:00Z',
    };
    const alternate = { ...input, commandId: randomUUID() };
    const results = await Promise.allSettled([
      f.operations.recordRefund(input, f.manager),
      f.operations.recordRefund(alternate, f.manager),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(
      await f.operations.recordRefund(
        results[0].status === 'fulfilled' ? input : alternate,
        f.manager,
      ),
    ).toMatchObject({ replayed: true });
    await expect(
      f.operations.recordRefund(
        { ...input, commandId: randomUUID(), expectedBillingRevision: 5 },
        f.manager,
      ),
    ).rejects.toMatchObject({ code: 'BILLING_REFUND_LIMIT_EXCEEDED' });
    expect((await f.providers.ledger.getLedger(f.bookingId)).totals).toMatchObject({
      acceptedChargesVnd: 50_000_000,
      paidVnd: 15_000_000,
      refundedVnd: 2_000_000,
      outstandingVnd: 37_000_000,
    });
    expect(
      await database.prisma.consultationAccess.findUnique({
        where: {
          accountId_consultationId: { accountId: f.accountId, consultationId: f.consultationId },
        },
      }),
    ).toMatchObject({ level: 'FULL' });
    const audit = JSON.stringify(
      await database.prisma.auditLog.findMany({ where: { entityType: 'billing' } }),
    );
    expect(audit).not.toContain('PRIVATE-');
    expect(audit).not.toContain('Sensitive');
  });
});
