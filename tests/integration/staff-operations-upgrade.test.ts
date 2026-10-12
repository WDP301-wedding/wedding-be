import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { createPrismaClient } from '../../src/core/database/prisma.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';
import { createGuestServices } from '../../src/modules/guest-management/infrastructure/guest.composition.js';
import { createStaffServices } from '../../src/modules/staff-operations/infrastructure/staff.composition.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'SPEC-08 additive populated migration',
  () => {
    const db = new CatalogTestDatabase('staff_upgrade');
    let bookingId: string,
      guestId: string,
      context: Awaited<ReturnType<typeof studioFixture>>['couple'];
    beforeAll(
      () =>
        db.connect(async (name, url) => {
          if (name !== '20261012030000_staff_operations') return;
          const prisma = createPrismaClient(url);
          try {
            const f = await studioFixture(prisma),
              s = createGuestServices(prisma);
            bookingId = f.bookingId;
            context = f.couple;
            const group = (await s.guests.groups(bookingId, context))[0]!;
            guestId = (
              await s.guests.createGuest(
                bookingId,
                { name: 'Existing named Guest', guestGroupId: group.guestGroupId },
                randomUUID(),
                context,
              )
            ).guestId;
          } finally {
            await prisma.$disconnect();
          }
        }),
      60000,
    );
    afterAll(() => db.disconnect());
    it('preserves paid Booking/Guest/planning and defaults existing events to unknown attendance', async () => {
      const s = createStaffServices(db.prisma);
      expect(await s.staff.settings(bookingId, context)).toMatchObject({
        checkInMode: 'NONE',
        revision: 1,
        locked: false,
      });
      expect(await s.readers.getBookingAttendance(bookingId)).toMatchObject({
        checkedInGuestCount: null,
        measurementStatus: 'NOT_RECORDED',
      });
      expect(await db.prisma.guest.findUnique({ where: { id: guestId } })).toMatchObject({
        name: 'Existing named Guest',
      });
      expect(await db.prisma.booking.findUnique({ where: { id: bookingId } })).toMatchObject({
        planningHeadcount: 20,
        phase: 'CONFIRMED',
      });
      expect(await db.prisma.staffCheckInRecord.count()).toBe(0);
      expect(await db.prisma.staffAssignment.count()).toBe(0);
    });
  },
);
