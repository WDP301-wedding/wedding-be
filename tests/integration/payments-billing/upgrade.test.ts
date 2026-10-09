import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { seedVenueCatalog, CATALOG_SEED_IDS } from '../../../scripts/catalog-seed.js';
import { createPrismaClient } from '../../../src/core/database/prisma.js';
import { mainBeforeBillingMigrations } from './upgrade-fixture.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';

const databaseDescribe = catalogMigrationDatabaseUrl ? describe : describe.skip;

databaseDescribe('PB-W2 forward migration over the current Booking baseline', () => {
  it('preserves existing commercial history, audit, outbox and idempotency without inventing billing facts', async () => {
    const database = new CatalogTestDatabase('billing_upgrade');
    const bookingId = randomUUID(),
      auditId = randomUUID(),
      eventId = randomUUID(),
      commandId = randomUUID(),
      managerId = randomUUID();
    let historical: string | undefined;
    try {
      await database.connect(async (migration, url) => {
        if (migration !== '20261008006000_payments_billing_ledger') return;
        const prisma = createPrismaClient(url);
        try {
          await seedVenueCatalog(prisma);
          await prisma.consultation.create({
            data: {
              id: randomUUID(),
              managerAccountId: managerId,
              intendedEmailNormalized: 'history@example.com',
              intendedEmail: 'history@example.com',
              displayName: 'Historic couple',
              booking: {
                create: {
                  id: bookingId,
                  hallId: CATALOG_SEED_IDS.lotusHall,
                  eventDate: new Date('2026-12-20'),
                  shiftCode: 'DINNER',
                  phase: 'CONFIRMED',
                  revision: 9,
                  planningHeadcount: 100,
                  proposalSnapshot: {
                    create: {
                      id: randomUUID(),
                      hallId: CATALOG_SEED_IDS.lotusHall,
                      hallName: 'Historic hall',
                      hallDescription: 'Original',
                      hallMaxGuests: 100,
                      shiftCode: 'DINNER',
                      shiftStartTime: new Date('1970-01-01T18:00:00Z'),
                      shiftEndTime: new Date('1970-01-01T22:00:00Z'),
                      menuPackageId: CATALOG_SEED_IDS.classicMenu,
                      menuPackageVersionId: CATALOG_SEED_IDS.classicMenuVersion,
                      menuVersionNumber: 1,
                      menuName: 'Historic menu',
                      menuDescription: 'Original',
                      menuPriceVndPerTable: 3_500_000,
                      tableCount: 10,
                      planningHeadcount: 100,
                      baseChargeVnd: 35_000_000,
                      depositAmountVnd: 10_500_000,
                    },
                  },
                },
              },
            },
          });
          await prisma.auditLog.create({
            data: {
              id: auditId,
              requestId: randomUUID(),
              actorType: 'USER',
              actorId: managerId,
              action: 'booking.confirmed',
              entityType: 'booking',
              entityId: bookingId,
              metadata: { historic: true },
            },
          });
          await prisma.bookingOutboxEvent.create({
            data: {
              id: eventId,
              eventType: 'booking.confirmed',
              aggregateId: bookingId,
              aggregateRevision: 9,
              occurredAt: new Date(),
              correlationId: randomUUID(),
              payload: { bookingId },
            },
          });
          await prisma.idempotencyRecord.create({
            data: {
              id: commandId,
              namespace: 'booking-history',
              idempotencyKey: randomUUID(),
              requestHash: 'a'.repeat(64),
              status: 'SUCCEEDED',
              responseStatus: 201,
              responseBody: { bookingId },
              expiresAt: new Date('2026-10-20T00:00:00Z'),
            },
          });
          historical = JSON.stringify(await readHistory(prisma));
        } finally {
          await prisma.$disconnect();
        }
      }, mainBeforeBillingMigrations);
      expect(JSON.stringify(await readHistory(database.prisma))).toBe(historical);
      expect(await database.prisma.billingLedgerEntry.count()).toBe(0);
      expect(await database.prisma.billingPaymentAttempt.count()).toBe(0);
      expect(await database.prisma.billingInvoice.count()).toBe(0);
      expect(await database.prisma.billingOutboxEvent.count()).toBe(0);
      await expect(
        database.prisma.bookingProposalSnapshot.update({
          where: { bookingId },
          data: { baseChargeVnd: 1 },
        }),
      ).rejects.toThrow();
    } finally {
      await database.disconnect();
    }

    async function readHistory(prisma: ReturnType<typeof createPrismaClient>) {
      return {
        booking: await prisma.booking.findUniqueOrThrow({
          where: { id: bookingId },
          include: { proposalSnapshot: true },
        }),
        audit: await prisma.auditLog.findUniqueOrThrow({ where: { id: auditId } }),
        outbox: await prisma.bookingOutboxEvent.findUniqueOrThrow({ where: { id: eventId } }),
        idempotency: await prisma.idempotencyRecord.findUniqueOrThrow({ where: { id: commandId } }),
      };
    }
  }, 60000);
});
