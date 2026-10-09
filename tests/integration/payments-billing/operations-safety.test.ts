import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CATALOG_SEED_IDS } from '../../../scripts/catalog-seed.js';
import { createBookingLifecycleService } from '../../../src/modules/booking-lifecycle/application/lifecycle.service.js';
import { createPrismaBookingLifecycleRepository } from '../../../src/modules/booking-lifecycle/infrastructure/lifecycle.repository.js';
import {
  createConsultationAccessReader,
  createPrismaConsultationAccessRepository,
} from '../../../src/modules/identity-access/authorization/authorization.service.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';
import { createManualBillingFixture, seedBillingManager } from './operations-fixture.js';

const databaseDescribe = catalogMigrationDatabaseUrl ? describe : describe.skip;
databaseDescribe('W5 manual authority, rollback and independent refund caps', () => {
  const database = new CatalogTestDatabase('billing_operations_safety');
  beforeAll(async () => {
    await database.connect();
    await seedBillingManager(database.prisma);
  }, 60000);
  afterAll(async () => {
    await database.disconnect();
  });
  async function credited(amountVnd: number) {
    const f = await createManualBillingFixture(database.prisma);
    const payment = await f.operations.recordManualPayment(f.deposit, f.manager);
    const charge = await f.providers.charges.registerAcceptedCharge({
      bookingId: f.bookingId,
      sourceType: 'PRINT_ORDER',
      sourceRevisionId: randomUUID(),
      amountVnd,
      acceptedAt: new Date(),
    });
    const credit = await f.providers.charges.registerCredit(
      {
        bookingId: f.bookingId,
        receivableChargeId: charge.receivableChargeId,
        sourceAdjustmentId: randomUUID(),
        amountVnd,
        reason: 'PRINT_CANCELLED',
        acceptedAt: new Date().toISOString(),
      },
      f.system,
    );
    const approval = {
      bookingId: f.bookingId,
      commandId: randomUUID(),
      basis: { kind: 'CREDIT' as const, sourceEntryId: credit.adjustmentId },
      approvedRefundableVnd: amountVnd,
      reason: 'Sensitive approval',
      evidenceReference: 'PRIVATE-APPROVAL',
    };
    return { ...f, payment, credit, approval };
  }
  it('rolls back all money, owner promotion, roles, markers, audit and reporting when command persistence fails after settlement', async () => {
    const f = await createManualBillingFixture(database.prisma);
    const before = await database.prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
    const reports = await database.prisma.billingReportingSequence.findUniqueOrThrow({
      where: { owner: 'billing' },
    });
    await database.prisma.$executeRawUnsafe(
      "CREATE FUNCTION w5_command_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled final command failure'; END $$",
    );
    await database.prisma.$executeRawUnsafe(
      'CREATE TRIGGER w5_command_fault BEFORE INSERT ON "BillingOperationCommand" FOR EACH ROW EXECUTE FUNCTION w5_command_fault()',
    );
    try {
      await expect(f.operations.recordManualPayment(f.deposit, f.manager)).rejects.toThrow(
        'controlled final command failure',
      );
      expect(
        await database.prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } }),
      ).toEqual(before);
      expect(
        await database.prisma.consultationAccess.findUniqueOrThrow({
          where: {
            accountId_consultationId: { accountId: f.accountId, consultationId: f.consultationId },
          },
        }),
      ).toMatchObject({ level: 'RESTRICTED', sourcePaymentId: null });
      expect(await database.prisma.accountRole.count({ where: { accountId: f.accountId } })).toBe(
        0,
      );
      expect(
        await database.prisma.billingLedgerEntry.count({ where: { bookingId: f.bookingId } }),
      ).toBe(0);
      expect(
        await database.prisma.billingPaymentAttempt.count({ where: { bookingId: f.bookingId } }),
      ).toBe(0);
      expect(
        await database.prisma.bookingDepositIntent.count({ where: { bookingId: f.bookingId } }),
      ).toBe(0);
      expect(
        await database.prisma.billingOutboxEvent.count({ where: { aggregateId: f.bookingId } }),
      ).toBe(0);
      expect(
        await database.prisma.billingReportingSnapshot.count({ where: { bookingId: f.bookingId } }),
      ).toBe(0);
      expect(
        await database.prisma.billingOperationCommand.count({ where: { bookingId: f.bookingId } }),
      ).toBe(0);
      expect(
        await database.prisma.auditLog.count({ where: { requestId: f.manager.requestId } }),
      ).toBe(0);
      expect(
        await database.prisma.billingReportingSequence.findUniqueOrThrow({
          where: { owner: 'billing' },
        }),
      ).toEqual(reports);
    } finally {
      await database.prisma.$executeRawUnsafe(
        'DROP TRIGGER w5_command_fault ON "BillingOperationCommand"',
      );
      await database.prisma.$executeRawUnsafe('DROP FUNCTION w5_command_fault()');
    }
    expect(await f.operations.recordManualPayment(f.deposit, f.manager)).toMatchObject({
      replayed: false,
    });
    expect(await f.operations.recordManualPayment(f.deposit, f.manager)).toMatchObject({
      replayed: true,
    });
  });
  it('rejects wrong amount/timeline/current role and stale balance without persisting a command', async () => {
    const f = await createManualBillingFixture(database.prisma);
    await expect(
      f.operations.recordManualPayment({ ...f.deposit, amountVnd: 15_000_001 }, f.manager),
    ).rejects.toMatchObject({ code: 'DEPOSIT_NOT_ELIGIBLE' });
    await expect(
      f.operations.recordManualPayment(
        { ...f.deposit, timelineRevisionId: randomUUID() },
        f.manager,
      ),
    ).rejects.toThrow();
    await expect(f.operations.createBalance(f.balance, f.manager)).rejects.toMatchObject({
      code: 'BALANCE_NOT_ELIGIBLE',
    });
    await database.prisma.account.update({
      where: { id: CATALOG_SEED_IDS.actor },
      data: { status: 'DISABLED', disabledAt: new Date() },
    });
    try {
      await expect(f.operations.recordManualPayment(f.deposit, f.manager)).rejects.toMatchObject({
        status: 403,
      });
      await expect(
        f.providers.reporting.readPage({ afterSequence: 0, limit: 1 }, f.manager),
      ).rejects.toMatchObject({ status: 403 });
    } finally {
      await database.prisma.account.update({
        where: { id: CATALOG_SEED_IDS.actor },
        data: { status: 'ACTIVE', disabledAt: null },
      });
    }
    expect(
      await database.prisma.billingOperationCommand.count({ where: { bookingId: f.bookingId } }),
    ).toBe(0);
    await f.operations.recordManualPayment(f.deposit, f.manager);
    await expect(
      f.operations.createBalance({ ...f.balance, expectedBillingRevision: 1 }, f.context),
    ).rejects.toMatchObject({ code: 'STALE_BILLING_REVISION' });
    await expect(
      f.operations.applySettledBalance(
        { bookingId: f.bookingId, paymentAttemptId: randomUUID(), settledAt: f.deposit.settledAt },
        f.context,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      f.operations.applySettledBalance(
        {
          bookingId: f.bookingId,
          paymentAttemptId: (
            await database.prisma.billingPaymentAttempt.findFirstOrThrow({
              where: { bookingId: f.bookingId },
            })
          ).id,
          settledAt: f.deposit.settledAt,
        },
        f.system,
      ),
    ).rejects.toMatchObject({ code: 'PAYMENT_EVIDENCE_CONFLICT' });
  });
  it('serializes approval budgets across fresh keys and protects immutable decisions at SQL level', async () => {
    const f = await credited(4_000_000);
    const input = { ...f.approval, approvedRefundableVnd: 3_000_000 };
    const alternate = { ...input, commandId: randomUUID() };
    const results = await Promise.allSettled([
      f.operations.approveRefund(input, f.manager),
      f.operations.approveRefund(alternate, f.manager),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const winner = results[0].status === 'fulfilled' ? input : alternate;
    expect(await f.operations.approveRefund(winner, f.manager)).toMatchObject({ replayed: true });
    await expect(
      f.operations.approveRefund({ ...winner, reason: 'changed' }, f.manager),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    await expect(
      f.operations.approveRefund({ ...input, commandId: randomUUID() }, f.manager),
    ).rejects.toMatchObject({ code: 'BILLING_REFUND_LIMIT_EXCEEDED' });
    const row = await database.prisma.billingRefundApproval.findUniqueOrThrow({
      where: { id: winner.commandId },
    });
    await expect(
      database.prisma.billingRefundApproval.update({
        where: { id: row.id },
        data: { approvedRefundableVnd: 4_000_000 },
      }),
    ).rejects.toThrow();
    await expect(
      database.prisma.billingRefundApproval.delete({ where: { id: row.id } }),
    ).rejects.toThrow();
    await expect(
      database.prisma.billingRefundApproval.create({
        data: { ...row, id: randomUUID(), approvedRefundableVnd: 2_000_000 },
      }),
    ).rejects.toThrow();
    await expect(
      database.prisma.billingRefundApproval.create({
        data: {
          ...row,
          id: randomUUID(),
          approvedRefundableVnd: 1,
          approvedByAccountId: f.accountId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      f.operations.approveRefund(
        {
          ...input,
          commandId: randomUUID(),
          basis: { kind: 'CREDIT', sourceEntryId: f.payment.resourceId },
        },
        f.manager,
      ),
    ).rejects.toMatchObject({ code: 'PAYMENT_EVIDENCE_CONFLICT' });
  });
  it('checks the source remainder independently of a larger approved decision and conceals foreign decisions', async () => {
    const f = await credited(20_000_000);
    await f.operations.recordManualPayment(
      {
        bookingId: f.bookingId,
        commandId: randomUUID(),
        purpose: 'BALANCE',
        expectedBillingRevision: 4,
        amountVnd: 10_000_000,
        settledAt: f.deposit.settledAt,
        reason: 'Sensitive balance',
        evidenceReference: 'PRIVATE-BALANCE',
      },
      f.manager,
    );
    const approval = await f.operations.approveRefund(f.approval, f.manager);
    const command = {
      bookingId: f.bookingId,
      commandId: randomUUID(),
      sourcePaymentId: f.payment.resourceId,
      decisionId: approval.resourceId,
      amountVnd: 10_000_000,
      expectedBillingRevision: 5,
      recordedAt: f.deposit.settledAt,
      reason: 'Sensitive refund',
      evidenceReference: 'PRIVATE-REFUND',
    };
    await f.operations.recordRefund(command, f.manager);
    await expect(
      f.operations.recordRefund(
        { ...command, commandId: randomUUID(), expectedBillingRevision: 6, amountVnd: 5_000_001 },
        f.manager,
      ),
    ).rejects.toMatchObject({ code: 'BILLING_REFUND_LIMIT_EXCEEDED' });
    const other = await credited(1_000_000);
    await expect(
      other.operations.recordRefund(
        {
          ...command,
          bookingId: other.bookingId,
          commandId: randomUUID(),
          sourcePaymentId: other.payment.resourceId,
          expectedBillingRevision: 4,
        },
        other.manager,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      f.operations.recordRefund(
        {
          ...command,
          commandId: randomUUID(),
          sourcePaymentId: other.payment.resourceId,
          expectedBillingRevision: 6,
        },
        f.manager,
      ),
    ).rejects.toMatchObject({ code: 'PAYMENT_EVIDENCE_CONFLICT' });
    await expect(
      f.operations.recordRefund({ ...command, commandId: randomUUID() }, f.manager),
    ).rejects.toMatchObject({ code: 'STALE_BILLING_REVISION' });
    expect((await f.providers.ledger.getLedger(f.bookingId)).totals.refundedVnd).toBe(10_000_000);
  });
  it('requires an owned immutable cancelled Booking report, then allows an approved refund without access demotion', async () => {
    const f = await createManualBillingFixture(database.prisma);
    const payment = await f.operations.recordManualPayment(f.deposit, f.manager);
    const before = await database.prisma.bookingReportingSequence.findUniqueOrThrow({
      where: { owner: 'booking' },
    });
    const approval = {
      bookingId: f.bookingId,
      commandId: randomUUID(),
      basis: { kind: 'CANCELLATION' as const, sequence: before.value },
      approvedRefundableVnd: 15_000_000,
      reason: 'Sensitive cancellation approval',
      evidenceReference: 'PRIVATE-CANCELLATION',
    };
    await expect(f.operations.approveRefund(approval, f.manager)).rejects.toMatchObject({
      code: 'PAYMENT_EVIDENCE_CONFLICT',
    });
    const lifecycle = createBookingLifecycleService({
      repository: createPrismaBookingLifecycleRepository(database.prisma),
      access: createConsultationAccessReader(
        createPrismaConsultationAccessRepository(database.prisma),
      ),
    });
    const booking = await database.prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
    await lifecycle.cancel({
      bookingId: f.bookingId,
      expectedBookingRevision: booking.revision,
      reason: 'Recorded cancellation',
      actor: { accountId: f.manager.actorAccountId, roles: ['MANAGER'] },
      requestId: randomUUID(),
    });
    const cancelled = await database.prisma.bookingReportingSnapshot.findFirstOrThrow({
      where: { bookingId: f.bookingId },
      orderBy: { sequence: 'desc' },
    });
    const decision = await f.operations.approveRefund(
      { ...approval, basis: { kind: 'CANCELLATION', sequence: cancelled.sequence } },
      f.manager,
    );
    await f.operations.recordRefund(
      {
        bookingId: f.bookingId,
        commandId: randomUUID(),
        sourcePaymentId: payment.resourceId,
        decisionId: decision.resourceId,
        amountVnd: 15_000_000,
        expectedBillingRevision: 2,
        recordedAt: f.deposit.settledAt,
        reason: 'Approved manual cancellation refund',
        evidenceReference: 'CANCEL-REFUND',
      },
      f.manager,
    );
    expect((await f.providers.ledger.getLedger(f.bookingId)).totals).toMatchObject({
      paidVnd: 15_000_000,
      refundedVnd: 15_000_000,
      netPaidVnd: 0,
    });
    expect(
      await database.prisma.consultationAccess.findUniqueOrThrow({
        where: {
          accountId_consultationId: { accountId: f.accountId, consultationId: f.consultationId },
        },
      }),
    ).toMatchObject({ level: 'FULL' });
    await expect(
      f.operations.createBalance({ ...f.balance, expectedBillingRevision: 3 }, f.context),
    ).rejects.toMatchObject({ code: 'BALANCE_NOT_ELIGIBLE' });
  });
});
