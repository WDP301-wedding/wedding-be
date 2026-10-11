import { describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../../src/core/database/prisma.js';
import { seedVenueCatalog } from '../../../scripts/catalog-seed.js';
import { billingReportRowSchema } from '../../../src/modules/payments-billing/application/payments-billing.providers.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';
import { createPayableBooking } from './deposit-fixture.js';
import { legacyAttemptSelect, seedLegacyBillingHistory } from './upgrade-fixture.js';

const databaseDescribe = catalogMigrationDatabaseUrl ? describe : describe.skip;
databaseDescribe('W5 forward operations/reporting migration from W4', () => {
  it('backfills only safe reporting and preserves all historical money/proof/grants/audit/outbox', async () => {
    const database = new CatalogTestDatabase('billing_operations_upgrade');
    let historic = '';
    let bookingId = '';
    async function read(prisma: ReturnType<typeof createPrismaClient>) {
      return {
        ledger: await prisma.billingLedgerEntry.findMany({ orderBy: { id: 'asc' } }),
        attempts: await prisma.billingPaymentAttempt.findMany({
          orderBy: { id: 'asc' },
          select: legacyAttemptSelect,
        }),
        invoices: await prisma.billingInvoice.findMany({ orderBy: { id: 'asc' } }),
        applications: await prisma.billingDepositApplication.findMany(),
        checkouts: await prisma.billingVnpayCheckout.findMany(),
        evidence: await prisma.billingProviderEvidence.findMany(),
        claims: await prisma.billingProviderTransaction.findMany(),
        audit: await prisma.auditLog.findMany({ orderBy: { id: 'asc' } }),
        outbox: await prisma.billingOutboxEvent.findMany({ orderBy: { id: 'asc' } }),
        bookingOutbox: await prisma.bookingOutboxEvent.findMany({ orderBy: { id: 'asc' } }),
        bookings: await prisma.booking.findMany(),
        grants: await prisma.consultationAccess.findMany(),
        roles: await prisma.accountRole.findMany({ orderBy: { id: 'asc' } }),
      };
    }
    try {
      await database.connect(async (migration, url) => {
        if (migration !== '20261009001000_billing_operations_reporting') return;
        const prisma = createPrismaClient(url);
        try {
          await seedVenueCatalog(prisma);
          const f = await createPayableBooking(prisma);
          bookingId = f.bookingId;
          await seedLegacyBillingHistory(prisma, f, 'W4');
          historic = JSON.stringify(await read(prisma));
        } finally {
          await prisma.$disconnect();
        }
      });
      expect(JSON.stringify(await read(database.prisma))).toBe(historic);
      expect(await database.prisma.billingPaymentAttempt.findFirstOrThrow()).toMatchObject({
        contractRevisionId: null,
        documentDigest: null,
      });
      expect(await database.prisma.commercialContract.count()).toBe(0);
      expect(await database.prisma.billingOperationCommand.count()).toBe(0);
      expect(await database.prisma.billingRefundApproval.count()).toBe(0);
      const snapshots = await database.prisma.billingReportingSnapshot.findMany();
      expect(snapshots).toHaveLength(1);
      const report = billingReportRowSchema.parse(snapshots[0]!.value);
      expect(report).toMatchObject({
        bookingId,
        acceptedChargesVnd: 50_000_000,
        paidVnd: 15_000_000,
        refundedVnd: 0,
        outstandingVnd: 35_000_000,
        creditVnd: 0,
      });
      expect(report.ledger).toHaveLength(2);
      expect(JSON.stringify(report)).not.toMatch(/reason|evidenceReference|vnp_|Bank|Card/u);
    } finally {
      await database.disconnect();
    }
  }, 60000);
});
