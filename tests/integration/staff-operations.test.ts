import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';
import { createStaffServices } from '../../src/modules/staff-operations/infrastructure/staff.composition.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)('SPEC-08 real owner operations', () => {
  const db = new CatalogTestDatabase('staff_operations');
  beforeAll(() => db.connect(), 60000);
  afterAll(() => db.disconnect());
  it('defaults to unrecorded, requires names to enable, and assignments allow other duties', async () => {
    const f = await studioFixture(db.prisma),
      s = createStaffServices(db.prisma, () => f.now);
    const staff = await f.actor('STAFF');
    expect(await s.staff.settings(f.bookingId, f.couple)).toMatchObject({
      checkInMode: 'NONE',
      revision: 1,
    });
    expect(await s.readers.getBookingAttendance(f.bookingId)).toMatchObject({
      measurementStatus: 'NOT_RECORDED',
      checkedInGuestCount: null,
      byGuestGroup: [],
    });
    await expect(
      s.staff.configure(
        f.bookingId,
        { expectedRevision: 1, checkInMode: 'BY_GUEST_NAME' },
        randomUUID(),
        f.couple,
      ),
    ).rejects.toMatchObject({ code: 'NAMED_GUEST_LIST_REQUIRED' });
    const assignment = await s.staff.assign(
      f.bookingId,
      { staffAccountId: staff.actorId, expectedRevision: 0 },
      randomUUID(),
      f.manager,
    );
    expect(assignment).toMatchObject({ status: 'ACTIVE', revision: 1 });
    const groups = await s.guests.guests.groups(f.bookingId, f.couple);
    await s.guests.guests.createGuest(
      f.bookingId,
      { guestGroupId: groups[0]!.guestGroupId, name: 'Nguyễn An' },
      randomUUID(),
      f.couple,
    );
    expect(await s.staff.settings(f.bookingId, f.couple)).toMatchObject({ checkInMode: 'NONE' });
    expect(
      await s.staff.configure(
        f.bookingId,
        { expectedRevision: 1, checkInMode: 'BY_GUEST_NAME' },
        randomUUID(),
        f.couple,
      ),
    ).toMatchObject({ revision: 2 });
    await expect(
      s.staff.configure(
        f.bookingId,
        { expectedRevision: 2, checkInMode: 'NONE' },
        randomUUID(),
        staff,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('provisions an existing normalized identity and disables Staff atomically without losing Couple access', async () => {
    const f = await studioFixture(db.prisma),
      s = createStaffServices(db.prisma, () => f.now);
    const account = await db.prisma.account.findUniqueOrThrow({ where: { id: f.couple.actorId } });
    const key = randomUUID(),
      email = account.emailNormalized.toUpperCase();
    const result = await s.accounts.provision(email, key, f.manager);
    expect(result.accountId).toBe(f.couple.actorId);
    expect(await s.accounts.provision(email, key, f.manager)).toEqual(result);
    await expect(
      s.accounts.provision('different@example.test', key, f.manager),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    const assignment = await s.staff.assign(
      f.bookingId,
      { staffAccountId: result.accountId, expectedRevision: 0 },
      randomUUID(),
      f.manager,
    );
    await s.accounts.setOperationalAccess(
      result.accountId,
      { enabled: false, reason: 'Kết thúc nhiệm vụ vận hành' },
      randomUUID(),
      f.manager,
    );
    const retained = await db.prisma.account.findUniqueOrThrow({
      where: { id: result.accountId },
      include: { roles: true, consultationAccesses: true, sessions: true },
    });
    expect(retained.roles.map((r) => r.role)).toEqual(['COUPLE']);
    expect(retained.consultationAccesses).toHaveLength(1);
    expect(retained.sessions.every((r) => r.status === 'REVOKED')).toBe(true);
    expect(
      await db.prisma.staffAssignment.findUnique({ where: { id: assignment.assignmentId } }),
    ).toMatchObject({ status: 'REVOKED', revision: 2 });
    await s.accounts.setOperationalAccess(
      result.accountId,
      { enabled: true, reason: 'Bật lại quyền vận hành' },
      randomUUID(),
      f.manager,
    );
    expect(
      await db.prisma.staffAssignment.findUnique({ where: { id: assignment.assignmentId } }),
    ).toMatchObject({ status: 'REVOKED' });
    await expect(
      s.accounts.provision('unauthorized@example.test', randomUUID(), f.couple),
    ).rejects.toMatchObject({ status: 401 });
  });
});
