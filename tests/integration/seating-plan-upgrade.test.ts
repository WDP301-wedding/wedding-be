import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../src/core/database/prisma.js';
import { createSeatingServices } from '../../src/modules/seating-plan/infrastructure/seating.composition.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';
import { randomUUID } from 'node:crypto';
(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'SEA-W2 populated forward migration',
  () => {
    const db = new CatalogTestDatabase('seating_upgrade');
    afterAll(() => db.disconnect());
    it('preserves legacy Booking/Guest/print history and initializes no seating automatically', async () => {
      let oldBookingId = '';
      let oldPrintableId = '',
        oldPrintableDigest = '';
      await db.connect(async (name, url) => {
        if (name !== '20261012020000_seating_plan') return;
        const old = createPrismaClient(url);
        try {
          const f = await studioFixture(old);
          oldBookingId = f.bookingId;
          const design = await f.services.designs.create(
            { bookingId: f.bookingId, content: f.content, idempotencyKey: randomUUID() },
            f.couple,
          );
          await f.services.publication.publish(
            {
              bookingId: f.bookingId,
              designId: design.designId,
              designRevisionId: design.revisionId,
              expectedRevision: 1,
              expectedPublicationRevision: 0,
              idempotencyKey: randomUUID(),
            },
            f.couple,
          );
          const printable = await f.services.boundary.run(
            { bookingId: f.bookingId, context: f.contract },
            (scope) =>
              f.services.printable.capture(
                { bookingId: f.bookingId, designRevisionId: design.revisionId },
                scope,
              ),
          );
          oldPrintableId = printable.printableRevisionId;
          oldPrintableDigest = printable.contentDigest;
        } finally {
          await old.$disconnect();
        }
      });
      expect(await db.prisma.seatingPlan.count()).toBe(0);
      expect(await db.prisma.booking.findUnique({ where: { id: oldBookingId } })).toMatchObject({
        planningHeadcount: 20,
        phase: 'CONFIRMED',
      });
      expect(await db.prisma.guestWorkspace.count()).toBe(0);
      expect(
        await db.prisma.invitationPrintableRevision.findUnique({ where: { id: oldPrintableId } }),
      ).toMatchObject({
        bookingId: oldBookingId,
        contentDigest: oldPrintableDigest,
        seatingPlanRevisionId: null,
      });
      const f = await studioFixture(db.prisma),
        s = createSeatingServices(db.prisma, f.services);
      const selected = await s.seating.select(
        f.bookingId,
        { layoutTemplateVersionId: f.layoutId, expectedBookingRevision: 1 },
        randomUUID(),
        f.couple,
      );
      expect(selected.revisionNumber).toBe(1);
      await expect(s.seating.requireCurrentPlan(randomUUID())).rejects.toMatchObject({
        status: 404,
      });
      await expect(s.seating.resolveRevision(randomUUID())).rejects.toMatchObject({ status: 404 });
      expect(await s.seating.resolveRevision(selected.revisionId)).toEqual(selected);
      expect(await s.seating.requireCurrentPlan(f.bookingId)).toEqual(selected);
    }, 60000);
  },
);
