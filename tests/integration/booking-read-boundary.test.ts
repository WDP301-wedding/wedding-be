import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { createInvitationStudioServices } from '../../src/modules/invitation-studio/infrastructure/studio.composition.js';
import { createGuestServices } from '../../src/modules/guest-management/infrastructure/guest.composition.js';
import { createSeatingServices } from '../../src/modules/seating-plan/infrastructure/seating.composition.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';
import { controlledStorage } from './invitation-studio/controlled-storage.js';

async function competingLocks(prisma: PrismaClient, bookingId: string) {
  return prisma.$transaction(async (tx) => {
    const [exclusive] = await tx.$queryRaw<Array<{ acquired: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtext(${bookingId}::text)) AS acquired`;
    const [shared] = await tx.$queryRaw<Array<{ acquired: boolean }>>`
      SELECT pg_try_advisory_xact_lock_shared(hashtext(${bookingId}::text)) AS acquired`;
    return { exclusive: exclusive!.acquired, shared: shared!.acquired };
  });
}

(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'booking read locks and lazy repairs',
  () => {
    const db = new CatalogTestDatabase('booking_read_locks');
    beforeAll(() => db.connect(), 60_000);
    afterAll(() => db.disconnect());

    it('allows other readers while retaining the booking fence against writers', async () => {
      const f = await studioFixture(db.prisma);
      const guest = createGuestServices(db.prisma);
      await guest.guests.groups(f.bookingId, f.couple);
      await guest.guests.read(f.bookingId, f.couple, async () => {
        expect(await competingLocks(db.prisma, f.bookingId)).toEqual({
          exclusive: false,
          shared: true,
        });
      });
      expect(await competingLocks(db.prisma, f.bookingId)).toEqual({
        exclusive: true,
        shared: true,
      });
    });

    it('initializes once under simultaneous first reads without replacing planned attendance', async () => {
      const f = await studioFixture(db.prisma);
      const guest = createGuestServices(db.prisma);
      const results = await Promise.all(
        Array.from({ length: 6 }, () => guest.guests.groups(f.bookingId, f.couple)),
      );
      for (const result of results) expect(result).toEqual(results[0]);
      expect(await db.prisma.guestWorkspace.count({ where: { bookingId: f.bookingId } })).toBe(1);
      expect(await db.prisma.guestGroup.count({ where: { bookingId: f.bookingId } })).toBe(4);
      expect(await db.prisma.guestPlanRevision.count({ where: { bookingId: f.bookingId } })).toBe(
        1,
      );
      expect(await db.prisma.guest.count({ where: { bookingId: f.bookingId } })).toBe(0);
      expect(await guest.guests.plan(f.bookingId, f.couple)).toMatchObject({
        planningHeadcount: 20,
      });
      expect(
        await db.prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } }),
      ).toMatchObject({
        planningHeadcount: 20,
      });
    });

    it('reuses locked booking facts within a read without reusing them across requests', async () => {
      const f = await studioFixture(db.prisma);
      const setup = createSeatingServices(db.prisma, f.services);
      await setup.guests.guests.groups(f.bookingId, f.couple);
      await setup.seating.select(
        f.bookingId,
        { layoutTemplateVersionId: f.layoutId, expectedBookingRevision: 1 },
        randomUUID(),
        f.couple,
      );
      const url = new URL(catalogMigrationDatabaseUrl!);
      url.pathname = `/${db.databaseName}`;
      const prisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url.toString() }),
        log: [{ level: 'query', emit: 'event' }],
      });
      let queries = 0;
      prisma.$on('query', () => queries++);
      try {
        const studio = createInvitationStudioServices(
          prisma,
          controlledStorage().provider,
          null,
          null,
        );
        const s = createSeatingServices(prisma, studio);
        const initial = await s.seating.readCurrent(f.bookingId, f.couple);
        expect(initial).toMatchObject({ currentPlanningHeadcount: 20 });
        expect(queries).toBeLessThanOrEqual(32);
        await setup.guests.guests.updatePlan(
          f.bookingId,
          { expectedRevision: 1, planningHeadcount: 25 },
          randomUUID(),
          f.couple,
        );
        expect(await s.seating.readCurrent(f.bookingId, f.couple)).toMatchObject({
          currentPlanningHeadcount: 25,
          currentBookingRevision: 2,
        });
      } finally {
        await prisma.$disconnect();
      }
    });

    it('serializes a stale seating repair once while preserving immutable plan and print history', async () => {
      const f = await studioFixture(db.prisma);
      const s = createSeatingServices(db.prisma, f.services);
      await s.guests.guests.groups(f.bookingId, f.couple);
      const plan = await s.seating.select(
        f.bookingId,
        { layoutTemplateVersionId: f.layoutId, expectedBookingRevision: 1 },
        randomUUID(),
        f.couple,
      );
      const confirmed = await s.seating.confirm(
        f.bookingId,
        plan.seatingPlanId,
        { expectedRevision: 1, expectedBookingRevision: 1 },
        randomUUID(),
        f.couple,
      );
      await s.guests.guests.updatePlan(
        f.bookingId,
        { expectedRevision: 1, planningHeadcount: 25 },
        randomUUID(),
        f.couple,
      );
      const results = await Promise.all(
        Array.from({ length: 4 }, () => s.seating.readCurrent(f.bookingId, f.couple)),
      );
      for (const result of results)
        expect(result).toMatchObject({ status: 'REQUIRES_REVIEW', currentPlanningHeadcount: 25 });
      expect(new Set(results.map((row) => row!.revisionId)).size).toBe(1);
      expect(await db.prisma.seatingPlanRevision.count({ where: { bookingId: f.bookingId } })).toBe(
        3,
      );
      expect(
        await db.prisma.seatingPlanRevision.findUniqueOrThrow({
          where: { id: confirmed.revisionId },
        }),
      ).toMatchObject({ status: 'CONFIRMED', planningHeadcount: 20 });
      expect(
        await db.prisma.invitationSeatingState.findUniqueOrThrow({
          where: { bookingId: f.bookingId },
        }),
      ).toMatchObject({ status: 'REQUIRES_REVIEW' });
    });
  },
);
