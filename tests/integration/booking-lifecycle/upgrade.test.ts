import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { seedVenueCatalog, CATALOG_SEED_IDS } from '../../../scripts/catalog-seed.js';
import { createPrismaClient } from '../../../src/core/database/prisma.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';

const describeWithDatabase = catalogMigrationDatabaseUrl ? describe : describe.skip;
describeWithDatabase('booking forward upgrade with existing business data', () => {
  it('preserves invitation hashes and immutable proposals, backfills reports, and enforces occupied slots', async () => {
    const database = new CatalogTestDatabase('booking_upgrade');
    const managerId = randomUUID(),
      consultationId = randomUUID(),
      bookingId = randomUUID(),
      invitationId = randomUUID();
    const correlatedEventId = randomUUID();
    const legacyEventId = randomUUID();
    const historicalRequestId = randomUUID();
    const tokenHash = 'a'.repeat(43);
    try {
      await database.connect(async (migration, url) => {
        if (migration === '20261008007000_booking_commercial_acceptance') {
          const client = new Client({ connectionString: url });
          try {
            await client.connect();
            await client.query(
              `INSERT INTO "BookingTimelineRevision" ("id", "bookingId", "revisionNumber", "state", "managerApprovedAt", "coupleApprovedAt", "contentHash", "createdByAccountId", "createdAt")
               VALUES ($1, $2, 1, 'CURRENT', '2026-10-06T00:00:00Z', '2026-10-06T01:00:00Z', 'historic-approval', $3, '2026-10-05T00:00:00Z')`,
              [randomUUID(), bookingId, managerId],
            );
          } finally {
            await client.end();
          }
          return;
        }
        if (migration !== '20261008000000_invitation_delivery_intent') return;
        const prisma = createPrismaClient(url);
        const client = new Client({ connectionString: url });
        try {
          await client.connect();
          await seedVenueCatalog(prisma);
          await prisma.account.create({
            data: {
              id: managerId,
              emailNormalized: 'upgrade@example.com',
              displayEmail: 'upgrade@example.com',
            },
          });
          await client.query(
            'INSERT INTO "Consultation" ("id","managerAccountId","intendedEmailNormalized","intendedEmail","displayName","updatedAt") VALUES ($1,$2,$3,$3,$4,NOW())',
            [consultationId, managerId, 'couple@example.com', 'Upgrade couple'],
          );
          await client.query(
            'INSERT INTO "Booking" ("id","consultationId","hallId","eventDate","shiftCode","phase","revision","planningHeadcount","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,9,100,NOW())',
            [
              bookingId,
              consultationId,
              CATALOG_SEED_IDS.lotusHall,
              '2026-12-20',
              'DINNER',
              'CONFIRMED',
            ],
          );
          await client.query(
            `INSERT INTO "BookingProposalSnapshot" ("bookingId","hallId","hallName","hallDescription","hallMaxGuests","shiftCode","shiftStartTime","shiftEndTime","menuPackageId","menuPackageVersionId","menuVersionNumber","menuName","menuDescription","menuPriceVndPerTable","tableCount","planningHeadcount","baseChargeVnd","depositAmountVnd")
            VALUES ($1,$2,'Historic hall','Original',100,'DINNER','18:00','22:00',$3,$4,1,'Historic menu','Original',3500000,10,100,35000000,10500000)`,
            [
              bookingId,
              CATALOG_SEED_IDS.lotusHall,
              CATALOG_SEED_IDS.classicMenu,
              CATALOG_SEED_IDS.classicMenuVersion,
            ],
          );
          await client.query(
            'INSERT INTO "WorkspaceInvitation" ("id","consultationId","recipientEmailNormalized","issuedByAccountId","sequence","tokenHash","expiresAt","updatedAt") VALUES ($1,$2,$3,$4,1,$5,NOW()+INTERVAL \'1 day\',NOW())',
            [invitationId, consultationId, 'couple@example.com', managerId, tokenHash],
          );
          await client.query(
            `INSERT INTO "AuditLog" ("id","occurredAt","requestId","actorType","actorId","action","entityType","entityId","metadata")
             VALUES ($1,'2026-10-06T00:00:00Z',$2,'USER',$3,'booking.timeline-approved','booking',$4,'{}')`,
            [randomUUID(), historicalRequestId, managerId, bookingId],
          );
          await client.query(
            `INSERT INTO "BookingOutboxEvent" ("id","eventType","aggregateId","aggregateRevision","occurredAt","payload")
             VALUES ($1,'booking.timeline-approved',$3,8,'2026-10-06T00:00:00Z',$4),
                    ($2,'booking.slot-held',$3,7,'2026-10-05T00:00:00Z',$4)`,
            [correlatedEventId, legacyEventId, bookingId, JSON.stringify({ bookingId })],
          );
        } finally {
          await prisma.$disconnect();
          await client.end();
        }
      });
      const invitation = await database.prisma.workspaceInvitation.findUniqueOrThrow({
        where: { id: invitationId },
      });
      expect(invitation.tokenHash).toBe(tokenHash);
      expect(invitation.deliveryIntentId).toMatch(/^[0-9a-f-]{36}$/);
      expect(
        await database.prisma.bookingOutboxEvent.findUniqueOrThrow({
          where: { id: correlatedEventId },
        }),
      ).toMatchObject({
        eventVersion: 1,
        correlationId: historicalRequestId,
        causationId: null,
        payload: { bookingId },
      });
      expect(
        await database.prisma.bookingOutboxEvent.findUniqueOrThrow({
          where: { id: legacyEventId },
        }),
      ).toMatchObject({ eventVersion: 1, correlationId: legacyEventId, causationId: null });
      const booking = await database.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(booking).toMatchObject({ phase: 'CONFIRMED', revision: 9, planningHeadcount: 100 });
      const snapshot = await database.prisma.bookingProposalSnapshot.findUniqueOrThrow({
        where: { bookingId },
      });
      expect(snapshot.hallName).toBe('Historic hall');
      expect(snapshot.baseChargeVnd.toNumber()).toBe(35000000);
      expect(snapshot.commercialRevisionId).toBe(snapshot.id);
      expect(snapshot.commercialAcceptedAt?.toISOString()).toBe('2026-10-06T01:00:00.000Z');
      expect(await database.prisma.bookingReportingSnapshot.count({ where: { bookingId } })).toBe(
        1,
      );
      const reporting = await database.prisma.bookingReportingSnapshot.findFirstOrThrow({
        where: { bookingId },
      });
      expect(reporting.value).toMatchObject({
        bookingId,
        phase: 'CONFIRMED',
        hallNameSnapshot: 'Historic hall',
        baseChargeVnd: 35000000,
      });
      expect(JSON.stringify(reporting.value)).not.toContain('@');
      const otherConsultation = await database.prisma.consultation.create({
        data: {
          id: randomUUID(),
          managerAccountId: managerId,
          intendedEmailNormalized: 'other@example.com',
          intendedEmail: 'other@example.com',
          displayName: 'Other',
        },
      });
      await expect(
        database.prisma.booking.create({
          data: {
            id: randomUUID(),
            consultationId: otherConsultation.id,
            hallId: booking.hallId,
            eventDate: booking.eventDate,
            shiftCode: booking.shiftCode,
            phase: 'CONFIRMED',
            planningHeadcount: 100,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
      await expect(
        database.prisma.bookingProposalSnapshot.update({
          where: { bookingId },
          data: { hallName: 'Mutated' },
        }),
      ).rejects.toThrow();
    } finally {
      await database.disconnect();
    }
  }, 60000);
});
