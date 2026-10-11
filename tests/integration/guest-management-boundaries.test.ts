import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';
import { createGuestServices } from '../../src/modules/guest-management/infrastructure/guest.composition.js';
import { createPrismaSessionRepository } from '../../src/modules/identity-access/session/session.repository.js';

const describeDb = catalogMigrationDatabaseUrl ? describe : describe.skip;
describeDb('GM explicit 300 total, quotas and reauthorization', () => {
  const db = new CatalogTestDatabase('guest_boundaries');
  beforeAll(() => db.connect(), 60000);
  afterAll(() => db.disconnect());
  it('retains 300 with zero/20 names, only an explicit 250 revision changes Booking', async () => {
    const f = await studioFixture(db.prisma),
      s = createGuestServices(db.prisma);
    await db.prisma.hall.update({
      where: { id: f.hallId },
      data: { maxGuests: 500, revision: { increment: 1 } },
    });
    await db.prisma.booking.update({
      where: { id: f.bookingId },
      data: { planningHeadcount: 300 },
    });
    const group = (await s.guests.groups(f.bookingId, f.couple))[0]!;
    expect((await s.guests.plan(f.bookingId, f.couple)).planningHeadcount).toBe(300);
    expect((await s.readers.getGuestListSummary(f.bookingId)).listedGuestCount).toBe(0);
    const preview = await s.guests.preview(
      f.bookingId,
      {
        rows: Array.from({ length: 20 }, (_, i) => ({
          externalRowKey: `partial-${i}`,
          name: 'An',
          guestGroupId: group.guestGroupId,
        })),
      },
      randomUUID(),
      f.couple,
    );
    await s.guests.import(
      f.bookingId,
      { previewId: preview.previewId, digest: preview.digest },
      randomUUID(),
      f.couple,
    );
    expect((await s.readers.getPlan(f.bookingId)).expectedAttendees).toBe(300);
    expect((await s.readers.getGuestListSummary(f.bookingId)).listedGuestCount).toBe(20);
    const guest = (await s.readers.list(f.bookingId, {}, f.couple)).items[0]!;
    await s.guests.updateGuest(
      f.bookingId,
      guest.guestId,
      { expectedRevision: 1, status: 'ARCHIVED' },
      randomUUID(),
      f.couple,
    );
    await expect(
      s.guests.preview(
        f.bookingId,
        {
          rows: [
            {
              externalRowKey: (
                await db.prisma.guest.findUniqueOrThrow({ where: { id: guest.guestId } })
              ).externalRowKey,
              name: 'An',
              guestGroupId: group.guestGroupId,
            },
          ],
          allowUpdates: true,
        },
        randomUUID(),
        f.couple,
      ),
    ).rejects.toMatchObject({ code: 'GUEST_IMPORT_ROW_CONFLICT' });
    await expect(
      s.readers.requireGuestForOperations(guest.guestId, f.manager),
    ).rejects.toMatchObject({ status: 404 });
    expect((await s.readers.getPlan(f.bookingId)).expectedAttendees).toBe(300);
    expect(
      await s.guests.updatePlan(
        f.bookingId,
        { expectedRevision: 1, planningHeadcount: 250 },
        randomUUID(),
        f.couple,
      ),
    ).toMatchObject({ planningHeadcount: 250, sourceSequence: 1 });
    expect(
      (await db.prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } })).planningHeadcount,
    ).toBe(250);
    const history = await db.prisma.guestHistory.findFirstOrThrow({
      where: { bookingId: f.bookingId },
    });
    await expect(
      db.prisma.guestHistory.update({ where: { id: history.id }, data: { snapshot: {} } }),
    ).rejects.toThrow();
    const outbox = await db.prisma.guestOutbox.findFirstOrThrow({
      where: { bookingId: f.bookingId },
    });
    await expect(
      db.prisma.guestOutbox.delete({ where: { eventId: outbox.eventId } }),
    ).rejects.toThrow();
    const key = randomUUID(),
      input = { name: 'Last', guestGroupId: group.guestGroupId };
    await s.guests.createGuest(f.bookingId, input, key, f.couple);
    await createPrismaSessionRepository(db.prisma).revokeSession({
      sessionId: f.couple.sessionId,
      now: new Date(),
      reason: 'test-revocation',
    });
    await expect(s.guests.createGuest(f.bookingId, input, key, f.couple)).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      s.readers.search(f.bookingId, { query: 'An' }, { ...f.manager, actorId: randomUUID() }),
    ).rejects.toMatchObject({ status: 404 });
  }, 30000);
  it('enforces quotas on create, import and restoration without changing the independent plan', async () => {
    const f = await studioFixture(db.prisma),
      s = createGuestServices(db.prisma);
    const groups = await s.guests.groups(f.bookingId, f.couple),
      group = groups[0]!;
    await db.prisma.guestGroup.createMany({
      data: Array.from({ length: 96 }, (_, i) => ({
        id: randomUUID(),
        bookingId: f.bookingId,
        name: `Quota ${i}`,
        normalizedName: `quota ${i}`,
        color: '#FFFFFF',
      })),
    });
    await expect(
      s.guests.createGroup(
        f.bookingId,
        { name: 'Overflow', color: '#FFFFFF' },
        randomUUID(),
        f.couple,
      ),
    ).rejects.toMatchObject({ code: 'GUEST_GROUP_QUOTA_EXCEEDED' });
    await s.guests.updateGroup(
      f.bookingId,
      group.guestGroupId,
      { expectedRevision: 1, status: 'ARCHIVED' },
      randomUUID(),
      f.couple,
    );
    await s.guests.createGroup(
      f.bookingId,
      { name: 'Replacement', color: '#FFFFFF' },
      randomUUID(),
      f.couple,
    );
    await expect(
      s.guests.updateGroup(
        f.bookingId,
        group.guestGroupId,
        { expectedRevision: 2, status: 'ACTIVE' },
        randomUUID(),
        f.couple,
      ),
    ).rejects.toMatchObject({ code: 'GUEST_GROUP_QUOTA_EXCEEDED' });
    await expect(
      s.guests.updateGroup(
        f.bookingId,
        groups[1]!.guestGroupId,
        { expectedRevision: 1, name: groups[2]!.name },
        randomUUID(),
        f.couple,
      ),
    ).rejects.toMatchObject({ code: 'GUEST_GROUP_NAME_CONFLICT' });
    const activeGroup = groups[1]!.guestGroupId;
    for (let batch = 0; batch < 10; batch++)
      await db.prisma.guest.createMany({
        data: Array.from({ length: 1000 }, () => ({
          id: randomUUID(),
          bookingId: f.bookingId,
          guestGroupId: activeGroup,
          name: 'Quota',
          normalizedName: 'quota',
        })),
      });
    await expect(
      s.guests.createGuest(
        f.bookingId,
        { name: 'Extra', guestGroupId: activeGroup },
        randomUUID(),
        f.couple,
      ),
    ).rejects.toMatchObject({ code: 'GUEST_LIST_QUOTA_EXCEEDED' });
    await expect(
      s.guests.preview(
        f.bookingId,
        { rows: [{ name: 'Extra', guestGroupId: activeGroup, externalRowKey: 'overflow' }] },
        randomUUID(),
        f.couple,
      ),
    ).rejects.toMatchObject({ code: 'GUEST_LIST_QUOTA_EXCEEDED' });
    const guest = await db.prisma.guest.findFirstOrThrow({ where: { bookingId: f.bookingId } });
    await s.guests.updateGuest(
      f.bookingId,
      guest.id,
      { expectedRevision: 1, status: 'ARCHIVED' },
      randomUUID(),
      f.couple,
    );
    await s.guests.createGuest(
      f.bookingId,
      { name: 'Replacement', guestGroupId: activeGroup },
      randomUUID(),
      f.couple,
    );
    await expect(
      s.guests.updateGuest(
        f.bookingId,
        guest.id,
        { expectedRevision: 2, status: 'ACTIVE' },
        randomUUID(),
        f.couple,
      ),
    ).rejects.toMatchObject({ code: 'GUEST_LIST_QUOTA_EXCEEDED' });
    expect((await s.guests.plan(f.bookingId, f.couple)).planningHeadcount).toBe(20);
  }, 60000);
  it('rejects missing/retired capacity and stale Booking planning evidence', async () => {
    const f = await studioFixture(db.prisma),
      s = createGuestServices(db.prisma);
    const context = {
      authority: 'AUTHENTICATED' as const,
      actorAccountId: f.manager.actorId,
      requestId: randomUUID(),
      causationId: randomUUID(),
    };
    await expect(
      s.boundary.run({ bookingId: f.bookingId, context }, (scope) =>
        s.owners.capacity.requireCapacity(randomUUID(), 20, scope),
      ),
    ).rejects.toMatchObject({ status: 404 });
    const retired = await db.prisma.hall.create({
      data: {
        name: 'Retired',
        nameNormalized: 'retired',
        description: '',
        maxGuests: 100,
        displayOrder: 0,
        lifecycle: 'RETIRED',
        retiredAt: new Date(),
        updatedByAccountId: f.manager.actorId,
      },
    });
    await expect(
      s.boundary.run({ bookingId: f.bookingId, context }, (scope) =>
        s.owners.capacity.requireCapacity(retired.id, 20, scope),
      ),
    ).rejects.toMatchObject({ status: 404 });
    await s.guests.plan(f.bookingId, f.couple);
    await s.boundary.run({ bookingId: f.bookingId, context }, (scope) =>
      s.owners.planning.synchronize(
        {
          bookingId: f.bookingId,
          sourceGuestPlanRevisionId: randomUUID(),
          sourceSequence: 11,
          expectedAttendees: 30,
        },
        scope,
      ),
    );
    await expect(
      s.guests.updatePlan(
        f.bookingId,
        { expectedRevision: 1, planningHeadcount: 25 },
        randomUUID(),
        f.couple,
      ),
    ).rejects.toMatchObject({ code: 'HEADCOUNT_SOURCE_CONFLICT' });
    await db.prisma.booking.update({ where: { id: f.bookingId }, data: { planningHeadcount: 31 } });
    await expect(
      s.boundary.run({ bookingId: f.bookingId, context }, (scope) =>
        s.owners.planning.getSource(f.bookingId, scope),
      ),
    ).rejects.toMatchObject({ code: 'HEADCOUNT_SOURCE_CONFLICT' });
    expect((await s.readers.getPlan(f.bookingId)).expectedAttendees).toBe(20);
  });
});
