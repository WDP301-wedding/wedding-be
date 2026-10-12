import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';
import { createSeatingServices } from '../../src/modules/seating-plan/infrastructure/seating.composition.js';
import { SeatingService } from '../../src/modules/seating-plan/application/seating.service.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'SPEC-07 real owner persistence/registry conformance',
  () => {
    const db = new CatalogTestDatabase('seating');
    beforeAll(() => db.connect(), 60000);
    afterAll(() => db.disconnect());
    async function fixture() {
      const f = await studioFixture(db.prisma),
        s = createSeatingServices(db.prisma, f.services, () => f.now);
      const groups = await s.guests.guests.groups(f.bookingId, f.couple);
      const plan = await s.seating.select(
        f.bookingId,
        { layoutTemplateVersionId: f.layoutId, expectedBookingRevision: 1 },
        randomUUID(),
        f.couple,
      );
      return { f, s, groups, plan };
    }
    async function confirm(
      x: Awaited<ReturnType<typeof fixture>>,
      expectedRevision = x.plan.revisionNumber,
    ) {
      return x.s.seating.confirm(
        x.f.bookingId,
        x.plan.seatingPlanId,
        { expectedRevision, expectedBookingRevision: 1 },
        randomUUID(),
        x.f.couple,
      );
    }
    it('retains independent 20-person planning with zero names and resolves group labels server-side', async () => {
      const x = await fixture(),
        { f, s, groups, plan } = x;
      expect(await s.seating.options(f.bookingId, f.couple)).toMatchObject({
        planningHeadcount: 20,
        items: [{ compatible: true }],
      });
      expect(await db.prisma.guest.count({ where: { bookingId: f.bookingId } })).toBe(0);
      const revised = await s.seating.revise(
        f.bookingId,
        plan.seatingPlanId,
        {
          expectedRevision: 1,
          labels: [
            {
              layoutTableId: plan.renderSnapshot[0]!.layoutTableId,
              guestGroupId: groups[0]!.guestGroupId,
            },
          ],
        },
        randomUUID(),
        f.couple,
      );
      const c = await confirm(x, 2);
      expect(c.labels[0]).toMatchObject({
        groupName: groups[0]!.name,
        colorSnapshot: groups[0]!.color,
      });
      expect(c.status).toBe('CONFIRMED');
      expect(
        await db.prisma.invitationSeatingState.findUnique({ where: { bookingId: f.bookingId } }),
      ).toMatchObject({ status: 'ELIGIBLE', revisionId: c.revisionId });
      expect(await s.seating.read(f.bookingId, plan.seatingPlanId, f.manager)).toEqual(c);
      const guest = await s.guests.guests.createGuest(
        f.bookingId,
        { name: 'Nguyễn An', guestGroupId: groups[0]!.guestGroupId },
        randomUUID(),
        f.couple,
      );
      await s.guests.guests.updateGuest(
        f.bookingId,
        guest.guestId,
        { expectedRevision: 1, status: 'ARCHIVED' },
        randomUUID(),
        f.couple,
      );
      expect((await s.seating.options(f.bookingId, f.couple)).planningHeadcount).toBe(20);
      await expect(
        db.prisma.seatingPlanRevision.update({
          where: { id: revised.revisionId },
          data: { planningHeadcount: 999 },
        }),
      ).rejects.toThrow();
      await expect(
        db.prisma.seatingPlanRevision.delete({ where: { id: revised.revisionId } }),
      ).rejects.toThrow();
      await expect(
        db.prisma.seatingPlan.update({
          where: { bookingId: f.bookingId },
          data: { revisionNumber: 1 },
        }),
      ).rejects.toThrow();
      expect(await db.prisma.seatingOutbox.count({ where: { bookingId: f.bookingId } })).toBe(1);
    });
    it('serializes duplicate/replay/stale confirmations and never inherits confirmation on edit', async () => {
      const x = await fixture(),
        { f, s, plan } = x,
        key = randomUUID();
      const input = { expectedRevision: 1, expectedBookingRevision: 1 };
      const result = await Promise.all([
        s.seating.confirm(f.bookingId, plan.seatingPlanId, input, key, f.couple),
        s.seating.confirm(f.bookingId, plan.seatingPlanId, input, key, f.couple),
      ]);
      expect(result[0]).toEqual(result[1]);
      await expect(
        s.seating.confirm(
          f.bookingId,
          plan.seatingPlanId,
          { ...input, expectedRevision: 2 },
          key,
          f.couple,
        ),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
      await expect(confirm(x)).rejects.toMatchObject({ code: 'SEATING_REVISION_STALE' });
      const revised = await s.seating.revise(
        f.bookingId,
        plan.seatingPlanId,
        { expectedRevision: 2, labels: [] },
        randomUUID(),
        f.couple,
      );
      expect(revised.status).toBe('DRAFT');
      expect(
        await db.prisma.invitationSeatingState.findUnique({ where: { bookingId: f.bookingId } }),
      ).toMatchObject({ status: 'REQUIRES_REVIEW' });
      const c = await confirm(x, 3);
      expect(c.revisionNumber).toBe(4);
      expect(await db.prisma.seatingPlanRevision.count({ where: { bookingId: f.bookingId } })).toBe(
        4,
      );
      const competing = await Promise.allSettled([confirm(x, 4), confirm(x, 4)]);
      expect(competing.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });
    it('rolls back plan/head/outbox/receipt when real registry rejects confirmation', async () => {
      const x = await fixture(),
        { f, s, plan } = x;
      const failure = vi
        .spyOn(f.services.printable, 'registerConfirmed')
        .mockRejectedValueOnce(new Error('registry failure'));
      await expect(confirm(x)).rejects.toThrow('registry failure');
      failure.mockRestore();
      expect(await db.prisma.seatingPlanRevision.count({ where: { bookingId: f.bookingId } })).toBe(
        1,
      );
      expect(await db.prisma.seatingOutbox.count({ where: { bookingId: f.bookingId } })).toBe(0);
      expect(await s.seating.read(f.bookingId, plan.seatingPlanId, f.couple)).toMatchObject({
        status: 'DRAFT',
        revisionNumber: 1,
      });
      await confirm(x);
    });
    it('invalidates out-of-range headcount, preserves history and rejects older/future events', async () => {
      const x = await fixture(),
        { f, s, plan } = x;
      const c = await confirm(x);
      await s.guests.guests.updatePlan(
        f.bookingId,
        { expectedRevision: 1, planningHeadcount: 35 },
        randomUUID(),
        f.couple,
      );
      await expect(
        s.seating.confirm(
          f.bookingId,
          plan.seatingPlanId,
          { expectedRevision: 2, expectedBookingRevision: 1 },
          randomUUID(),
          f.couple,
        ),
      ).rejects.toMatchObject({ code: 'SEATING_REVISION_STALE' });
      const row = await s.seating.reconcile(f.bookingId, 2);
      expect(row).toMatchObject({
        status: 'REQUIRES_REVIEW',
        revisionNumber: 3,
        expectedAttendees: 35,
      });
      expect(await s.seating.reconcile(f.bookingId, 1)).toEqual(row);
      expect(await s.seating.reconcile(f.bookingId, 2)).toEqual(row);
      await expect(s.seating.reconcile(f.bookingId, 999)).rejects.toMatchObject({
        code: 'SEATING_REVISION_STALE',
      });
      expect(
        await db.prisma.invitationSeatingState.findUnique({ where: { bookingId: f.bookingId } }),
      ).toMatchObject({ status: 'REQUIRES_REVIEW', revisionId: c.revisionId });
      expect(await s.seating.options(f.bookingId, f.couple)).toMatchObject({
        items: [{ compatible: false }],
      });
      await expect(
        s.seating.confirm(
          f.bookingId,
          plan.seatingPlanId,
          { expectedRevision: 3, expectedBookingRevision: 2 },
          randomUUID(),
          f.couple,
        ),
      ).rejects.toMatchObject({ code: 'HEADCOUNT_OUTSIDE_LAYOUT_RANGE' });
      expect(
        await db.prisma.seatingPlanRevision.findUnique({ where: { id: c.revisionId } }),
      ).toMatchObject({ status: 'CONFIRMED', planningHeadcount: 20 });
    });
    it('audits exact Manager exceptions, rejects Couple/physical overflow/zero, and invalidates changed exception', async () => {
      const { f, s, plan } = await fixture();
      await s.guests.guests.updatePlan(
        f.bookingId,
        { expectedRevision: 1, planningHeadcount: 35 },
        randomUUID(),
        f.couple,
      );
      const input = {
        expectedRevision: 1,
        expectedBookingRevision: 2,
        reason: 'Bố trí thêm trong sức chứa vật lý',
      };
      await expect(
        s.seating.confirm(f.bookingId, plan.seatingPlanId, input, randomUUID(), f.couple, true),
      ).rejects.toMatchObject({ status: 404 });
      const c = await s.seating.confirm(
        f.bookingId,
        plan.seatingPlanId,
        input,
        randomUUID(),
        f.manager,
        true,
      );
      expect(c.managerException).toMatchObject({
        actorAccountId: f.manager.actorId,
        approvedHeadcount: 35,
        reason: input.reason,
      });
      await s.guests.guests.updatePlan(
        f.bookingId,
        { expectedRevision: 2, planningHeadcount: 36 },
        randomUUID(),
        f.couple,
      );
      expect(await s.seating.read(f.bookingId, plan.seatingPlanId, f.couple)).toMatchObject({
        status: 'REQUIRES_REVIEW',
      });
      await s.guests.guests.updatePlan(
        f.bookingId,
        { expectedRevision: 3, planningHeadcount: 41 },
        randomUUID(),
        f.couple,
      );
      await expect(
        s.seating.confirm(
          f.bookingId,
          plan.seatingPlanId,
          { ...input, expectedRevision: 3, expectedBookingRevision: 4 },
          randomUUID(),
          f.manager,
          true,
        ),
      ).rejects.toMatchObject({ code: 'EXCEPTION_EXCEEDS_PHYSICAL_CAPACITY' });
      await s.guests.guests.updatePlan(
        f.bookingId,
        { expectedRevision: 4, planningHeadcount: 0 },
        randomUUID(),
        f.couple,
      );
      await expect(
        s.seating.confirm(
          f.bookingId,
          plan.seatingPlanId,
          { ...input, expectedRevision: 3, expectedBookingRevision: 5 },
          randomUUID(),
          f.manager,
          true,
        ),
      ).rejects.toMatchObject({ code: 'HEADCOUNT_OUTSIDE_LAYOUT_RANGE' });
    });
    it('allows superseded historical selection but blocks retirement at confirm and read boundaries', async () => {
      const x = await fixture(),
        { f, s, plan } = x;
      const newer = randomUUID();
      await f.layout.cloneVersion({
        templateId: f.templateId,
        sourceVersionId: f.layoutId,
        versionId: newer,
        context: f.ownerContext,
      });
      await f.layout.publish({
        templateId: f.templateId,
        versionId: newer,
        expectedRevision: 1,
        context: f.ownerContext,
      });
      await confirm(x);
      await expect(
        s.seating.select(
          f.bookingId,
          { layoutTemplateVersionId: f.layoutId, expectedBookingRevision: 1 },
          randomUUID(),
          f.couple,
        ),
      ).rejects.toMatchObject({ code: 'LAYOUT_RETIRED' });
      const template = await db.prisma.layoutTemplate.findUniqueOrThrow({
        where: { id: f.templateId },
      });
      await f.layout.changeLifecycle({
        aggregateId: f.templateId,
        expectedRevision: template.revision,
        transition: 'RETIRE',
        context: f.ownerContext,
      });
      expect(await s.seating.read(f.bookingId, plan.seatingPlanId, f.couple)).toMatchObject({
        status: 'REQUIRES_REVIEW',
      });
      await expect(
        s.seating.confirm(
          f.bookingId,
          plan.seatingPlanId,
          { expectedRevision: 3, expectedBookingRevision: 1 },
          randomUUID(),
          f.couple,
        ),
      ).rejects.toMatchObject({ code: 'LAYOUT_RETIRED' });
      expect((await s.seating.options(f.bookingId, f.couple)).items).toEqual([]);
    });
    it('rejects cross-owner tables/groups, stale edits, bad keys and duplicates', async () => {
      const { f, s, plan, groups } = await fixture();
      await expect(
        s.seating.revise(
          f.bookingId,
          plan.seatingPlanId,
          { expectedRevision: 999, labels: [] },
          randomUUID(),
          f.couple,
        ),
      ).rejects.toMatchObject({ code: 'SEATING_REVISION_STALE' });
      for (const labels of [
        [{ layoutTableId: randomUUID(), guestGroupId: groups[0]!.guestGroupId }],
        [{ layoutTableId: plan.renderSnapshot[0]!.layoutTableId, guestGroupId: randomUUID() }],
        [1, 2].map(() => ({
          layoutTableId: plan.renderSnapshot[0]!.layoutTableId,
          guestGroupId: groups[0]!.guestGroupId,
        })),
      ])
        await expect(
          s.seating.revise(
            f.bookingId,
            plan.seatingPlanId,
            { expectedRevision: 1, labels },
            randomUUID(),
            f.couple,
          ),
        ).rejects.toMatchObject({ status: 409 });
      await expect(
        s.seating.select(
          f.bookingId,
          { layoutTemplateVersionId: f.layoutId, expectedBookingRevision: 1 },
          randomUUID(),
          f.couple,
        ),
      ).rejects.toMatchObject({ code: 'SEATING_PLAN_EXISTS' });
      await expect(
        s.seating.revise(
          f.bookingId,
          randomUUID(),
          { expectedRevision: 1 },
          randomUUID(),
          f.couple,
        ),
      ).rejects.toMatchObject({ status: 404 });
      expect(() =>
        s.seating.revise(f.bookingId, plan.seatingPlanId, { expectedRevision: 1 }, '', f.couple),
      ).toThrow('The request is invalid.');
      for (const actor of [
        await f.actor('COUPLE'),
        await f.actor('STAFF'),
        { ...f.couple, actorId: randomUUID() },
      ])
        await expect(s.seating.read(f.bookingId, plan.seatingPlanId, actor)).rejects.toMatchObject({
          status: 404,
        });
      await expect(s.seating.bookingForPlan(plan.seatingPlanId, f.couple)).rejects.toMatchObject({
        status: 404,
      });
      await expect(s.seating.bookingForPlan(randomUUID(), f.manager)).rejects.toMatchObject({
        status: 404,
      });
      expect(await s.seating.bookingForPlan(plan.seatingPlanId, f.manager)).toBe(f.bookingId);
    });
    it('sweeps bounded pages and requires Staff owner authority for optional ABSENT guidance', async () => {
      const { f, s, plan } = await fixture();
      expect(await s.seating.reconcile(randomUUID())).toBeNull();
      const page = await s.seating.reconcilePage(undefined, 1);
      expect(page.nextBookingId).toBeTypeOf('string');
      expect(
        (await s.seating.reconcilePage('ffffffff-ffff-4fff-8fff-ffffffffffff')).nextBookingId,
      ).toBeNull();
      await expect(
        s.boundary.run({ bookingId: f.bookingId, context: f.contract }, (scope) =>
          s.seating.getGuidance(f.bookingId, scope),
        ),
      ).rejects.toMatchObject({ status: 404 });
      const staff = new SeatingService(
        s.guests,
        s.seating.layouts,
        s.seating.venue,
        s.seating.registry,
        () => f.now,
        { requireAssignedOperationsAccess: async () => {} },
      );
      const guidance = await s.boundary.run(
        { bookingId: f.bookingId, context: f.contract },
        (scope) => staff.getGuidance(f.bookingId, scope),
      );
      expect(guidance).toMatchObject({
        status: 'DRAFT',
        seatingPlanRevisionId: plan.revisionId,
        groups: [],
      });
      const absent = await studioFixture(db.prisma);
      expect(
        await s.boundary.run({ bookingId: absent.bookingId, context: absent.contract }, (scope) =>
          staff.getGuidance(absent.bookingId, scope),
        ),
      ).toMatchObject({ status: 'ABSENT', groups: [] });
    });
  },
);
