import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { seedVenueCatalog, CATALOG_SEED_IDS } from '../../../scripts/catalog-seed.js';
import { createPrismaClient } from '../../../src/core/database/prisma.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';
import { PrismaInvitationReportingReader } from '../../../src/modules/invitation-studio/infrastructure/prisma-reporting.reader.js';

const databaseDescribe = catalogMigrationDatabaseUrl ? describe : describe.skip;
databaseDescribe('SPEC-05 upgrade from accepted Booking ownership', () => {
  it('preserves Booking data, reconstructs historical quotes and resumes the committed sequence', async () => {
    const database = new CatalogTestDatabase('invitation_upgrade');
    const bookingId = randomUUID(),
      consultationId = randomUUID(),
      actorId = randomUUID();
    const orderId = randomUUID(),
      oldRevision = randomUUID(),
      newRevision = randomUUID();
    const oldCharge = randomUUID(),
      newCharge = randomUUID();
    try {
      await database.connect(async (migration, url) => {
        if (
          ![
            '20261009000000_invitation_media_command_recovery',
            '20261009040000_invitation_reporting_snapshots',
          ].includes(migration)
        )
          return;
        const client = new Client({ connectionString: url });
        await client.connect();
        try {
          if (migration === '20261009000000_invitation_media_command_recovery') {
            const prisma = createPrismaClient(url);
            try {
              await seedVenueCatalog(prisma);
            } finally {
              await prisma.$disconnect();
            }
            await client.query(
              'INSERT INTO "Account" (id,"emailNormalized","displayEmail","updatedAt") VALUES ($1,$2,$2,NOW())',
              [actorId, `${actorId}@example.test`],
            );
            await client.query(
              'INSERT INTO "Consultation" (id,"managerAccountId","intendedEmailNormalized","intendedEmail","displayName","updatedAt") VALUES ($1,$2,$3,$3,\'Upgrade\',NOW())',
              [consultationId, actorId, 'upgrade@example.test'],
            );
            await client.query(
              'INSERT INTO "Booking" (id,"consultationId","hallId","eventDate","shiftCode","planningHeadcount","updatedAt") VALUES ($1,$2,$3,\'2026-12-20\',\'LUNCH\',40,NOW())',
              [bookingId, consultationId, CATALOG_SEED_IDS.lotusHall],
            );
            return;
          }
          await client.query(
            `INSERT INTO "InvitationPrintOrder" (id,"bookingId",status,"currentCommercialRevisionId","receivableChargeId","approvedAt","updatedAt") VALUES ($1,$2,'APPROVED',$3,$4,'2026-10-09T12:00:00Z','2026-10-09T12:00:00Z')`,
            [orderId, bookingId, newRevision, newCharge],
          );
          for (const [revision, number, amount, charge, time] of [
            [oldRevision, 1, 10000, oldCharge, '2026-10-09T10:00:00Z'],
            [newRevision, 2, 20000, newCharge, '2026-10-09T12:00:00Z'],
          ] as const) {
            await client.query(
              `INSERT INTO "InvitationCommercialRevision" (id,"orderId","bookingId","revisionNumber","linesJson","orderTotalVnd","estimatedHandoverAt","expiresAt") VALUES ($1,$2,$3,$4,'[]',$5,'2026-10-12T00:00:00Z','2026-10-16T00:00:00Z')`,
              [revision, orderId, bookingId, number, amount],
            );
            await client.query(
              `INSERT INTO "BookingReceivableCharge" (id,"bookingId","sourceType","sourceRevisionId","amountVnd","acceptedAt") VALUES ($1,$2,'PRINT_ORDER',$3,$4,$5)`,
              [charge, bookingId, revision, amount, time],
            );
          }
          const approvalEventId = randomUUID();
          await client.query(
            'INSERT INTO "InvitationStudioOutbox" ("eventId","bookingId","eventType","envelope") VALUES ($1,$2,$3,$4)',
            [
              approvalEventId,
              bookingId,
              'invitation.print-order-approved',
              JSON.stringify({
                eventId: approvalEventId,
                eventType: 'invitation.print-order-approved',
                eventVersion: 1,
                occurredAt: '2026-10-09T10:00:00.321Z',
                producerModule: 'invitation-studio',
                aggregateType: 'BOOKING',
                aggregateId: bookingId,
                correlationId: randomUUID(),
                causationId: randomUUID(),
                payload: {
                  bookingId,
                  printOrderId: orderId,
                  commercialRevisionId: oldRevision,
                  receivableChargeId: oldCharge,
                  approvedAt: '2026-10-09T10:00:00.321Z',
                },
              }),
            ],
          );
          for (const [sequence, action, status, metadata, time] of [
            [
              31,
              'invitation.print-quotation-issued',
              'QUOTED',
              { commercialRevisionId: oldRevision },
              '2026-10-09T09:00:00Z',
            ],
            [
              32,
              'invitation.print-order-approved',
              'APPROVED',
              { commercialRevisionId: oldRevision },
              '2026-10-09T10:00:00Z',
            ],
            [
              33,
              'invitation.print-replacement-proposed',
              'APPROVED',
              { newCommercialRevisionId: newRevision },
              '2026-10-09T11:00:00Z',
            ],
            [
              34,
              'invitation.print-order-replacement-approved',
              'APPROVED',
              { oldCommercialRevisionId: oldRevision, newCommercialRevisionId: newRevision },
              '2026-10-09T12:00:00Z',
            ],
          ] as const) {
            await client.query(
              `INSERT INTO "InvitationPrintAudit" (id,sequence,"bookingId","orderId","actorId",action,"toStatus",metadata,"createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [
                randomUUID(),
                sequence,
                bookingId,
                orderId,
                actorId,
                action,
                status,
                JSON.stringify(metadata),
                time,
              ],
            );
          }
        } finally {
          await client.end();
        }
      });
      expect(
        await database.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } }),
      ).toMatchObject({ consultationId, planningHeadcount: 40, phase: 'DRAFT' });
      const context = {
        requestId: randomUUID(),
        causationId: randomUUID(),
        actorAccountId: null,
        authority: 'SYSTEM' as const,
        purpose: 'reporting:rebuild',
      };
      const reader = new PrismaInvitationReportingReader(database.prisma);
      const history = await reader.readPage({ afterSequence: 0, limit: 100 }, context);
      expect(history.rows.map((r) => r.value)).toMatchObject([
        {
          status: 'QUOTED',
          commercialRevisionId: oldRevision,
          receivableChargeId: null,
          acceptedAmountVnd: 0,
          approvedAt: null,
        },
        {
          commercialRevisionId: oldRevision,
          receivableChargeId: oldCharge,
          acceptedAmountVnd: 10000,
          approvedAt: '2026-10-09T10:00:00.321Z',
        },
        {
          commercialRevisionId: oldRevision,
          receivableChargeId: oldCharge,
          acceptedAmountVnd: 10000,
        },
        {
          commercialRevisionId: newRevision,
          receivableChargeId: newCharge,
          acceptedAmountVnd: 20000,
          approvedAt: '2026-10-09T12:00:00.000Z',
        },
      ]);
      const audit = await database.prisma.invitationPrintAudit.create({
        data: {
          id: randomUUID(),
          bookingId,
          orderId,
          actorId,
          action: 'invitation.print-cancellation-intent-confirmed',
          toStatus: 'APPROVED',
        },
      });
      expect(audit.sequence).toBe(35n);
      await expect(
        database.prisma.invitationPrintAudit.update({
          where: { id: audit.id },
          data: { reportingSnapshot: {} },
        }),
      ).rejects.toThrow();
      expect(
        await reader.readPage(
          { afterSequence: 0, throughSequence: history.throughSequence, limit: 100 },
          context,
        ),
      ).toEqual(history);
    } finally {
      await database.disconnect();
    }
  });
});
