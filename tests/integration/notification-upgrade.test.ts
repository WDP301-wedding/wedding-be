import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../src/core/database/prisma.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createInvitationStudioServices } from '../../src/modules/invitation-studio/infrastructure/studio.composition.js';
import { createStaffSeatingServices } from '../../src/modules/staff-operations/infrastructure/staff-seating.composition.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';
import { controlledStorage } from './invitation-studio/controlled-storage.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'Notifications populated additive upgrade',
  () => {
    const db = new CatalogTestDatabase('notification_upgrade');
    afterAll(() => db.disconnect());
    it('preserves Group/Guest planning, native settlement, printable history and unknown NONE attendance', async () => {
      let before: string;
      let fixture: Awaited<ReturnType<typeof studioFixture>>;
      let printableId: string;
      let fileHash: string;
      const snapshot = async (p: PrismaClient) =>
        JSON.stringify({
          booking: await p.booking.findUniqueOrThrow({ where: { id: fixture.bookingId } }),
          groups: await p.guestGroup.findMany({
            where: { bookingId: fixture.bookingId },
            orderBy: { id: 'asc' },
          }),
          guests: await p.guest.findMany({
            where: { bookingId: fixture.bookingId },
            orderBy: { id: 'asc' },
          }),
          settlement: await p.bookingDepositSettlement.findUniqueOrThrow({
            where: { bookingId: fixture.bookingId },
          }),
          printable: await p.invitationPrintableRevision.findUniqueOrThrow({
            where: { id: printableId },
          }),
        });
      await db.connect(async (name, url) => {
        if (name !== '20261012040000_notification_foundation') return;
        const p = createPrismaClient(url);
        try {
          fixture = await studioFixture(p);
          const group = await p.guestGroup.create({
            data: {
              id: randomUUID(),
              bookingId: fixture.bookingId,
              name: 'Bạn bè',
              normalizedName: 'ban be',
              color: '#123456',
            },
          });
          await p.guest.create({
            data: {
              id: randomUUID(),
              bookingId: fixture.bookingId,
              guestGroupId: group.id,
              name: 'Khách thử',
              normalizedName: 'khach thu',
            },
          });
          const design = await fixture.services.designs.create(
            {
              bookingId: fixture.bookingId,
              content: fixture.content,
              idempotencyKey: randomUUID(),
            },
            fixture.couple,
          );
          await fixture.services.publication.publish(
            {
              bookingId: fixture.bookingId,
              designId: design.designId,
              designRevisionId: design.revisionId,
              expectedRevision: 1,
              expectedPublicationRevision: 0,
              idempotencyKey: randomUUID(),
            },
            fixture.couple,
          );
          const printed = await fixture.services.boundary.run(
            { bookingId: fixture.bookingId, context: fixture.contract },
            (scope) =>
              fixture.services.printable.capture(
                { bookingId: fixture.bookingId, designRevisionId: design.revisionId },
                scope,
              ),
          );
          printableId = printed.printableRevisionId;
          const file = await fixture.services.printFiles.read(
            fixture.bookingId,
            printableId,
            fixture.couple,
          );
          expect(file.bytes.subarray(0, 5).toString()).toBe('%PDF-');
          fileHash = file.sha256;
          before = await snapshot(p);
        } finally {
          await p.$disconnect();
        }
      });
      expect(await snapshot(db.prisma)).toBe(before!);
      const studio = createInvitationStudioServices(
        db.prisma,
        controlledStorage().provider,
        null,
        'https://wedding.example.test',
        () => fixture!.now,
      );
      expect(
        (await studio.printFiles.read(fixture!.bookingId, printableId!, fixture!.couple)).sha256,
      ).toBe(fileHash!);
      expect(
        await createStaffSeatingServices(db.prisma, studio).staff.readers.getBookingAttendance(
          fixture!.bookingId,
        ),
      ).toMatchObject({ measurementStatus: 'NOT_RECORDED', checkedInGuestCount: null });
      expect(await db.prisma.notificationIntent.count()).toBe(0);
      const tables = await db.prisma.$queryRaw<
        { relrowsecurity: boolean }[]
      >`SELECT relrowsecurity FROM pg_class WHERE relname IN ('NotificationIntent','NotificationCredential','NotificationInbox','IdentityOutbox') AND relnamespace=current_schema()::regnamespace`;
      expect(tables).toHaveLength(4);
      expect(tables.every((t) => t.relrowsecurity)).toBe(true);
    }, 60000);
  },
);
