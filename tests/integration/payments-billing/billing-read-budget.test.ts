import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';
import { createManualBillingFixture, seedBillingManager } from './operations-fixture.js';
import {
  newDatabaseDiagnostics,
  withDatabaseDiagnostics,
} from '../../../src/core/database/diagnostics.js';
import { AppError } from '../../../src/core/errors/app-error.js';

const describeDb = catalogMigrationDatabaseUrl ? describe : describe.skip;
describeDb('Billing read model bounded keyset pagination and aggregate totals', () => {
  const db = new CatalogTestDatabase('billing_read_budget');
  beforeAll(async () => {
    vi.stubEnv('DB_DIAGNOSTICS_ENABLED', 'true');
    await db.connect();
    await seedBillingManager(db.prisma);
  }, 60000);

  afterAll(async () => {
    try {
      await db.disconnect();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  const measure = async <T>(work: () => Promise<T>) => {
    const diagnostics = newDatabaseDiagnostics();
    const result = await withDatabaseDiagnostics(diagnostics, work);
    expect(diagnostics.queries).toBeGreaterThan(0);
    return { result, queries: diagnostics.queries };
  };

  it('paginates multi-page ledger with keyset cursor and keeps totals pinned to fence', async () => {
    const f = await createManualBillingFixture(db.prisma);
    // Base deposit payment (revision 1)
    await f.operations.recordManualPayment(f.deposit, f.manager);

    // Append 5 print orders and 2 credits and 1 refund to have 9 entries
    for (let i = 1; i <= 5; i++) {
      const charge = await f.providers.charges.registerAcceptedCharge({
        bookingId: f.bookingId,
        sourceType: 'PRINT_ORDER',
        sourceRevisionId: randomUUID(),
        amountVnd: 1_000_000 * i,
        acceptedAt: new Date(`2026-10-08T16:0${i}:00Z`),
      });

      if (i === 2 || i === 4) {
        await f.providers.charges.registerCredit(
          {
            bookingId: f.bookingId,
            receivableChargeId: charge.receivableChargeId,
            sourceAdjustmentId: randomUUID(),
            amountVnd: 500_000,
            reason: 'PRINT_REPLACED',
            acceptedAt: `2026-10-08T16:1${i}:00Z`,
          },
          f.system,
        );
      }
    }

    const initialHead = 9; // 1 base charge + 1 deposit + 5 prints + 2 credits = 9 entries

    // Page 1: limit 3
    const page1Measured = await measure(() =>
      f.providers.views.read({ bookingId: f.bookingId, limit: 3 }, f.manager),
    );
    const page1 = page1Measured.result;
    expect(page1.history).toHaveLength(3);
    expect(page1.history[0]!.revision).toBe(1);
    expect(page1.history[1]!.revision).toBe(2);
    expect(page1.history[2]!.revision).toBe(3);
    expect(page1.nextCursor).not.toBeNull();
    expect(page1.billingRevision).toBe(initialHead);

    // Page 2: limit 3 with cursor from page 1
    const page2 = await f.providers.views.read(
      { bookingId: f.bookingId, limit: 3, cursor: page1.nextCursor! },
      f.manager,
    );
    expect(page2.history).toHaveLength(3);
    expect(page2.history[0]!.revision).toBe(4);
    expect(page2.history[1]!.revision).toBe(5);
    expect(page2.history[2]!.revision).toBe(6);
    expect(page2.nextCursor).not.toBeNull();
    expect(page2.billingRevision).toBe(initialHead);

    // Page 3: limit 3 with cursor from page 2
    const page3 = await f.providers.views.read(
      { bookingId: f.bookingId, limit: 3, cursor: page2.nextCursor! },
      f.manager,
    );
    expect(page3.history).toHaveLength(3); // remaining 7, 8, 9
    expect(page3.history[0]!.revision).toBe(7);
    expect(page3.history[1]!.revision).toBe(8);
    expect(page3.history[2]!.revision).toBe(9);
    expect(page3.nextCursor).toBeNull();
    expect(page3.billingRevision).toBe(initialHead);

    // Append a new fact: revision 10
    await f.providers.charges.registerAcceptedCharge({
      bookingId: f.bookingId,
      sourceType: 'PRINT_ORDER',
      sourceRevisionId: randomUUID(),
      amountVnd: 2_500_000,
      acceptedAt: new Date('2026-10-08T16:20:00Z'),
    });

    // Re-reading page 2 with cursor pinned to initialHead (9)
    const page2Pinned = await f.providers.views.read(
      { bookingId: f.bookingId, limit: 3, cursor: page1.nextCursor! },
      f.manager,
    );
    expect(page2Pinned.history).toHaveLength(3);
    expect(page2Pinned.billingRevision).toBe(initialHead);
    expect(page2Pinned.totals).toEqual(page2.totals);
    // Revision 10 is NOT visible because throughBillingRevision is 9
    expect(page2Pinned.balancePaymentEligibility).toMatchObject({
      canPay: false,
      reasonCode: 'STALE_BILLING_REVISION',
      nextAction: 'REFRESH_BILLING',
      billingRevision: 10,
    });

    // Fresh read without cursor gets current head 10
    const freshRead = await f.providers.views.read(
      { bookingId: f.bookingId, limit: 10 },
      f.manager,
    );
    expect(freshRead.billingRevision).toBe(10);
    expect(freshRead.history).toHaveLength(10);
  });

  it('rejects invalid, mismatched, and out-of-bound cursors with VALIDATION_ERROR', async () => {
    const f = await createManualBillingFixture(db.prisma);
    await f.operations.recordManualPayment(f.deposit, f.manager);

    // Fixture has 2 entries (base charge + deposit payment); limit 2 covers all rows
    const validRead = await f.providers.views.read({ bookingId: f.bookingId, limit: 2 }, f.manager);
    expect(validRead.nextCursor).toBeNull();

    // Fabricate cursor with foreign bookingId
    const foreignCursor = Buffer.from(
      JSON.stringify({
        bookingId: randomUUID(),
        throughBillingRevision: 2,
        revision: 1,
      }),
    ).toString('base64url');

    await expect(
      f.providers.views.read(
        { bookingId: f.bookingId, limit: 1, cursor: foreignCursor },
        f.manager,
      ),
    ).rejects.toThrow(AppError);

    // Mismatched throughBillingRevision query vs cursor
    const cursorRev1 = Buffer.from(
      JSON.stringify({
        bookingId: f.bookingId,
        throughBillingRevision: 2,
        revision: 1,
      }),
    ).toString('base64url');

    await expect(
      f.providers.views.read(
        { bookingId: f.bookingId, limit: 1, cursor: cursorRev1, throughBillingRevision: 3 },
        f.manager,
      ),
    ).rejects.toMatchObject({ status: 422, code: 'VALIDATION_ERROR' });

    // Fence beyond head revision
    await expect(
      f.providers.views.read(
        { bookingId: f.bookingId, limit: 1, throughBillingRevision: 999 },
        f.manager,
      ),
    ).rejects.toMatchObject({ status: 422, code: 'VALIDATION_ERROR' });

    // Cursor revision beyond fence
    const overshootingCursor = Buffer.from(
      JSON.stringify({
        bookingId: f.bookingId,
        throughBillingRevision: 2,
        revision: 5,
      }),
    ).toString('base64url');

    await expect(
      f.providers.views.read(
        { bookingId: f.bookingId, limit: 1, cursor: overshootingCursor },
        f.manager,
      ),
    ).rejects.toMatchObject({ status: 422, code: 'VALIDATION_ERROR' });
  });

  it('returns exact receivables totals via reader projection without full ledger scan', async () => {
    const f = await createManualBillingFixture(db.prisma);
    await f.operations.recordManualPayment(f.deposit, f.manager);

    await f.providers.charges.registerAcceptedCharge({
      bookingId: f.bookingId,
      sourceType: 'PRINT_ORDER',
      sourceRevisionId: randomUUID(),
      amountVnd: 5_000_000,
      acceptedAt: new Date('2026-10-08T16:01:00Z'),
    });

    const receivables = await f.providers.views
      .reader(f.manager)
      .getBookingReceivables(f.bookingId);
    expect(receivables).toEqual({
      acceptedChargesVnd: 55_000_000,
      paidVnd: 15_000_000,
      refundedVnd: 0,
      outstandingVnd: 40_000_000,
    });

    // Also compare against full ledger getLedger() totals
    const fullLedger = await f.providers.ledger.getLedger(f.bookingId, f.manager);
    expect(receivables.acceptedChargesVnd).toBe(fullLedger.totals.acceptedChargesVnd);
    expect(receivables.paidVnd).toBe(fullLedger.totals.paidVnd);
    expect(receivables.refundedVnd).toBe(fullLedger.totals.refundedVnd);
    expect(receivables.outstandingVnd).toBe(fullLedger.totals.outstandingVnd);
  });

  it('guards integer VND and prevents overflow across database constraints and aggregate projection', async () => {
    const f = await createManualBillingFixture(db.prisma);
    await f.operations.recordManualPayment(f.deposit, f.manager);

    // Attempting to exceed MAX_SAFE_INTEGER is rejected by database trigger
    await expect(
      db.prisma.billingLedgerEntry
        .create({
          data: {
            id: randomUUID(),
            bookingId: f.bookingId,
            revision: 98,
            kind: 'CHARGE',
            sourceType: 'PRINT_ORDER',
            sourceRevisionId: randomUUID(),
            amountVnd: 5_000_000_000_000_000,
            occurredAt: new Date(),
          },
        })
        .then(() =>
          db.prisma.billingLedgerEntry.create({
            data: {
              id: randomUUID(),
              bookingId: f.bookingId,
              revision: 99,
              kind: 'CHARGE',
              sourceType: 'PRINT_ORDER',
              sourceRevisionId: randomUUID(),
              amountVnd: 5_000_000_000_000_000,
              occurredAt: new Date(),
            },
          }),
        ),
    ).rejects.toThrow(/safe VND/);

    // Existing valid receivables continue to be safely projected
    const receivables = await f.providers.views
      .reader(f.manager)
      .getBookingReceivables(f.bookingId);
    expect(receivables.acceptedChargesVnd).toBe(50_000_000 + 5_000_000_000_000_000);
    expect(receivables.paidVnd).toBe(15_000_000);
    expect(receivables.outstandingVnd).toBe(50_000_000 + 5_000_000_000_000_000 - 15_000_000);
  });

  it('enforces bounded query budget and bounded row transfer on a large ledger dataset', async () => {
    const f = await createManualBillingFixture(db.prisma);
    await f.operations.recordManualPayment(f.deposit, f.manager);

    // Seed 40 additional print charge entries to scale ledger to 42 entries total
    const entriesData = [];
    for (let i = 3; i <= 42; i++) {
      entriesData.push({
        id: randomUUID(),
        bookingId: f.bookingId,
        revision: i,
        kind: 'CHARGE' as const,
        sourceType: 'PRINT_ORDER' as const,
        sourceRevisionId: randomUUID(),
        amountVnd: 500_000,
        occurredAt: new Date(Date.now() + i * 1000),
      });
    }
    await db.prisma.billingLedgerEntry.createMany({ data: entriesData });

    // Assert total count in database is indeed 42
    const totalCount = await db.prisma.billingLedgerEntry.count({
      where: { bookingId: f.bookingId },
    });
    expect(totalCount).toBe(42);

    // Reading page with limit 5 must only fetch limit + 1 rows, never all 42 entries
    const page1Measured = await measure(() =>
      f.providers.views.read({ bookingId: f.bookingId, limit: 5 }, f.manager),
    );
    expect(page1Measured.queries).toBeLessThanOrEqual(14);
    expect(page1Measured.result.history).toHaveLength(5);
    expect(page1Measured.result.billingRevision).toBe(42);
    expect(page1Measured.result.nextCursor).not.toBeNull();

    // Receivables reader projection uses a single aggregate query without loading entries
    const receivablesMeasured = await measure(() =>
      f.providers.views.reader(f.manager).getBookingReceivables(f.bookingId),
    );
    expect(receivablesMeasured.queries).toBeLessThanOrEqual(10);
    expect(receivablesMeasured.result.acceptedChargesVnd).toBe(50_000_000 + 40 * 500_000);

    // Reading next page with cursor preserves query budget (<= 14 queries) and returns exactly 5 entries
    const page2Measured = await measure(() =>
      f.providers.views.read(
        { bookingId: f.bookingId, limit: 5, cursor: page1Measured.result.nextCursor! },
        f.manager,
      ),
    );
    expect(page2Measured.queries).toBe(page1Measured.queries);
    expect(page2Measured.result.history).toHaveLength(5);
    expect(page2Measured.result.history[0]!.revision).toBe(6);
    expect(page2Measured.result.history[4]!.revision).toBe(10);
  });
});
