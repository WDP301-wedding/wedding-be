import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { seedVenueCatalog } from '../../../scripts/catalog-seed.js';
import { createPrismaClient } from '../../../src/core/database/prisma.js';
import { createPaymentsBillingProviders } from '../../../src/modules/payments-billing/payments-billing.providers.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';
import { createPayableBooking } from './deposit-fixture.js';
import { controlledVnpay } from './vnpay-fixture.js';
import { legacyAttemptSelect, seedLegacyBillingHistory } from './upgrade-fixture.js';

const databaseDescribe = catalogMigrationDatabaseUrl ? describe : describe.skip;
databaseDescribe('PB-W4 forward evidence upgrade', () => {
  it('preserves W3 settlement/application/audit/outbox without inventing historical provider proofs', async () => {
    const database = new CatalogTestDatabase('billing_vnpay_upgrade');
    let historical = '';
    let oldBookingId = '';
    let oldAttemptId = '';
    async function read(prisma: ReturnType<typeof createPrismaClient>) {
      return {
        ledger: await prisma.billingLedgerEntry.findMany(),
        attempts: await prisma.billingPaymentAttempt.findMany({ select: legacyAttemptSelect }),
        applications: await prisma.billingDepositApplication.findMany(),
        audit: await prisma.auditLog.findMany({ orderBy: { id: 'asc' } }),
        outbox: await prisma.billingOutboxEvent.findMany({ orderBy: { id: 'asc' } }),
        bookings: await prisma.booking.findMany(),
        grants: await prisma.consultationAccess.findMany(),
      };
    }
    try {
      await database.connect(async (migration, url) => {
        if (migration !== '20261008008000_vnpay_provider_evidence') return;
        const prisma = createPrismaClient(url);
        try {
          await seedVenueCatalog(prisma);
          const f = await createPayableBooking(prisma);
          const seeded = await seedLegacyBillingHistory(prisma, f, 'W3');
          oldBookingId = f.bookingId;
          oldAttemptId = seeded.attemptId;
          historical = JSON.stringify(await read(prisma));
        } finally {
          await prisma.$disconnect();
        }
      });
      expect(JSON.stringify(await read(database.prisma))).toBe(historical);
      expect(await database.prisma.billingPaymentAttempt.findFirstOrThrow()).toMatchObject({
        contractRevisionId: null,
        documentDigest: null,
      });
      expect(await database.prisma.commercialContract.count()).toBe(0);
      expect(await database.prisma.billingDepositApplication.count()).toBe(1);
      expect(await database.prisma.billingVnpayCheckout.count()).toBe(0);
      expect(await database.prisma.billingProviderEvidence.count()).toBe(0);
      expect(await database.prisma.billingProviderTransaction.count()).toBe(0);
      let queryCalls = 0;
      const upgraded = createPaymentsBillingProviders(database.prisma, {
        vnpay: controlledVnpay,
        gateway: {
          query: () => {
            queryCalls++;
            return Promise.reject(new Error('Historical completion must not query the provider.'));
          },
        },
      });
      expect(
        await upgraded.vnpay!.reconcile(oldBookingId, oldAttemptId, {
          requestId: randomUUID(),
          causationId: randomUUID(),
          actorAccountId: null,
          authority: 'SYSTEM',
        }),
      ).toEqual({ status: 'SUCCEEDED', applicationStatus: 'SUCCEEDED' });
      expect(queryCalls).toBe(0);
      expect(JSON.stringify(await read(database.prisma))).toBe(historical);
    } finally {
      await database.disconnect();
    }
  }, 60000);
});
