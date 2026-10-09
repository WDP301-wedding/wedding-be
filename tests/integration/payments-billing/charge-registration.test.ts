import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createChargeRegistrationService } from '../../../src/modules/payments-billing/application/charge-registration.service.js';
import { createPrismaBillingPersistence } from '../../../src/modules/payments-billing/infrastructure/billing.persistence.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';

const databaseDescribe = catalogMigrationDatabaseUrl ? describe : describe.skip;
const context = {
  requestId: randomUUID(),
  causationId: randomUUID(),
  actorAccountId: null,
  authority: 'SYSTEM' as const,
};

databaseDescribe('PB-W3 real print charge/credit registrar conformance', () => {
  const database = new CatalogTestDatabase('billing_charges');
  let billing: ReturnType<typeof createPrismaBillingPersistence>;
  let registrar: ReturnType<typeof createChargeRegistrationService>;
  beforeAll(async () => {
    await database.connect();
    billing = createPrismaBillingPersistence(database.prisma);
    registrar = createChargeRegistrationService({
      ledger: billing.repository,
      context: () => context,
    });
  }, 60000);
  afterAll(async () => {
    await database.disconnect();
  });

  async function newBooking() {
    const bookingId = randomUUID();
    await database.prisma.consultation.create({
      data: {
        id: randomUUID(),
        managerAccountId: randomUUID(),
        intendedEmailNormalized: 'print@example.com',
        intendedEmail: 'print@example.com',
        displayName: 'Print Couple',
        booking: {
          create: {
            id: bookingId,
            hallId: randomUUID(),
            eventDate: new Date('2026-12-20'),
            shiftCode: 'LUNCH',
            planningHeadcount: 100,
          },
        },
      },
    });
    return bookingId;
  }

  it('registers PRN-006 once under concurrent delivery and rejects changed source identity', async () => {
    const bookingId = await newBooking();
    const input = {
      bookingId,
      sourceType: 'PRINT_ORDER' as const,
      sourceRevisionId: randomUUID(),
      amountVnd: 200_000,
      acceptedAt: new Date('2026-10-08T06:00:00Z'),
    };
    const results = await Promise.all([
      registrar.registerAcceptedCharge(input),
      registrar.registerAcceptedCharge(input),
    ]);
    expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
    expect(results[0].receivableChargeId).toBe(results[1].receivableChargeId);
    for (const changed of [
      { amountVnd: 200_001 },
      { acceptedAt: new Date('2026-10-08T06:00:01Z') },
      { bookingId: await newBooking() },
    ]) {
      await expect(
        registrar.registerAcceptedCharge({ ...input, ...changed }),
      ).rejects.toMatchObject({ code: 'RECEIVABLE_SOURCE_CONFLICT' });
    }
    expect(
      await database.prisma.billingOutboxEvent.count({ where: { aggregateId: bookingId } }),
    ).toBe(1);
    const invoice = await billing.repository.issueInvoice(
      {
        id: randomUUID(),
        bookingId,
        invoiceNumber: randomUUID(),
        expectedBillingRevision: 1,
        issuedAt: '2026-10-08T07:00:00Z',
      },
      context,
    );
    expect(invoice.snapshot.totals.acceptedChargesVnd).toBe(200_000);
    expect(invoice.snapshot.entries[0]!.sourceRevisionId).toBe(input.sourceRevisionId);
  });

  it('appends bounded cancellation/replacement credits by their decisions and rolls back owner failure', async () => {
    const bookingId = await newBooking();
    const { receivableChargeId } = await registrar.registerAcceptedCharge({
      bookingId,
      sourceType: 'PRINT_ORDER',
      sourceRevisionId: randomUUID(),
      amountVnd: 200_000,
      acceptedAt: new Date('2026-10-08T06:00:00Z'),
    });
    const input = {
      bookingId,
      receivableChargeId,
      sourceAdjustmentId: randomUUID(),
      amountVnd: 50_000,
      reason: 'PRINT_REPLACED' as const,
      acceptedAt: '2026-10-08T07:00:00Z',
    };
    const first = await registrar.registerCredit(input, context);
    expect(await registrar.registerCredit(input, context)).toEqual({ ...first, replayed: true });
    for (const changed of [
      { amountVnd: 50_001 },
      { acceptedAt: '2026-10-08T07:00:01Z' },
      { bookingId: await newBooking() },
      { receivableChargeId: randomUUID() },
    ]) {
      await expect(
        registrar.registerCredit({ ...input, ...changed }, context),
      ).rejects.toMatchObject({ code: 'RECEIVABLE_ADJUSTMENT_CONFLICT' });
    }
    await expect(
      registrar.registerCredit({ ...input, reason: 'PRINT_CANCELLED' }, context),
    ).rejects.toMatchObject({ code: 'RECEIVABLE_ADJUSTMENT_CONFLICT' });
    await expect(
      registrar.registerCredit(
        { ...input, sourceAdjustmentId: randomUUID(), amountVnd: 150_001 },
        context,
      ),
    ).rejects.toMatchObject({ code: 'RECEIVABLE_ADJUSTMENT_CONFLICT' });
    await expect(
      billing.boundary.run({ bookingId, context }, async (scoped) => {
        await registrar.registerCredit({ ...input, sourceAdjustmentId: randomUUID() }, scoped);
        throw new Error('print owner failed');
      }),
    ).rejects.toThrow('print owner failed');
    const snapshot = await billing.repository.getLedger(bookingId);
    expect(snapshot.revision).toBe(2);
    expect(snapshot.totals.acceptedChargesVnd).toBe(150_000);
    expect(snapshot.entries[1]!.sourceEntryId).toBe(receivableChargeId);
    expect(
      await database.prisma.billingOutboxEvent.count({ where: { aggregateId: bookingId } }),
    ).toBe(1);
  });
});
