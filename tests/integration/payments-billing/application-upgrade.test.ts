import { describe, expect, it } from 'vitest';

import { seedVenueCatalog } from '../../../scripts/catalog-seed.js';
import { createPrismaClient } from '../../../src/core/database/prisma.js';
import { createPrismaBillingPersistence } from '../../../src/modules/payments-billing/infrastructure/billing.persistence.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';
import { createPayableBooking } from './deposit-fixture.js';
import {
  mainBeforeBillingMigrations,
  legacyAttemptSelect,
  seedLegacyBillingHistory,
} from './upgrade-fixture.js';

const databaseDescribe = catalogMigrationDatabaseUrl ? describe : describe.skip;
databaseDescribe('PB-W3 forward application-state upgrade', () => {
  it('preserves W2 money, attempt, audit and outbox and keeps historical applications pending', async () => {
    const database = new CatalogTestDatabase('billing_application_upgrade');
    let paymentId = '';
    let bookingId = '';
    let historical = '';
    async function read(prisma: ReturnType<typeof createPrismaClient>) {
      return {
        ledger: await prisma.billingLedgerEntry.findMany({ orderBy: { id: 'asc' } }),
        attempts: await prisma.billingPaymentAttempt.findMany({
          orderBy: { id: 'asc' },
          select: legacyAttemptSelect,
        }),
        audit: await prisma.auditLog.findMany({ orderBy: { id: 'asc' } }),
        outbox: await prisma.billingOutboxEvent.findMany({ orderBy: { id: 'asc' } }),
      };
    }
    try {
      await database.connect(async (migration, url) => {
        if (migration !== '20261008007000_billing_deposit_application') return;
        const prisma = createPrismaClient(url);
        try {
          await seedVenueCatalog(prisma);
          const fixture = await createPayableBooking(prisma);
          bookingId = fixture.bookingId;
          paymentId = (await seedLegacyBillingHistory(prisma, fixture, 'W2')).paymentId;
          historical = JSON.stringify(await read(prisma));
        } finally {
          await prisma.$disconnect();
        }
      }, mainBeforeBillingMigrations);
      expect(JSON.stringify(await read(database.prisma))).toBe(historical);
      expect(await database.prisma.billingPaymentAttempt.findFirstOrThrow()).toMatchObject({
        contractRevisionId: null,
        documentDigest: null,
      });
      expect(await database.prisma.commercialContract.count()).toBe(0);
      expect(await database.prisma.billingDepositApplication.count()).toBe(0);
      expect(
        await createPrismaBillingPersistence(database.prisma).repository.isDepositApplied(
          bookingId,
          paymentId,
          {
            requestId: '00000000-0000-4000-8000-000000000001',
            causationId: '00000000-0000-4000-8000-000000000002',
            actorAccountId: null,
            authority: 'SYSTEM',
          },
        ),
      ).toBe(false);
    } finally {
      await database.disconnect();
    }
  }, 60000);
});
