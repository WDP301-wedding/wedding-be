import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';
import { createGuestServices } from '../../src/modules/guest-management/infrastructure/guest.composition.js';

const describeDb = catalogMigrationDatabaseUrl ? describe : describe.skip;
describeDb('GM-W1 real Booking + Guest persistence', () => {
  const database = new CatalogTestDatabase('guest_management');
  let f: Awaited<ReturnType<typeof studioFixture>>;
  let s: ReturnType<typeof createGuestServices>;
  beforeAll(async () => {
    await database.connect();
    f = await studioFixture(database.prisma);
    s = createGuestServices(database.prisma);
  }, 60000);
  afterAll(() => database.disconnect());
  it('initializes groups without names, retains Booking planning count and initializes once', async () => {
    const groups = await s.guests.groups(f.bookingId, f.couple);
    expect(groups).toHaveLength(4);
    expect(await s.guests.plan(f.bookingId, f.couple)).toMatchObject({
      planningHeadcount: 20,
      revision: 1,
      sourceSequence: 0,
    });
    expect(await s.guests.groups(f.bookingId, f.manager)).toEqual(groups);
    expect(await database.prisma.guest.count()).toBe(0);
    expect(
      (await database.prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } }))
        .planningHeadcount,
    ).toBe(20);
  });
  it('creates duplicate named Guests, imports atomically and leaves explicit total alone', async () => {
    const [group] = await s.guests.groups(f.bookingId, f.couple);
    const input = { name: ' Nguyễn An ', guestGroupId: group!.guestGroupId };
    const key = randomUUID();
    const first = await s.guests.createGuest(f.bookingId, input, key, f.couple);
    expect(await s.guests.createGuest(f.bookingId, input, key, f.couple)).toEqual(first);
    const second = await s.guests.createGuest(f.bookingId, input, randomUUID(), f.couple);
    expect(first.guestId).not.toBe(second.guestId);
    await expect(
      s.guests.createGuest(f.bookingId, { ...input, name: 'Other' }, key, f.couple),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    const rows = [
      { ...input, externalRowKey: 'csv-1' },
      { ...input, externalRowKey: 'csv-2' },
    ];
    const preview = await s.guests.preview(f.bookingId, { rows }, randomUUID(), f.couple);
    expect(preview).toMatchObject({ createdCount: 2, updatedCount: 0, unchangedCount: 0 });
    await s.guests.import(
      f.bookingId,
      { previewId: preview.previewId, digest: preview.digest },
      randomUUID(),
      f.couple,
    );
    expect(await s.guests.plan(f.bookingId, f.couple)).toMatchObject({
      planningHeadcount: 20,
      revision: 1,
    });
    const replay = await s.guests.preview(f.bookingId, { rows }, randomUUID(), f.couple);
    expect(replay.unchangedCount).toBe(2);
    const before = await database.prisma.guest.count();
    await expect(
      s.guests.preview(
        f.bookingId,
        { rows: [...rows, { ...input, externalRowKey: 'bad', guestGroupId: randomUUID() }] },
        randomUUID(),
        f.couple,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(await database.prisma.guest.count()).toBe(before);
    await s.guests.updateGuest(
      f.bookingId,
      first.guestId,
      { expectedRevision: 1, status: 'ARCHIVED' },
      randomUUID(),
      f.couple,
    );
    expect((await s.guests.plan(f.bookingId, f.couple)).planningHeadcount).toBe(20);
  });
  it('explicit planning atomically syncs real Booking; stale, capacity and rollback leave history intact', async () => {
    const plan = await s.guests.plan(f.bookingId, f.couple);
    const before = await database.prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
    const sync = s.owners.planning.synchronize.bind(s.owners.planning);
    const failure = vi
      .spyOn(s.owners.planning, 'synchronize')
      .mockImplementation(async (input, ctx) => {
        await sync(input, ctx);
        throw Error('provider failed');
      });
    await expect(
      s.guests.updatePlan(
        f.bookingId,
        { expectedRevision: plan.revision, planningHeadcount: 25 },
        randomUUID(),
        f.couple,
      ),
    ).rejects.toThrow('provider failed');
    failure.mockRestore();
    expect(await database.prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } })).toEqual(
      before,
    );
    expect(await database.prisma.guestPlanRevision.count()).toBe(1);
    const key = randomUUID(),
      input = { expectedRevision: 1, planningHeadcount: 25 };
    const next = await s.guests.updatePlan(f.bookingId, input, key, f.couple);
    expect(next).toMatchObject({ planningHeadcount: 25, revision: 2, sourceSequence: 1 });
    expect(await s.guests.updatePlan(f.bookingId, input, key, f.couple)).toEqual(next);
    expect(
      (await database.prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } }))
        .planningHeadcount,
    ).toBe(25);
    await expect(
      s.guests.updatePlan(f.bookingId, input, randomUUID(), f.couple),
    ).rejects.toMatchObject({ code: 'GUEST_PLAN_REVISION_STALE' });
    await expect(
      s.guests.updatePlan(
        f.bookingId,
        { expectedRevision: 2, planningHeadcount: 101 },
        randomUUID(),
        f.manager,
      ),
    ).rejects.toMatchObject({ code: 'GUEST_PLAN_CAPACITY_EXCEEDED' });
    await expect(
      database.prisma.guestPlanRevision.update({
        where: { id: next.sourceGuestPlanRevisionId },
        data: { planningHeadcount: 99 },
      }),
    ).rejects.toThrow();
  });
  it('issues view-only credentials once, exchanges with hash-only sessions and revokes on reissue/archive', async () => {
    const [group] = await s.guests.groups(f.bookingId, f.couple);
    const guest = await s.guests.createGuest(
      f.bookingId,
      {
        name: 'Kính mời An',
        guestGroupId: group!.guestGroupId,
        phone: '+84901234567',
        operationalNote: 'private-note',
      },
      randomUUID(),
      f.couple,
    );
    await expect(
      s.links.issue(f.bookingId, guest.guestId, { expectedRevision: 0 }, randomUUID(), f.couple),
    ).rejects.toMatchObject({ code: 'INVITATION_LINK_UNAVAILABLE' });
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
    const key = randomUUID();
    const link = await s.links.issue(
      f.bookingId,
      guest.guestId,
      { expectedRevision: 0 },
      key,
      f.couple,
    );
    expect(link.credential).toMatch(/^wgc_/u);
    expect(link.fragment).toBe(`#credential=${link.credential}`);
    await expect(
      s.links.issue(f.bookingId, guest.guestId, { expectedRevision: 0 }, key, f.couple),
    ).rejects.toMatchObject({ code: 'INVITATION_CREDENTIAL_ALREADY_ISSUED' });
    const session = await s.links.exchange(link.credential, '127.0.0.1');
    expect(await s.links.view(session.capability)).toMatchObject({
      recipientGreeting: 'Kính mời An',
      invitation: { title: f.content.title },
    });
    const view = JSON.stringify(await s.links.view(session.capability));
    expect(view).not.toContain('private-note');
    expect(view).not.toContain('+84901234567');
    expect(view).not.toContain('planningHeadcount');
    const stored = JSON.stringify(await database.prisma.guestCommand.findMany());
    expect(stored).not.toContain(link.credential);
    expect(stored).not.toContain(session.capability);
    const newer = await s.links.issue(
      f.bookingId,
      guest.guestId,
      { expectedRevision: 1 },
      randomUUID(),
      f.couple,
    );
    await expect(s.links.view(session.capability)).rejects.toMatchObject({
      code: 'INVITATION_LINK_UNAVAILABLE',
    });
    await expect(s.links.exchange(link.credential, '127.0.0.1')).rejects.toMatchObject({
      code: 'INVITATION_LINK_UNAVAILABLE',
    });
    await s.guests.updateGuest(
      f.bookingId,
      guest.guestId,
      { expectedRevision: 1, status: 'ARCHIVED' },
      randomUUID(),
      f.couple,
    );
    await expect(s.links.exchange(newer.credential, '127.0.0.1')).rejects.toMatchObject({
      code: 'INVITATION_LINK_UNAVAILABLE',
    });
  });
});
