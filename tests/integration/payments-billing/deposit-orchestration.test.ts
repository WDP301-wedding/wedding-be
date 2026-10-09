import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedVenueCatalog } from '../../../scripts/catalog-seed.js';
import { createPaymentsBillingProviders } from '../../../src/modules/payments-billing/payments-billing.providers.js';
import { createPrismaTimelineRepository } from '../../../src/modules/booking-lifecycle/infrastructure/timeline.repository.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';
import { createPayableBooking } from './deposit-fixture.js';

const databaseDescribe = catalogMigrationDatabaseUrl ? describe : describe.skip;
databaseDescribe('PB-W3 deposit with real Booking/Identity/PostgreSQL', () => {
  const database = new CatalogTestDatabase('billing_deposit');
  let providers: ReturnType<typeof createPaymentsBillingProviders>;
  beforeAll(async () => {
    await database.connect();
    await seedVenueCatalog(database.prisma);
    providers = createPaymentsBillingProviders(database.prisma);
  }, 60000);
  afterAll(async () => {
    await database.disconnect();
  });

  async function proven(fixture: Awaited<ReturnType<typeof createPayableBooking>>) {
    const created = await providers.deposits.createDeposit(fixture.command, fixture.context);
    const input = { bookingId: fixture.bookingId, paymentAttemptId: created.attempt.id };
    await providers.ledger.transitionAttempt(
      { ...input, evidence: 'PROVIDER_REQUESTED', providerEvidenceId: null },
      fixture.system,
    );
    await providers.ledger.transitionAttempt(
      { ...input, evidence: 'VERIFIED_SUCCESS', providerEvidenceId: randomUUID() },
      fixture.system,
    );
    return { ...input, settledAt: new Date().toISOString() };
  }

  it('persists one reservation/attempt/base charge and promotes the same restricted account once', async () => {
    const fixture = await createPayableBooking(database.prisma);
    const results = await Promise.all([
      providers.deposits.createDeposit(fixture.command, fixture.context),
      providers.deposits.createDeposit(fixture.command, fixture.context),
    ]);
    expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
    const attempt = results[0].attempt;
    expect(results[1].attempt.id).toBe(attempt.id);
    expect(attempt.amountVnd).toBe(15_000_000);
    expect(new Date(attempt.expiresAt).getTime() - new Date(attempt.createdAt).getTime()).toBe(
      900_000,
    );
    await expect(
      providers.deposits.createDeposit(
        { ...fixture.command, commandId: randomUUID() },
        fixture.context,
      ),
    ).rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_ACTIVE' });
    expect(
      await database.prisma.bookingDepositIntent.count({ where: { bookingId: fixture.bookingId } }),
    ).toBe(1);
    expect(
      (
        await database.prisma.bookingSlotHold.findFirstOrThrow({
          where: { bookingId: fixture.bookingId },
        })
      ).depositIntentPin,
    ).toBe('ACTIVE');
    await expect(
      providers.deposits.applySettledDeposit(
        {
          bookingId: fixture.bookingId,
          paymentAttemptId: attempt.id,
          settledAt: new Date().toISOString(),
        },
        fixture.system,
      ),
    ).rejects.toMatchObject({ code: 'PAYMENT_EVIDENCE_CONFLICT' });
    const input = await proven(fixture);
    const applied = await providers.deposits.applySettledDeposit(input, fixture.system);
    expect(applied.applicationStatus).toBe('SUCCEEDED');
    const restarted = createPaymentsBillingProviders(database.prisma);
    expect(await restarted.deposits.applySettledDeposit(input, fixture.system)).toEqual({
      ...applied,
      replayed: true,
    });
    expect(
      (await database.prisma.booking.findUniqueOrThrow({ where: { id: fixture.bookingId } })).phase,
    ).toBe('CONFIRMED');
    expect(
      await database.prisma.consultationAccess.findUniqueOrThrow({
        where: {
          accountId_consultationId: {
            accountId: fixture.accountId,
            consultationId: fixture.consultationId,
          },
        },
      }),
    ).toMatchObject({ level: 'FULL', sourcePaymentId: applied.paymentId });
    expect(
      await database.prisma.accountRole.count({
        where: { accountId: fixture.accountId, role: 'COUPLE' },
      }),
    ).toBe(1);
    const ledger = await providers.ledger.getLedger(fixture.bookingId);
    expect(ledger.entries).toHaveLength(2);
    expect(ledger.totals).toMatchObject({
      acceptedChargesVnd: 50_000_000,
      paidVnd: 15_000_000,
      outstandingVnd: 35_000_000,
    });
    expect(
      await database.prisma.billingOutboxEvent.count({
        where: { aggregateId: fixture.bookingId, eventType: 'billing.payment-succeeded' },
      }),
    ).toBe(1);
    expect(await providers.deposits.createDeposit(fixture.command, fixture.context)).toMatchObject({
      replayed: true,
    });
    await expect(
      providers.deposits.applySettledDeposit(
        { ...input, settledAt: new Date(Date.parse(input.settledAt) + 1).toISOString() },
        fixture.system,
      ),
    ).rejects.toMatchObject({ code: 'PAYMENT_EVIDENCE_CONFLICT' });
  });

  it('rolls back reservation/attempt/base/audit on reservation failure and conceals unowned access', async () => {
    const fixture = await createPayableBooking(database.prisma);
    await expect(
      providers.deposits.createDeposit(fixture.command, {
        ...fixture.context,
        actorAccountId: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 404 });
    await database.prisma.$executeRawUnsafe(
      `CREATE FUNCTION pbw3_fail_reservation() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'reservation unavailable'; END; $$`,
    );
    await database.prisma.$executeRawUnsafe(
      'CREATE TRIGGER pbw3_fail_reservation BEFORE INSERT ON "BookingDepositIntent" FOR EACH ROW EXECUTE FUNCTION pbw3_fail_reservation()',
    );
    try {
      await expect(
        providers.deposits.createDeposit(fixture.command, fixture.context),
      ).rejects.toThrow('reservation unavailable');
    } finally {
      await database.prisma.$executeRawUnsafe(
        'DROP TRIGGER pbw3_fail_reservation ON "BookingDepositIntent"',
      );
      await database.prisma.$executeRawUnsafe('DROP FUNCTION pbw3_fail_reservation()');
    }
    expect(
      await database.prisma.billingPaymentAttempt.count({
        where: { bookingId: fixture.bookingId },
      }),
    ).toBe(0);
    expect(
      await database.prisma.billingLedgerEntry.count({ where: { bookingId: fixture.bookingId } }),
    ).toBe(0);
    expect(
      await database.prisma.auditLog.count({ where: { requestId: fixture.context.requestId } }),
    ).toBe(0);
    expect(
      (await database.prisma.booking.findUniqueOrThrow({ where: { id: fixture.bookingId } })).phase,
    ).toBe('DRAFT');
  });

  it('admits only one of two concurrent distinct deposit commands', async () => {
    const fixture = await createPayableBooking(database.prisma);
    const outcomes = await Promise.allSettled([
      providers.deposits.createDeposit(fixture.command, fixture.context),
      providers.deposits.createDeposit(
        { ...fixture.command, commandId: randomUUID() },
        fixture.context,
      ),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === 'rejected')).toMatchObject({
      reason: { code: 'PAYMENT_ATTEMPT_ACTIVE' },
    });
    expect(
      await database.prisma.billingPaymentAttempt.count({
        where: { bookingId: fixture.bookingId },
      }),
    ).toBe(1);
    expect(
      await database.prisma.bookingDepositIntent.count({ where: { bookingId: fixture.bookingId } }),
    ).toBe(1);
    expect(
      await database.prisma.billingLedgerEntry.count({ where: { bookingId: fixture.bookingId } }),
    ).toBe(1);
  });

  it('retains money across a failure after real promotion, rolls back every owner effect and recovers after restart', async () => {
    const fixture = await createPayableBooking(database.prisma);
    const input = await proven(fixture);
    await database.prisma.$executeRawUnsafe(
      `CREATE FUNCTION pbw3_fail_application() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'application crash after promotion'; END; $$`,
    );
    await database.prisma.$executeRawUnsafe(
      'CREATE TRIGGER pbw3_fail_application BEFORE INSERT ON "BillingDepositApplication" FOR EACH ROW EXECUTE FUNCTION pbw3_fail_application()',
    );
    let pending: Awaited<ReturnType<typeof providers.deposits.applySettledDeposit>>;
    try {
      pending = await providers.deposits.applySettledDeposit(input, fixture.system);
    } finally {
      await database.prisma.$executeRawUnsafe(
        'DROP TRIGGER pbw3_fail_application ON "BillingDepositApplication"',
      );
      await database.prisma.$executeRawUnsafe('DROP FUNCTION pbw3_fail_application()');
    }
    expect(pending.applicationStatus).toBe('PENDING');
    expect(
      await database.prisma.billingLedgerEntry.count({
        where: { bookingId: fixture.bookingId, kind: 'PAYMENT' },
      }),
    ).toBe(1);
    expect(
      await database.prisma.bookingDepositSettlement.count({
        where: { paymentId: pending.paymentId },
      }),
    ).toBe(0);
    expect(
      (await database.prisma.booking.findUniqueOrThrow({ where: { id: fixture.bookingId } })).phase,
    ).toBe('AWAITING_DEPOSIT');
    expect(
      (
        await database.prisma.consultationAccess.findFirstOrThrow({
          where: { accountId: fixture.accountId },
        })
      ).level,
    ).toBe('RESTRICTED');
    expect(
      await database.prisma.accountRole.count({ where: { accountId: fixture.accountId } }),
    ).toBe(0);
    expect(
      await database.prisma.billingDepositApplication.count({
        where: { paymentId: pending.paymentId },
      }),
    ).toBe(0);
    expect(
      await database.prisma.bookingOutboxEvent.count({
        where: { aggregateId: fixture.bookingId, eventType: 'booking.deposit-recorded' },
      }),
    ).toBe(0);
    const restarted = createPaymentsBillingProviders(database.prisma);
    const outcomes = await Promise.all([
      restarted.deposits.applySettledDeposit(input, fixture.system),
      restarted.deposits.applySettledDeposit(input, fixture.system),
    ]);
    expect(
      outcomes.every(
        (outcome) =>
          outcome.applicationStatus === 'SUCCEEDED' && outcome.paymentId === pending.paymentId,
      ),
    ).toBe(true);
    expect(
      await database.prisma.bookingDepositSettlement.count({
        where: { paymentId: pending.paymentId },
      }),
    ).toBe(1);
    expect(
      await database.prisma.billingDepositApplication.count({
        where: { paymentId: pending.paymentId },
      }),
    ).toBe(1);
    expect(
      await database.prisma.billingOutboxEvent.count({
        where: { aggregateId: fixture.bookingId, eventType: 'billing.payment-succeeded' },
      }),
    ).toBe(1);
    expect(
      await database.prisma.auditLog.count({
        where: { entityId: pending.paymentId, action: 'billing.deposit-applied' },
      }),
    ).toBe(1);
  });

  it('retains late true money for reconciliation when the current booking is no longer payable', async () => {
    const fixture = await createPayableBooking(database.prisma);
    const input = await proven(fixture);
    await database.prisma.booking.update({
      where: { id: fixture.bookingId },
      data: { phase: 'CANCELLED' },
    });
    const result = await providers.deposits.applySettledDeposit(input, fixture.system);
    expect(result).toMatchObject({
      applicationStatus: 'PENDING',
    });
    expect((await providers.ledger.getLedger(fixture.bookingId)).totals.paidVnd).toBe(15_000_000);
    expect(
      (
        await database.prisma.consultationAccess.findFirstOrThrow({
          where: { accountId: fixture.accountId },
        })
      ).level,
    ).toBe('RESTRICTED');
    expect(
      await database.prisma.billingDepositApplication.count({
        where: { paymentId: result.paymentId },
      }),
    ).toBe(0);
  });

  it('serializes an invalidating timeline edit against deposit creation, leaving exactly one outcome', async () => {
    const fixture = await createPayableBooking(database.prisma);
    const timelines = createPrismaTimelineRepository(database.prisma);
    const revisionId = randomUUID();
    const outcomes = await Promise.allSettled([
      providers.deposits.createDeposit(fixture.command, fixture.context),
      timelines.save({
        revision: {
          revisionId,
          bookingId: fixture.bookingId,
          revisionNumber: 2,
          predecessorRevisionId: fixture.timelineRevisionId,
          state: 'CURRENT',
          managerApprovedAt: null,
          coupleApprovedAt: null,
          mutuallyApproved: false,
          createdAt: new Date(),
          items: [
            {
              itemId: randomUUID(),
              order: 0,
              startTime: '18:15',
              title: 'Changed',
              description: null,
            },
          ],
        },
        expectedBookingRevision: 1,
        actorAccountId: randomUUID(),
        party: 'MANAGER',
        requestId: randomUUID(),
      }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const current = await database.prisma.booking.findUniqueOrThrow({
      where: { id: fixture.bookingId },
    });
    const attempts = await database.prisma.billingPaymentAttempt.count({
      where: { bookingId: fixture.bookingId },
    });
    if (current.currentTimelineRevisionId === revisionId) {
      expect(attempts).toBe(0);
      await expect(
        providers.deposits.createDeposit(fixture.command, fixture.context),
      ).rejects.toMatchObject({ code: 'DEPOSIT_NOT_ELIGIBLE' });
    } else {
      expect(attempts).toBe(1);
      expect(current.phase).toBe('AWAITING_DEPOSIT');
    }
  });
});
