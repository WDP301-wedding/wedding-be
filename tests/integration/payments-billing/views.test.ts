import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';
import { createManualBillingFixture, seedBillingManager } from './operations-fixture.js';

const databaseDescribe = catalogMigrationDatabaseUrl ? describe : describe.skip;
databaseDescribe('W5 immutable invoice and receivable views', () => {
  const database = new CatalogTestDatabase('billing_views');
  beforeAll(async () => {
    await database.connect();
    await seedBillingManager(database.prisma);
  }, 60000);
  afterAll(async () => {
    await database.disconnect();
  });
  async function fixture() {
    const f = await createManualBillingFixture(database.prisma);
    const payment = await f.operations.recordManualPayment(f.deposit, f.manager);
    const print = {
      bookingId: f.bookingId,
      sourceType: 'PRINT_ORDER' as const,
      sourceRevisionId: randomUUID(),
      amountVnd: 4_000_001,
      acceptedAt: new Date('2026-10-08T16:01:00Z'),
    };
    const charge = await f.providers.charges.registerAcceptedCharge(print);
    await f.providers.charges.registerAcceptedCharge(print);
    const credit = await f.providers.charges.registerCredit(
      {
        bookingId: f.bookingId,
        receivableChargeId: charge.receivableChargeId,
        sourceAdjustmentId: randomUUID(),
        amountVnd: 1_000_001,
        reason: 'PRINT_REPLACED',
        acceptedAt: '2026-10-08T16:02:00Z',
      },
      f.system,
    );
    const decision = await f.operations.approveRefund(
      {
        bookingId: f.bookingId,
        commandId: randomUUID(),
        basis: { kind: 'CREDIT', sourceEntryId: credit.adjustmentId },
        approvedRefundableVnd: 1_000_001,
        reason: 'Sensitive approval',
        evidenceReference: 'PRIVATE-APPROVAL',
      },
      f.manager,
    );
    await f.operations.recordRefund(
      {
        bookingId: f.bookingId,
        commandId: randomUUID(),
        sourcePaymentId: payment.resourceId,
        decisionId: decision.resourceId,
        amountVnd: 1_000_001,
        expectedBillingRevision: 4,
        recordedAt: '2026-10-08T16:03:00Z',
        reason: 'Sensitive refund',
        evidenceReference: 'PRIVATE-REFUND',
      },
      f.manager,
    );
    return { ...f, payment, print, charge, credit };
  }
  it('paginates a fixed ledger revision with exact print/payment/refund/credit sources and redacted evidence', async () => {
    const f = await fixture();
    const first = await f.providers.views.read({ bookingId: f.bookingId, limit: 2 }, f.context);
    expect(first.billingRevision).toBe(5);
    expect(first.totals).toEqual({
      acceptedChargesVnd: 53_000_000,
      paidVnd: 15_000_000,
      refundedVnd: 1_000_001,
      netPaidVnd: 13_999_999,
      outstandingVnd: 39_000_001,
      creditVnd: 0,
    });
    await f.providers.charges.registerAcceptedCharge({
      ...f.print,
      sourceRevisionId: randomUUID(),
      amountVnd: 123,
    });
    const second = await f.providers.views.read(
      { bookingId: f.bookingId, limit: 2, cursor: first.nextCursor! },
      f.context,
    );
    const third = await f.providers.views.read(
      { bookingId: f.bookingId, limit: 2, cursor: second.nextCursor! },
      f.context,
    );
    expect(second.totals).toEqual(first.totals);
    const entries = [...first.history, ...second.history, ...third.history];
    expect(entries.map((e) => e.revision)).toEqual([1, 2, 3, 4, 5]);
    expect(entries.map((e) => e.kind)).toEqual([
      'CHARGE',
      'PAYMENT',
      'CHARGE',
      'CREDIT_ADJUSTMENT',
      'REFUND',
    ]);
    expect(entries[2]).toMatchObject({
      sourceType: 'PRINT_ORDER',
      sourceRevisionId: f.print.sourceRevisionId,
    });
    expect(entries[3]).toMatchObject({ sourceEntryId: f.charge.receivableChargeId });
    expect(entries[4]).toMatchObject({ sourceEntryId: f.payment.resourceId });
    expect(third.nextCursor).toBeNull();
    expect(JSON.stringify(entries)).not.toMatch(
      /Sensitive|PRIVATE-|reason|evidenceReference|approvedRefundableVnd/u,
    );
  });
  it('issues one frozen invoice, replays after new ledger facts, and never collects money', async () => {
    const f = await fixture();
    const command = { bookingId: f.bookingId, commandId: randomUUID(), expectedBillingRevision: 5 };
    const issued = await f.operations.issueInvoice(command, f.manager);
    const invoice = await f.providers.views.getInvoice(f.bookingId, issued.resourceId, f.context);
    expect(invoice).toMatchObject({
      invoiceNumber: `INV-${command.commandId}`,
      sourceBillingRevision: 5,
      totals: { outstandingVnd: 39_000_001 },
    });
    expect(invoice.history).toHaveLength(5);
    await f.providers.charges.registerAcceptedCharge({
      ...f.print,
      sourceRevisionId: randomUUID(),
      amountVnd: 99,
    });
    expect(await f.operations.issueInvoice(command, f.manager)).toEqual({
      ...issued,
      replayed: true,
    });
    expect(await f.providers.views.getInvoice(f.bookingId, issued.resourceId, f.context)).toEqual(
      invoice,
    );
    await expect(
      f.operations.issueInvoice({ ...command, expectedBillingRevision: 6 }, f.manager),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    await expect(
      f.operations.issueInvoice({ ...command, commandId: randomUUID() }, f.manager),
    ).rejects.toMatchObject({ code: 'STALE_BILLING_REVISION' });
    expect((await f.providers.ledger.getLedger(f.bookingId)).totals.paidVnd).toBe(15_000_000);
    expect(await database.prisma.billingInvoice.count({ where: { bookingId: f.bookingId } })).toBe(
      1,
    );
    expect(JSON.stringify(invoice)).not.toMatch(/Sensitive|PRIVATE-|reason|evidenceReference/u);
  });
  it('provides only authorized deposit proof and the four baseline receivable totals', async () => {
    const f = await fixture();
    const reader = f.providers.views.reader(f.context);
    expect(await reader.requireDepositSettlement(f.bookingId)).toEqual({
      paymentId: f.payment.resourceId,
      amountVnd: 15_000_000,
      settledAt: new Date(f.deposit.settledAt),
    });
    expect(await reader.getBookingReceivables(f.bookingId)).toEqual({
      acceptedChargesVnd: 53_000_000,
      paidVnd: 15_000_000,
      refundedVnd: 1_000_001,
      outstandingVnd: 39_000_001,
    });
    const other = await createManualBillingFixture(database.prisma);
    await expect(
      f.providers.views.read({ bookingId: f.bookingId, limit: 1 }, other.context),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      other.providers.views.read({ bookingId: other.bookingId, limit: 1 }, other.context),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      other.providers.views.reader(other.manager).requireDepositSettlement(other.bookingId),
    ).rejects.toMatchObject({ code: 'DEPOSIT_NOT_SETTLED' });
    await expect(
      f.providers.views.getInvoice(f.bookingId, randomUUID(), f.manager),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      f.providers.views.read({ bookingId: f.bookingId, limit: 1 }, f.system),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('publishes immutable redacted reporting pages with a fixed committed fence and current Manager authority', async () => {
    const f = await fixture();
    const counter = await database.prisma.billingReportingSequence.findUniqueOrThrow({
      where: { owner: 'billing' },
    });
    const afterSequence = counter.value - 5;
    const first = await f.providers.reporting.readPage({ afterSequence, limit: 2 }, f.manager);
    expect(first.throughSequence).toBe(counter.value);
    await f.providers.charges.registerAcceptedCharge({
      ...f.print,
      sourceRevisionId: randomUUID(),
      amountVnd: 10,
    });
    const second = await f.providers.reporting.readPage(
      {
        afterSequence,
        throughSequence: first.throughSequence,
        cursor: first.nextCursor!,
        limit: 500,
      },
      f.manager,
    );
    expect(second.rows).toHaveLength(3);
    expect(second.rows.at(-1)?.value).toMatchObject({
      bookingId: f.bookingId,
      acceptedChargesVnd: 53_000_000,
      paidVnd: 15_000_000,
      refundedVnd: 1_000_001,
      outstandingVnd: 39_000_001,
      creditVnd: 0,
    });
    expect(JSON.stringify(second)).not.toMatch(/Sensitive|PRIVATE-|reason|evidenceReference/u);
    await expect(
      f.providers.reporting.readPage({ afterSequence: 0, limit: 1 }, f.context),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      f.providers.reporting.readPage({ afterSequence: 0, limit: 1 }, f.system),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      f.providers.reporting.readPage(
        { afterSequence, throughSequence: first.throughSequence + 1000, limit: 1 },
        f.manager,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });
});
