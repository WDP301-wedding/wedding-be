import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { seedVenueCatalog } from '../../../scripts/catalog-seed.js';
import { createPrismaClient } from '../../../src/core/database/prisma.js';
import { createPrismaBillingPersistence } from '../../../src/modules/payments-billing/infrastructure/billing.persistence.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';
import { createPayableBooking } from './deposit-fixture.js';
import { mainBeforeBillingMigrations } from './upgrade-fixture.js';

const databaseDescribe = catalogMigrationDatabaseUrl ? describe : describe.skip;
databaseDescribe('PB-W3 forward application-state upgrade', () => {
  it('preserves W2 money, attempt, audit and outbox and keeps historical applications pending', async () => {
    const database = new CatalogTestDatabase('billing_application_upgrade');
    let paymentId = '';
    let bookingId = '';
    let historical = '';
    const context = {
      requestId: randomUUID(),
      causationId: randomUUID(),
      actorAccountId: null,
      authority: 'SYSTEM' as const,
    };
    async function read(prisma: ReturnType<typeof createPrismaClient>) {
      return {
        ledger: await prisma.billingLedgerEntry.findMany({ orderBy: { id: 'asc' } }),
        attempts: await prisma.billingPaymentAttempt.findMany({ orderBy: { id: 'asc' } }),
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
          const billing = createPrismaBillingPersistence(prisma);
          const createdAt = new Date().toISOString();
          const attempt = await billing.repository.createAttempt(
            {
              id: randomUUID(),
              bookingId,
              commandId: randomUUID(),
              purpose: 'DEPOSIT',
              provider: 'VNPAY',
              amountVnd: 15_000_000,
              timelineRevisionId: fixture.timelineRevisionId,
              createdAt,
              expiresAt: new Date(Date.parse(createdAt) + 900_000).toISOString(),
            },
            context,
          );
          const input = { bookingId, paymentAttemptId: attempt.attempt.id };
          await billing.repository.transitionAttempt(
            { ...input, evidence: 'PROVIDER_REQUESTED', providerEvidenceId: null },
            context,
          );
          await billing.repository.transitionAttempt(
            { ...input, evidence: 'VERIFIED_SUCCESS', providerEvidenceId: randomUUID() },
            context,
          );
          const payment = await billing.repository.append(
            {
              id: randomUUID(),
              bookingId,
              kind: 'PAYMENT',
              sourceType: 'PAYMENT_ATTEMPT',
              sourceRevisionId: attempt.attempt.id,
              amountVnd: 15_000_000,
              occurredAt: createdAt,
              sourceEntryId: null,
              paymentAttemptId: attempt.attempt.id,
              decisionId: null,
              approvedRefundableVnd: null,
              reason: null,
              evidenceReference: null,
            },
            context,
          );
          paymentId = payment.entry.id;
          historical = JSON.stringify(await read(prisma));
        } finally {
          await prisma.$disconnect();
        }
      }, mainBeforeBillingMigrations);
      expect(JSON.stringify(await read(database.prisma))).toBe(historical);
      expect(await database.prisma.billingDepositApplication.count()).toBe(0);
      expect(
        await createPrismaBillingPersistence(database.prisma).repository.isDepositApplied(
          bookingId,
          paymentId,
          context,
        ),
      ).toBe(false);
    } finally {
      await database.disconnect();
    }
  }, 60000);
});
