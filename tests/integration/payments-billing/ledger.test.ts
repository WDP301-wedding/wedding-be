import { randomUUID } from 'node:crypto';

import { beforeAll, afterAll, describe, expect, it } from 'vitest';

import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';
import { createPrismaBillingPersistence } from '../../../src/modules/payments-billing/infrastructure/billing.persistence.js';
import { createBookingBoundaryUnitOfWork } from '../../../src/core/database/booking-unit-of-work.js';
import { createPrismaIdempotencyRepository } from '../../../src/core/idempotency/idempotency.repository.js';

const databaseDescribe = catalogMigrationDatabaseUrl ? describe : describe.skip;
const context = {
  requestId: randomUUID(),
  causationId: randomUUID(),
  actorAccountId: randomUUID(),
  authority: 'AUTHENTICATED' as const,
};
const timestamp = '2026-10-08T06:00:00.000Z';

databaseDescribe('PB-W2 ledger persistence on PostgreSQL', () => {
  const database = new CatalogTestDatabase('billing_ledger');
  let billing: ReturnType<typeof createPrismaBillingPersistence>;
  let scope: ReturnType<typeof createBookingBoundaryUnitOfWork>;

  beforeAll(async () => {
    await database.connect();
    scope = createBookingBoundaryUnitOfWork(database.prisma);
    billing = createPrismaBillingPersistence(database.prisma, scope);
  }, 60000);
  afterAll(async () => {
    await database.disconnect();
  });

  async function newBooking() {
    const bookingId = randomUUID();
    await database.prisma.consultation.create({
      data: {
        id: randomUUID(),
        managerAccountId: context.actorAccountId,
        intendedEmailNormalized: 'fixture@example.com',
        intendedEmail: 'fixture@example.com',
        displayName: 'Billing fixture',
        booking: {
          create: {
            id: bookingId,
            hallId: randomUUID(),
            eventDate: new Date('2026-12-01'),
            shiftCode: 'LUNCH',
            planningHeadcount: 100,
          },
        },
      },
    });
    return bookingId;
  }

  function charge(bookingId: string, amountVnd = 100_000) {
    return {
      id: randomUUID(),
      bookingId,
      kind: 'CHARGE' as const,
      sourceType: 'PRINT_ORDER' as const,
      sourceRevisionId: randomUUID(),
      amountVnd,
      occurredAt: timestamp,
      sourceEntryId: null,
      paymentAttemptId: null,
      decisionId: null,
      approvedRefundableVnd: null,
      reason: null,
      evidenceReference: null,
    };
  }

  async function payment(bookingId: string, amountVnd = 100_000) {
    const attempt = {
      id: randomUUID(),
      bookingId,
      commandId: randomUUID(),
      purpose: 'BALANCE' as const,
      provider: 'MANUAL' as const,
      amountVnd,
      timelineRevisionId: null,
      createdAt: timestamp,
      expiresAt: '2026-10-08T06:15:00.000Z',
    };
    await billing.repository.createAttempt(attempt, context);
    await billing.repository.transitionAttempt(
      {
        bookingId,
        paymentAttemptId: attempt.id,
        evidence: 'PROVIDER_REQUESTED',
        providerEvidenceId: null,
      },
      context,
    );
    await billing.repository.transitionAttempt(
      {
        bookingId,
        paymentAttemptId: attempt.id,
        evidence: 'VERIFIED_SUCCESS',
        providerEvidenceId: randomUUID(),
      },
      context,
    );
    return billing.repository.append(
      {
        ...charge(bookingId, amountVnd),
        kind: 'PAYMENT',
        sourceType: 'PAYMENT_ATTEMPT',
        sourceRevisionId: attempt.id,
        paymentAttemptId: attempt.id,
        reason: 'Verified manual evidence',
        evidenceReference: 'manual-fixture',
      },
      context,
    );
  }

  it('claims one accepted source under concurrent replay and writes one audit/outbox fact', async () => {
    const bookingId = await newBooking();
    const fact = charge(bookingId);
    const results = await Promise.all([
      billing.repository.append(fact, context),
      billing.repository.append({ ...fact, id: randomUUID() }, context),
    ]);
    expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
    expect(results[0].entry.id).toBe(results[1].entry.id);
    expect(await database.prisma.billingLedgerEntry.count({ where: { bookingId } })).toBe(1);
    expect(
      await database.prisma.billingOutboxEvent.count({ where: { aggregateId: bookingId } }),
    ).toBe(1);
    expect(await database.prisma.auditLog.count({ where: { entityId: results[0].entry.id } })).toBe(
      1,
    );
    await expect(
      billing.repository.append({ ...fact, amountVnd: 100_001 }, context),
    ).rejects.toMatchObject({ code: 'RECEIVABLE_SOURCE_CONFLICT' });
    await expect(
      billing.repository.append({ ...fact, occurredAt: '2026-10-08T06:01:00.000Z' }, context),
    ).rejects.toMatchObject({ code: 'RECEIVABLE_SOURCE_CONFLICT' });
    await expect(
      billing.repository.append({ ...fact, bookingId: await newBooking() }, context),
    ).rejects.toMatchObject({ code: 'RECEIVABLE_SOURCE_CONFLICT' });
  });

  it('rolls back ledger, revision, audit, outbox and owner changes together on failure', async () => {
    const bookingId = await newBooking();
    await expect(
      billing.boundary.run({ bookingId, context }, async (scoped) => {
        await billing.repository.append(charge(bookingId), scoped);
        await scope.withClient(bookingId, scoped, async (client) => {
          await client.booking.update({
            where: { id: bookingId },
            data: { planningHeadcount: 101 },
          });
          await createPrismaIdempotencyRepository(client).claim({
            namespace: 'billing-test',
            idempotencyKey: bookingId,
            requestHash: 'a'.repeat(64),
            lockedAt: new Date(timestamp),
            expiresAt: new Date('2026-10-09T06:00:00.000Z'),
          });
        });
        expect((await billing.repository.getLedger(bookingId, scoped)).revision).toBe(1);
        throw new Error('downstream owner failure');
      }),
    ).rejects.toThrow('downstream owner failure');
    expect((await billing.repository.getLedger(bookingId)).revision).toBe(0);
    expect(
      (await database.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } }))
        .planningHeadcount,
    ).toBe(100);
    expect(
      await database.prisma.idempotencyRecord.count({ where: { idempotencyKey: bookingId } }),
    ).toBe(0);
    expect(
      await database.prisma.billingOutboxEvent.count({ where: { aggregateId: bookingId } }),
    ).toBe(0);
    expect(
      await database.prisma.auditLog.count({
        where: { metadata: { path: ['bookingId'], equals: bookingId } },
      }),
    ).toBe(0);
  });

  it('keeps charge/payment/refund/credit facts immutable and derives exact safe totals', async () => {
    const bookingId = await newBooking();
    const accepted = await billing.repository.append(charge(bookingId), context);
    const settled = await payment(bookingId, 80_000);
    const credit = {
      ...charge(bookingId, 20_000),
      kind: 'CREDIT_ADJUSTMENT' as const,
      sourceType: 'PRINT_CREDIT' as const,
      sourceEntryId: accepted.entry.id,
      reason: 'PRINT_CANCELLED',
    };
    await billing.repository.append(credit, context);
    const refund = {
      ...charge(bookingId, 10_000),
      kind: 'REFUND' as const,
      sourceType: 'MANUAL_REFUND' as const,
      sourceEntryId: settled.entry.id,
      decisionId: randomUUID(),
      approvedRefundableVnd: 20_000,
      reason: 'Approved cancellation',
      evidenceReference: 'refund-fixture',
    };
    await billing.repository.append(refund, context);
    expect((await billing.repository.getLedger(bookingId)).totals).toEqual({
      acceptedChargesVnd: 80_000,
      paidVnd: 80_000,
      refundedVnd: 10_000,
      netPaidVnd: 70_000,
      outstandingVnd: 10_000,
      creditVnd: 0,
    });
    await expect(
      database.prisma.billingLedgerEntry.update({
        where: { id: accepted.entry.id },
        data: { amountVnd: 1 },
      }),
    ).rejects.toThrow();
    await expect(
      database.prisma.billingLedgerEntry.delete({ where: { id: settled.entry.id } }),
    ).rejects.toThrow();
    await expect(
      billing.repository.append(
        { ...refund, id: randomUUID(), sourceRevisionId: randomUUID(), amountVnd: 11_000 },
        context,
      ),
    ).rejects.toMatchObject({ code: 'BILLING_REFUND_LIMIT_EXCEEDED' });
  });

  it('persists attempt command replay, unknown state, unique unresolved purpose and terminal evidence', async () => {
    const bookingId = await newBooking();
    const attempt = {
      id: randomUUID(),
      bookingId,
      commandId: randomUUID(),
      purpose: 'BALANCE' as const,
      provider: 'VNPAY' as const,
      amountVnd: 100_000,
      timelineRevisionId: null,
      createdAt: timestamp,
      expiresAt: '2026-10-08T06:15:00.000Z',
    };
    expect((await billing.repository.createAttempt(attempt, context)).replayed).toBe(false);
    const pendingPayment = {
      ...charge(bookingId, attempt.amountVnd),
      kind: 'PAYMENT' as const,
      sourceType: 'PAYMENT_ATTEMPT' as const,
      sourceRevisionId: attempt.id,
      paymentAttemptId: attempt.id,
    };
    await expect(billing.repository.append(pendingPayment, context)).rejects.toMatchObject({
      code: 'PAYMENT_EVIDENCE_CONFLICT',
    });
    await expect(
      database.prisma.billingLedgerEntry.create({
        data: { ...pendingPayment, revision: 0, occurredAt: new Date(timestamp) },
      }),
    ).rejects.toThrow();
    expect(
      (await billing.repository.createAttempt({ ...attempt, id: randomUUID() }, context)).replayed,
    ).toBe(true);
    await expect(
      billing.repository.createAttempt({ ...attempt, amountVnd: 1 }, context),
    ).rejects.toMatchObject({ code: 'PAYMENT_EVIDENCE_CONFLICT' });
    await expect(
      billing.repository.createAttempt(
        { ...attempt, id: randomUUID(), commandId: randomUUID() },
        context,
      ),
    ).rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_ACTIVE' });
    const input = { bookingId, paymentAttemptId: attempt.id, providerEvidenceId: null };
    await billing.repository.transitionAttempt(
      { ...input, evidence: 'PROVIDER_REQUESTED' },
      context,
    );
    expect(
      (
        await billing.repository.transitionAttempt(
          { ...input, evidence: 'OUTCOME_UNKNOWN' },
          context,
        )
      ).state,
    ).toBe('UNKNOWN');
    const success = {
      ...input,
      evidence: 'VERIFIED_SUCCESS' as const,
      providerEvidenceId: randomUUID(),
    };
    expect((await billing.repository.transitionAttempt(success, context)).state).toBe('SUCCEEDED');
    await expect(
      billing.repository.append({ ...pendingPayment, amountVnd: 1 }, context),
    ).rejects.toMatchObject({ code: 'PAYMENT_EVIDENCE_CONFLICT' });
    expect((await billing.repository.transitionAttempt(success, context)).state).toBe('SUCCEEDED');
    await expect(
      billing.repository.transitionAttempt(
        { ...success, providerEvidenceId: randomUUID() },
        context,
      ),
    ).rejects.toMatchObject({ code: 'PAYMENT_EVIDENCE_CONFLICT' });
    await expect(
      database.prisma.billingPaymentAttempt.update({
        where: { id: attempt.id },
        data: { state: 'FAILED' },
      }),
    ).rejects.toThrow();
    await expect(
      database.prisma.billingPaymentAttempt.update({
        where: { id: attempt.id },
        data: { amountVnd: 1 },
      }),
    ).rejects.toThrow();
  });

  it('serializes two refunds against the same settlement and approved decision', async () => {
    const bookingId = await newBooking();
    const settled = await payment(bookingId);
    const refund = {
      ...charge(bookingId, 40_000),
      kind: 'REFUND' as const,
      sourceType: 'MANUAL_REFUND' as const,
      sourceEntryId: settled.entry.id,
      decisionId: randomUUID(),
      approvedRefundableVnd: 60_000,
      reason: 'Approved cancellation',
      evidenceReference: 'race-fixture',
    };
    const results = await Promise.allSettled([
      billing.repository.append(refund, context),
      billing.repository.append(
        { ...refund, id: randomUUID(), sourceRevisionId: randomUUID() },
        context,
      ),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejection = results.find((result) => result.status === 'rejected');
    expect(rejection?.status === 'rejected' ? rejection.reason : undefined).toMatchObject({
      code: 'BILLING_REFUND_LIMIT_EXCEEDED',
    });
    expect((await billing.repository.getLedger(bookingId)).totals.refundedVnd).toBe(40_000);
    expect(
      await database.prisma.billingOutboxEvent.count({
        where: { aggregateId: bookingId, eventType: 'billing.refund-recorded' },
      }),
    ).toBe(1);
  });

  it('guards SQL adjustment linkage, nullable evidence and immutable outbox payloads', async () => {
    const bookingId = await newBooking();
    const accepted = await billing.repository.append(charge(bookingId), context);
    const settled = await payment(bookingId);
    const rawFact = { ...charge(bookingId, 1), revision: 0, occurredAt: new Date(timestamp) };
    await expect(
      database.prisma.billingLedgerEntry.create({
        data: {
          ...rawFact,
          kind: 'CREDIT_ADJUSTMENT',
          sourceType: 'PRINT_CREDIT',
          sourceEntryId: accepted.entry.id,
          reason: null,
        },
      }),
    ).rejects.toThrow();
    await expect(
      database.prisma.billingLedgerEntry.create({
        data: {
          ...rawFact,
          kind: 'REFUND',
          sourceType: 'MANUAL_REFUND',
          sourceEntryId: settled.entry.id,
          decisionId: randomUUID(),
          approvedRefundableVnd: null,
          reason: 'reason',
          evidenceReference: 'evidence',
        },
      }),
    ).rejects.toThrow();
    await expect(
      database.prisma.billingLedgerEntry.create({
        data: {
          ...rawFact,
          bookingId: await newBooking(),
          kind: 'CREDIT_ADJUSTMENT',
          sourceType: 'PRINT_CREDIT',
          sourceEntryId: accepted.entry.id,
          reason: 'PRINT_CANCELLED',
        },
      }),
    ).rejects.toThrow();
    const event = await database.prisma.billingOutboxEvent.findFirstOrThrow({
      where: { ledgerEntryId: accepted.entry.id },
    });
    expect(event).toMatchObject({
      correlationId: context.requestId,
      causationId: context.causationId,
      eventVersion: 1,
    });
    expect(Object.keys(event.payload as object).sort()).toEqual(
      [
        'bookingId',
        'receivableChargeId',
        'sourceType',
        'sourceRevisionId',
        'amountVnd',
        'acceptedAt',
      ].sort(),
    );
    await expect(
      database.prisma.billingOutboxEvent.update({
        where: { id: event.id },
        data: { payload: { changed: true } },
      }),
    ).rejects.toThrow();
    await database.prisma.billingOutboxEvent.update({
      where: { id: event.id },
      data: { publishedAt: new Date(), attemptCount: 1 },
    });
    expect((await billing.repository.getLedger(bookingId)).revision).toBe(2);
  });

  it('reloads durable command results and keeps expired unknown attempts unresolved', async () => {
    const bookingId = await newBooking();
    const attempt = {
      id: randomUUID(),
      bookingId,
      commandId: randomUUID(),
      purpose: 'BALANCE' as const,
      provider: 'VNPAY' as const,
      amountVnd: 1,
      timelineRevisionId: null,
      createdAt: timestamp,
      expiresAt: '2026-10-08T06:15:00.000Z',
    };
    await billing.repository.createAttempt(attempt, context);
    await billing.repository.transitionAttempt(
      {
        bookingId,
        paymentAttemptId: attempt.id,
        evidence: 'PROVIDER_REQUESTED',
        providerEvidenceId: null,
      },
      context,
    );
    await billing.repository.transitionAttempt(
      {
        bookingId,
        paymentAttemptId: attempt.id,
        evidence: 'OUTCOME_UNKNOWN',
        providerEvidenceId: null,
      },
      context,
    );
    const restarted = createPrismaBillingPersistence(database.prisma).repository;
    expect((await restarted.getAttempt(bookingId, attempt.id)).state).toBe('UNKNOWN');
    expect((await restarted.createAttempt(attempt, context)).replayed).toBe(true);
    await expect(
      restarted.createAttempt(
        {
          ...attempt,
          id: randomUUID(),
          commandId: randomUUID(),
          createdAt: '2026-10-09T06:00:00.000Z',
          expiresAt: '2026-10-09T06:15:00.000Z',
        },
        context,
      ),
    ).rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_ACTIVE' });
    await expect(restarted.getAttempt(await newBooking(), attempt.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      database.prisma.billingPaymentAttempt.create({
        data: {
          ...attempt,
          id: randomUUID(),
          commandId: randomUUID(),
          purpose: 'DEPOSIT',
          timelineRevisionId: randomUUID(),
          state: 'SUCCEEDED',
          terminalEvidenceId: randomUUID(),
          createdAt: new Date(timestamp),
          expiresAt: new Date(attempt.expiresAt),
        },
      }),
    ).rejects.toThrow();
  });

  it('checks aggregate overflow and credit-source replay before appending another fact', async () => {
    const bookingId = await newBooking();
    const accepted = await billing.repository.append(
      charge(bookingId, Number.MAX_SAFE_INTEGER),
      context,
    );
    await expect(billing.repository.append(charge(bookingId, 1), context)).rejects.toMatchObject({
      code: 'BILLING_TOTAL_OVERFLOW',
    });
    await expect(
      database.prisma.billingLedgerEntry.create({
        data: { ...charge(bookingId, 1), revision: 0, occurredAt: new Date(timestamp) },
      }),
    ).rejects.toThrow();
    const credit = {
      ...charge(bookingId, 1),
      kind: 'CREDIT_ADJUSTMENT' as const,
      sourceType: 'PRINT_CREDIT' as const,
      sourceEntryId: accepted.entry.id,
      reason: 'PRINT_REPLACED',
    };
    expect((await billing.repository.append(credit, context)).replayed).toBe(false);
    expect(
      (await billing.repository.append({ ...credit, id: randomUUID() }, context)).replayed,
    ).toBe(true);
    await expect(
      billing.repository.append({ ...credit, reason: 'PRINT_CANCELLED' }, context),
    ).rejects.toMatchObject({ code: 'RECEIVABLE_ADJUSTMENT_CONFLICT' });
  });

  it('freezes invoice source revision and prevents direct SQL amount/adjustment corruption', async () => {
    const bookingId = await newBooking();
    const accepted = await billing.repository.append(charge(bookingId), context);
    const invoice = await billing.repository.issueInvoice(
      {
        id: randomUUID(),
        bookingId,
        invoiceNumber: `TEST-${randomUUID()}`,
        expectedBillingRevision: 1,
        issuedAt: timestamp,
      },
      context,
    );
    await billing.repository.append(charge(bookingId, 1), context);
    expect(invoice.sourceBillingRevision).toBe(1);
    expect(invoice.snapshot.totals.acceptedChargesVnd).toBe(100_000);
    const replay = await billing.repository.issueInvoice(
      {
        id: invoice.id,
        bookingId,
        invoiceNumber: invoice.invoiceNumber,
        expectedBillingRevision: invoice.sourceBillingRevision,
        issuedAt: timestamp,
      },
      context,
    );
    expect(replay.snapshot).toEqual(invoice.snapshot);
    expect(
      (await database.prisma.billingInvoice.findUniqueOrThrow({ where: { id: invoice.id } }))
        .snapshot,
    ).toEqual(invoice.snapshot);
    await expect(
      database.prisma.billingInvoice.update({
        where: { id: invoice.id },
        data: { sourceBillingRevision: 2 },
      }),
    ).rejects.toThrow();
    await expect(
      billing.repository.issueInvoice(
        {
          id: randomUUID(),
          bookingId,
          invoiceNumber: `TEST-${randomUUID()}`,
          expectedBillingRevision: 1,
          issuedAt: timestamp,
        },
        context,
      ),
    ).rejects.toMatchObject({ code: 'STALE_BILLING_REVISION' });
    for (const amountVnd of [0, -1, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(
        database.prisma.billingLedgerEntry.create({
          data: { ...charge(bookingId, amountVnd), revision: 0, occurredAt: new Date(timestamp) },
        }),
      ).rejects.toThrow();
    }
    await expect(
      database.prisma.billingLedgerEntry.create({
        data: {
          ...charge(bookingId, 1),
          kind: 'REFUND',
          sourceType: 'MANUAL_REFUND',
          sourceEntryId: accepted.entry.id,
          decisionId: randomUUID(),
          approvedRefundableVnd: 1,
          reason: 'reason',
          evidenceReference: 'evidence',
          revision: 0,
          occurredAt: new Date(timestamp),
        },
      }),
    ).rejects.toThrow();
  });
});
