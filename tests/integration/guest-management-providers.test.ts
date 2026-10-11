import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GuestReaders } from '../../src/modules/guest-management/application/guest-readers.js';
import { createGuestServices } from '../../src/modules/guest-management/infrastructure/guest.composition.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';
const describeDb = catalogMigrationDatabaseUrl ? describe : describe.skip;
describeDb('GM-W3 minimum-data ordered provider conformance', () => {
  const db = new CatalogTestDatabase('guest_providers');
  let f: Awaited<ReturnType<typeof studioFixture>>, s: ReturnType<typeof createGuestServices>;
  let groupId: string, guestId: string;
  beforeAll(async () => {
    await db.connect();
    f = await studioFixture(db.prisma);
    s = createGuestServices(db.prisma);
    groupId = (await s.guests.groups(f.bookingId, f.couple))[0]!.guestGroupId;
  }, 60000);
  afterAll(() => db.disconnect());
  it('separates zero listed names from existing planning and fences immutable reports', async () => {
    expect(await s.readers.getPlan(f.bookingId)).toMatchObject({ expectedAttendees: 20 });
    expect(await s.readers.getGuestListSummary(f.bookingId)).toMatchObject({
      listedGuestCount: 0,
      sourceSequence: 1,
    });
    expect(await s.readers.listGuestGroups(f.bookingId)).toHaveLength(4);
    const context = {
      authority: 'SYSTEM' as const,
      actorAccountId: null,
      requestId: randomUUID(),
      causationId: randomUUID(),
      purpose: 'reporting:guest-management',
    };
    const before = await s.readers.readReportPage(
      f.bookingId,
      { afterSequence: 0, limit: 1 },
      context,
    );
    expect(before.rows[0]!.value).toMatchObject({ planningHeadcount: 20, listedGuestCount: 0 });
    const guest = await s.guests.createGuest(
      f.bookingId,
      {
        name: 'Nguyễn An',
        guestGroupId: groupId,
        phone: '+84901234567',
        operationalNote: 'private-note',
      },
      randomUUID(),
      f.couple,
    );
    guestId = guest.guestId;
    expect(
      await s.readers.readReportPage(
        f.bookingId,
        { afterSequence: 0, throughSequence: before.throughSequence, limit: 50 },
        context,
      ),
    ).toEqual({ ...before, nextAfterSequence: null });
    const after = await s.readers.readReportPage(
      f.bookingId,
      { afterSequence: 0, limit: 1 },
      context,
    );
    expect(after.nextAfterSequence).toBe(1);
    const tail = await s.readers.readReportPage(
      f.bookingId,
      {
        afterSequence: after.nextAfterSequence!,
        throughSequence: after.throughSequence,
        limit: 50,
      },
      context,
    );
    expect(tail.rows[0]!.value).toMatchObject({ planningHeadcount: 20, listedGuestCount: 1 });
    expect(JSON.stringify(tail)).not.toContain('private-note');
    expect(JSON.stringify(tail)).not.toContain('+8490');
    expect(JSON.stringify(tail)).not.toContain('checkedInGuestCount');
    await expect(
      s.readers.readReportPage(
        f.bookingId,
        { afterSequence: 0, limit: 50 },
        { ...context, purpose: 'untrusted' },
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      s.readers.readReportPage(
        f.bookingId,
        { afterSequence: 0, throughSequence: 999, limit: 50 },
        context,
      ),
    ).rejects.toMatchObject({ status: 422 });
    await expect(s.readers.getPlan(randomUUID())).rejects.toMatchObject({ status: 404 });
    await expect(s.readers.getGuestListSummary(randomUUID())).rejects.toMatchObject({
      status: 404,
    });
  });
  it('ranks exact/prefix/substring without auto-selecting duplicates and masks contacts', async () => {
    for (const name of ['An', 'An Bình', 'Nguyễn An', 'An'])
      await s.guests.createGuest(
        f.bookingId,
        { name, guestGroupId: groupId },
        randomUUID(),
        f.couple,
      );
    const first = await s.readers.search(f.bookingId, { query: 'an', limit: 1 }, f.manager);
    expect(first.items[0]!.name).toBe('An');
    expect(first.nextCursor).toBeTypeOf('string');
    const next = await s.readers.search(
      f.bookingId,
      { query: 'an', limit: 1, cursor: first.nextCursor! },
      f.manager,
    );
    expect(next.items[0]!.name).toBe('An');
    expect(first.items[0]!.guestId).not.toBe(next.items[0]!.guestId);
    const all = await s.readers.search(f.bookingId, { query: 'an' }, f.manager);
    expect(all.items.map((r) => r.name).slice(0, 3)).toEqual(['An', 'An', 'An Bình']);
    const phone = await s.readers.search(f.bookingId, { query: '+84901234567' }, f.manager);
    expect(phone.items).toEqual([
      { guestId, guestGroupId: groupId, name: 'Nguyễn An', phoneLast4: '4567' },
    ]);
    expect(await s.readers.requireGuestForOperations(guestId, f.manager)).toMatchObject({
      disambiguatingPhone: '+84901234567',
      operationalNote: 'private-note',
    });
    await expect(s.readers.search(f.bookingId, { query: 'a' }, f.manager)).rejects.toMatchObject({
      status: 422,
    });
    await expect(
      s.readers.search(f.bookingId, { query: 'an', cursor: 'invalid' }, f.manager),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      s.readers.search(f.bookingId, { query: 'other', cursor: first.nextCursor! }, f.manager),
    ).rejects.toMatchObject({ code: 'GUEST_LIST_CURSOR_STALE' });
    await expect(s.readers.search(f.bookingId, { query: 'an' }, f.couple)).rejects.toMatchObject({
      status: 404,
    });
    const staff = await f.actor('STAFF');
    await expect(s.readers.search(f.bookingId, { query: 'an' }, staff)).rejects.toMatchObject({
      status: 404,
    });
    const facade = { requireAssignedOperationsAccess: vi.fn().mockResolvedValue(undefined) },
      assigned = new GuestReaders(s.guests, facade);
    expect((await assigned.search(f.bookingId, { query: 'an' }, staff)).items).toHaveLength(5);
    expect(facade.requireAssignedOperationsAccess).toHaveBeenCalled();
    facade.requireAssignedOperationsAccess.mockRejectedValueOnce(Error('mode disabled'));
    await expect(assigned.search(f.bookingId, { query: 'an' }, staff)).rejects.toThrow(
      'mode disabled',
    );
    await expect(
      s.readers.requireGuestForOperations(randomUUID(), f.manager),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('orders Booking sequence 11 then 10 and rejects changed same-sequence source', async () => {
    const other = await studioFixture(db.prisma),
      composition = createGuestServices(db.prisma);
    const context = {
      authority: 'AUTHENTICATED' as const,
      actorAccountId: other.manager.actorId,
      requestId: randomUUID(),
      causationId: randomUUID(),
    };
    const input = {
      bookingId: other.bookingId,
      sourceGuestPlanRevisionId: randomUUID(),
      sourceSequence: 11,
      expectedAttendees: 30,
    };
    const run = (next: typeof input) =>
      composition.boundary.run({ bookingId: other.bookingId, context }, (scope) =>
        composition.owners.planning.synchronize(next, scope),
      );
    expect((await run(input)).outcome).toBe('APPLIED');
    expect((await run(input)).outcome).toBe('REPLAYED');
    expect((await run({ ...input, sourceSequence: 10, expectedAttendees: 20 })).outcome).toBe(
      'IGNORED_STALE',
    );
    await expect(run({ ...input, expectedAttendees: 31 })).rejects.toMatchObject({
      code: 'HEADCOUNT_SOURCE_CONFLICT',
    });
    const initialized = await composition.guests.plan(other.bookingId, other.couple);
    expect(initialized).toMatchObject({
      planningHeadcount: 30,
      sourceSequence: 11,
      sourceGuestPlanRevisionId: input.sourceGuestPlanRevisionId,
    });
    expect(
      await composition.guests.updatePlan(
        other.bookingId,
        { expectedRevision: 1, planningHeadcount: 25 },
        randomUUID(),
        other.couple,
      ),
    ).toMatchObject({ sourceSequence: 12 });
  });
});
