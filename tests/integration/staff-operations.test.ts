import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createStaffSeatingServices } from '../../src/modules/staff-operations/infrastructure/staff-seating.composition.js';
import { createApp } from '../../src/app.js';
import { createStaffRouter } from '../../src/modules/staff-operations/http/staff.router.js';
import request from 'supertest';
import { z } from 'zod';
import { errorResponseSchema } from '../../src/core/http/common.schemas.js';
import { createInvitationStudioRuntime } from '../../src/modules/invitation-studio/invitation-studio.runtime.js';
import { parseEnvironment } from '../../src/config/env.js';
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
  async function enabledFixture() {
    const f = await studioFixture(db.prisma),
      staff = await f.actor('STAFF');
    const b = await db.prisma.booking.findUniqueOrThrow({
      where: { id: f.bookingId },
      include: { proposalSnapshot: true },
    });
    const clock = new Date(
      `${b.eventDate.toISOString().slice(0, 10)}T${b.proposalSnapshot!.shiftStartTime.toISOString().slice(11, 16)}:00+07:00`,
    );
    const expiry = new Date(clock.getTime() + 86400000);
    const accounts = [f.manager.actorId, f.couple.actorId, staff.actorId];
    await db.prisma.session.updateMany({
      where: { accountId: { in: accounts } },
      data: { idleExpiresAt: expiry, absoluteExpiresAt: expiry },
    });
    await db.prisma.accessCredential.updateMany({
      where: { session: { accountId: { in: accounts } } },
      data: { expiresAt: expiry },
    });
    const s = createStaffServices(db.prisma, () => clock);
    const [group] = await s.guests.guests.groups(f.bookingId, f.couple);
    const guest = await s.guests.guests.createGuest(
      f.bookingId,
      {
        guestGroupId: group!.guestGroupId,
        name: 'Nguyễn An',
        phone: '+84912345678',
        operationalNote: 'Private note',
      },
      randomUUID(),
      f.couple,
    );
    const assignment = await s.staff.assign(
      f.bookingId,
      { staffAccountId: staff.actorId, expectedRevision: 0 },
      randomUUID(),
      f.manager,
    );
    await s.staff.configure(
      f.bookingId,
      { checkInMode: 'BY_GUEST_NAME', expectedRevision: 1 },
      randomUUID(),
      f.couple,
    );
    return { f, staff, s, guest, assignment, group: group!, clock };
  }
  it('serializes same/different keys, appends undo/recheck-in, locks mode and preserves archived history', async () => {
    const { f, staff, s, guest, group } = await enabledFixture(),
      key = randomUUID();
    const attempts = await Promise.all([
      s.journal.checkIn(f.bookingId, guest.guestId, {}, key, staff),
      s.journal.checkIn(f.bookingId, guest.guestId, {}, key, staff),
    ]);
    expect(attempts[0]).toEqual(attempts[1]);
    await expect(
      s.journal.checkIn(f.bookingId, guest.guestId, {}, randomUUID(), staff),
    ).rejects.toMatchObject({ code: 'GUEST_ALREADY_CHECKED_IN' });
    await expect(
      s.staff.configure(
        f.bookingId,
        { expectedRevision: 2, checkInMode: 'NONE' },
        randomUUID(),
        f.couple,
      ),
    ).rejects.toMatchObject({ code: 'CHECK_IN_MODE_LOCKED' });
    const record = attempts[0];
    const reason = 'Sửa thao tác nhầm người';
    await s.journal.undo(
      f.bookingId,
      guest.guestId,
      { checkInRecordId: record.checkInRecordId, expectedLedgerRevision: 1, reason },
      randomUUID(),
      staff,
    );
    await expect(
      s.journal.undo(
        f.bookingId,
        guest.guestId,
        { checkInRecordId: record.checkInRecordId, expectedLedgerRevision: 1, reason },
        randomUUID(),
        staff,
      ),
    ).rejects.toMatchObject({ code: 'CHECK_IN_CORRECTION_CONFLICT' });
    await s.journal.checkIn(f.bookingId, guest.guestId, {}, randomUUID(), staff);
    await s.guests.guests.updateGroup(
      f.bookingId,
      group.guestGroupId,
      { expectedRevision: 1, name: 'Tên mới' },
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
    expect(await s.readers.getBookingAttendance(f.bookingId)).toMatchObject({
      checkInMode: 'BY_GUEST_NAME',
      measurementStatus: 'LISTED_GUESTS_ONLY',
      checkedInGuestCount: 1,
      byGuestGroup: [
        { guestGroupId: group.guestGroupId, groupNameSnapshot: group.name, checkedInGuestCount: 1 },
      ],
    });
    await expect(
      s.journal.checkIn(f.bookingId, guest.guestId, {}, randomUUID(), staff),
    ).rejects.toMatchObject({ code: 'GUEST_NOT_FOUND' });
    const latest = await s.readers.getGuestCheckIn(guest.guestId);
    expect(latest).toMatchObject({ checkedIn: true, ledgerRevision: 3 });
    await s.journal.undo(
      f.bookingId,
      guest.guestId,
      { checkInRecordId: latest.checkInRecordId!, expectedLedgerRevision: 3, reason },
      randomUUID(),
      staff,
    );
    expect((await s.readers.getBookingAttendance(f.bookingId)).checkedInGuestCount).toBe(0);
    expect(await db.prisma.staffCheckInRecord.count({ where: { bookingId: f.bookingId } })).toBe(4);
  });
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
  it('counts two distinct duplicate names, minimizes search, and publishes fenced absolute reports', async () => {
    const { f, staff, s, guest, group } = await enabledFixture();
    const second = await s.guests.guests.createGuest(
      f.bookingId,
      { guestGroupId: group.guestGroupId, name: guest.name },
      randomUUID(),
      f.couple,
    );
    const before = await s.journal.search(f.bookingId, { query: 'nguyễn' }, staff);
    expect((await s.journal.search(f.bookingId, { query: 'không-tồn-tại' }, staff)).items).toEqual(
      [],
    );
    expect(before).toMatchObject({
      guidanceStatus: 'ABSENT',
      items: [{ checkedIn: false }, { checkedIn: false }],
    });
    expect(JSON.stringify(before)).not.toContain('Private note');
    expect(JSON.stringify(before)).not.toContain('+84912345678');
    const writes = await Promise.allSettled([
      s.journal.checkIn(f.bookingId, guest.guestId, {}, randomUUID(), staff),
      s.journal.checkIn(f.bookingId, guest.guestId, {}, randomUUID(), staff),
      s.journal.checkIn(f.bookingId, second.guestId, {}, randomUUID(), staff),
    ]);
    expect(writes.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect((await s.readers.getBookingAttendance(f.bookingId)).checkedInGuestCount).toBe(2);
    const reportContext = {
      authority: 'SYSTEM' as const,
      actorAccountId: null,
      purpose: 'reporting:staff-operations',
      requestId: randomUUID(),
      causationId: randomUUID(),
    };
    const report = await s.readers.readPage(
      f.bookingId,
      { afterSequence: 0, limit: 1 },
      reportContext,
    );
    expect(report.rows[0]!.value.checkedInGuestCount).toBeNull();
    expect(report.nextAfterSequence).toBe(1);
    const tail = await s.readers.readPage(
      f.bookingId,
      { afterSequence: 1, throughSequence: report.throughSequence, limit: 50 },
      reportContext,
    );
    expect(tail.rows.at(-1)!.value.checkedInGuestCount).toBe(2);
    expect(
      JSON.stringify(await db.prisma.staffOutbox.findMany({ where: { bookingId: f.bookingId } })),
    ).not.toContain(guest.name);
    await expect(
      s.readers.readPage(
        f.bookingId,
        { afterSequence: 0, limit: 1 },
        { ...reportContext, authority: 'AUTHENTICATED', actorAccountId: f.manager.actorId },
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('denies unauthorized writes/undo and revoked replays; archive/check-in and mode races serialize', async () => {
    const { f, staff, s, guest, assignment } = await enabledFixture();
    await expect(
      s.journal.checkIn(f.bookingId, guest.guestId, {}, randomUUID(), f.couple),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      s.journal.checkIn(f.bookingId, guest.guestId, {}, randomUUID(), f.manager),
    ).rejects.toMatchObject({ code: 'MANAGER_OVERRIDE_REQUIRED' });
    const key = randomUUID(),
      record = await s.journal.checkIn(f.bookingId, guest.guestId, {}, key, staff);
    const other = await f.actor('STAFF');
    await db.prisma.session.updateMany({
      where: { id: other.sessionId },
      data: {
        idleExpiresAt: new Date(Date.now() + 20 * 86400000),
        absoluteExpiresAt: new Date(Date.now() + 20 * 86400000),
      },
    });
    await db.prisma.accessCredential.updateMany({
      where: { sessionId: other.sessionId },
      data: { expiresAt: new Date(Date.now() + 20 * 86400000) },
    });
    await s.staff.assign(
      f.bookingId,
      { staffAccountId: other.actorId, expectedRevision: 0 },
      randomUUID(),
      f.manager,
    );
    const undo = {
      checkInRecordId: record.checkInRecordId,
      expectedLedgerRevision: record.ledgerRevision,
      reason: 'Sửa thao tác check-in nhầm',
    };
    await expect(
      s.journal.undo(f.bookingId, guest.guestId, undo, randomUUID(), other),
    ).rejects.toMatchObject({ code: 'CHECK_IN_CORRECTION_FORBIDDEN' });
    await s.staff.revoke(
      f.bookingId,
      assignment.assignmentId,
      { expectedRevision: 1, reason: 'Thu hồi phân công sự kiện' },
      randomUUID(),
      f.manager,
    );
    await expect(
      s.journal.checkIn(f.bookingId, guest.guestId, {}, key, staff),
    ).rejects.toMatchObject({ code: 'EVENT_ASSIGNMENT_REQUIRED' });
    await s.journal.undo(
      f.bookingId,
      guest.guestId,
      { ...undo, overrideReason: 'Quản lý sửa ghi nhận sai người' },
      randomUUID(),
      f.manager,
    );
    const race = await Promise.allSettled([
      s.guests.guests.updateGuest(
        f.bookingId,
        guest.guestId,
        { expectedRevision: 1, status: 'ARCHIVED' },
        randomUUID(),
        f.couple,
      ),
      s.journal.checkIn(f.bookingId, guest.guestId, {}, randomUUID(), other),
    ]);
    expect(race[0].status).toBe('fulfilled');
    expect((await s.readers.getBookingAttendance(f.bookingId)).checkedInGuestCount).toBe(
      race[1].status === 'fulfilled' ? 1 : 0,
    );
    const x = await enabledFixture();
    await Promise.allSettled([
      x.staff && x.s.journal.checkIn(x.f.bookingId, x.guest.guestId, {}, randomUUID(), x.staff),
      x.s.staff.configure(
        x.f.bookingId,
        { expectedRevision: 2, checkInMode: 'NONE' },
        randomUUID(),
        x.f.couple,
      ),
    ]);
    const head = await db.prisma.staffConfiguration.findUniqueOrThrow({
      where: { bookingId: x.f.bookingId },
    });
    expect(
      head.checkInMode === 'NONE'
        ? head.ledgerRevision
        : (await x.s.readers.getBookingAttendance(x.f.bookingId)).checkedInGuestCount,
    ).toBe(head.checkInMode === 'NONE' ? 0 : 1);
  });
  it('requires a Manager reason for late operations, including completed events, and rejects future timestamps', async () => {
    const { f, staff, guest, clock } = await enabledFixture();
    const late = new Date(clock.getTime() + 18 * 3600000),
      expiry = new Date(late.getTime() + 86400000);
    await db.prisma.session.updateMany({
      where: { accountId: { in: [f.manager.actorId, staff.actorId] } },
      data: { idleExpiresAt: expiry, absoluteExpiresAt: expiry },
    });
    await db.prisma.accessCredential.updateMany({
      where: { session: { accountId: { in: [f.manager.actorId, staff.actorId] } } },
      data: { expiresAt: expiry },
    });
    const s = createStaffServices(db.prisma, () => late);
    await expect(
      s.journal.checkIn(f.bookingId, guest.guestId, {}, randomUUID(), staff),
    ).rejects.toMatchObject({ code: 'CHECK_IN_WINDOW_CLOSED' });
    await expect(
      s.journal.checkIn(
        f.bookingId,
        guest.guestId,
        { overrideReason: 'Không có quyền quản lý' },
        randomUUID(),
        staff,
      ),
    ).rejects.toMatchObject({ code: 'MANAGER_OVERRIDE_REQUIRED' });
    await db.prisma.booking.update({ where: { id: f.bookingId }, data: { phase: 'COMPLETED' } });
    await expect(
      s.journal.checkIn(
        f.bookingId,
        guest.guestId,
        { eventTime: expiry.toISOString(), overrideReason: 'Ghi nhận muộn có lý do' },
        randomUUID(),
        f.manager,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const record = await s.journal.checkIn(
      f.bookingId,
      guest.guestId,
      { overrideReason: 'Ghi nhận muộn có lý do' },
      randomUUID(),
      f.manager,
    );
    await s.journal.undo(
      f.bookingId,
      guest.guestId,
      {
        checkInRecordId: record.checkInRecordId,
        expectedLedgerRevision: record.ledgerRevision,
        reason: 'Sửa ghi nhận muộn sai người',
        overrideReason: 'Quản lý sửa sau sự kiện',
      },
      randomUUID(),
      f.manager,
    );
    expect((await s.readers.getBookingAttendance(f.bookingId)).checkedInGuestCount).toBe(0);
  });
  it('uses real Seating Group guidance with validated Staff scope and retains first grouping after Guest moves', async () => {
    const { f, staff, guest, group, clock } = await enabledFixture();
    const { staff: s, seating } = createStaffSeatingServices(db.prisma, f.services, () => clock);
    const defaultComposition = createStaffSeatingServices(db.prisma, f.services);
    expect(await defaultComposition.staff.staff.settings(f.bookingId, f.couple)).toMatchObject({
      checkInMode: 'BY_GUEST_NAME',
    });
    expect((await s.journal.search(f.bookingId, { query: 'nguyễn' }, staff)).guidanceStatus).toBe(
      'ABSENT',
    );
    const plan = await seating.seating.select(
      f.bookingId,
      { layoutTemplateVersionId: f.layoutId, expectedBookingRevision: 1 },
      randomUUID(),
      f.couple,
    );
    await seating.seating.revise(
      f.bookingId,
      plan.seatingPlanId,
      {
        expectedRevision: 1,
        labels: [
          {
            layoutTableId: plan.renderSnapshot[0]!.layoutTableId,
            guestGroupId: group.guestGroupId,
          },
        ],
      },
      randomUUID(),
      f.couple,
    );
    expect(
      (await s.journal.search(f.bookingId, { query: 'nguyễn' }, staff)).items[0]!.tableLabels,
    ).toEqual(['T1']);
    const record = await s.journal.checkIn(f.bookingId, guest.guestId, {}, randomUUID(), staff);
    const groups = await s.guests.guests.groups(f.bookingId, f.couple),
      newGroup = groups.find((g) => g.guestGroupId !== group.guestGroupId)!;
    await s.guests.guests.updateGuest(
      f.bookingId,
      guest.guestId,
      { expectedRevision: 1, guestGroupId: newGroup.guestGroupId },
      randomUUID(),
      f.couple,
    );
    expect(
      (await s.journal.search(f.bookingId, { query: 'nguyễn' }, staff)).items[0],
    ).toMatchObject({ warning: 'GUEST_GROUP_CHANGED', tableLabels: [] });
    await s.journal.undo(
      f.bookingId,
      guest.guestId,
      {
        checkInRecordId: record.checkInRecordId,
        expectedLedgerRevision: record.ledgerRevision,
        reason: 'Sửa nhầm Guest trong Group',
      },
      randomUUID(),
      staff,
    );
    const next = await s.journal.checkIn(f.bookingId, guest.guestId, {}, randomUUID(), staff);
    expect(next.guestGroupId).toBe(group.guestGroupId);
    expect((await s.readers.getBookingAttendance(f.bookingId)).byGuestGroup[0]!.guestGroupId).toBe(
      group.guestGroupId,
    );
    await s.staff.run(
      f.bookingId,
      staff,
      async () => {},
      async (_tx, scope) => {
        await expect(seating.seating.getGuidance(f.bookingId, scope)).rejects.toMatchObject({
          status: 404,
        });
      },
    );
  });
  it('rolls back journal/outbox/report on provider failure and rejects history mutation', async () => {
    const { f, staff, s, guest } = await enabledFixture();
    const fail = vi.spyOn(s.journal, 'snapshot').mockRejectedValueOnce(Error('report unavailable'));
    await expect(
      s.journal.checkIn(f.bookingId, guest.guestId, {}, randomUUID(), staff),
    ).rejects.toThrow('report unavailable');
    fail.mockRestore();
    expect(await db.prisma.staffCheckInRecord.count({ where: { bookingId: f.bookingId } })).toBe(0);
    expect(await db.prisma.staffOutbox.count({ where: { bookingId: f.bookingId } })).toBe(0);
    const record = await s.journal.checkIn(f.bookingId, guest.guestId, {}, randomUUID(), staff);
    await expect(
      db.prisma.staffCheckInRecord.delete({ where: { id: record.checkInRecordId } }),
    ).rejects.toThrow('immutable');
    await expect(
      db.prisma.staffConfiguration.update({
        where: { bookingId: f.bookingId },
        data: { checkInMode: 'NONE' },
      }),
    ).rejects.toThrow('cannot be hidden');
  });
  it('retires HTTP check-in/search/undo for all authenticated roles and retains journal evidence', async () => {
    const { f, s, staff, guest } = await enabledFixture();
    const record = await s.journal.checkIn(f.bookingId, guest.guestId, {}, randomUUID(), staff);
    const app = createApp({
      runtimeEnvironment: 'test',
      registerRoutes: (e) => e.use('/api/v1', createStaffRouter(s)),
    });
    const path = `/api/v1/staff/events/${f.bookingId}/guests/${guest.guestId}`;
    for (const actor of [f.manager, f.couple, staff]) {
      for (const response of [
        await request(app)
          .post(path + '/check-ins')
          .auth(actor.accessToken, { type: 'bearer' })
          .send({}),
        await request(app)
          .post(path + '/check-in-undos')
          .auth(actor.accessToken, { type: 'bearer' })
          .send({}),
        await request(app)
          .get(`/api/v1/staff/events/${f.bookingId}/guests/search?query=nguyễn`)
          .auth(actor.accessToken, { type: 'bearer' }),
      ]) {
        expect(response.status).toBe(410);
        expect(errorResponseSchema.parse(response.body).error.code).toBe('FEATURE_RETIRED');
      }
    }
    expect(
      await db.prisma.staffCheckInRecord.findUnique({ where: { id: record.checkInRecordId } }),
    ).not.toBeNull();
  });
  it('serves the complete Manager/settings/summary HTTP workflow and disabled-mode denials', async () => {
    const f = await studioFixture(db.prisma),
      s = createStaffServices(db.prisma, () => f.now);
    const app = createApp({
      runtimeEnvironment: 'test',
      registerRoutes: (e) => e.use('/api/v1', createStaffRouter(s)),
    });
    const managerPost = (path: string, body: object) =>
      request(app)
        .post('/api/v1' + path)
        .set('Authorization', `Bearer ${f.manager.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send(body);
    const provisioned = await managerPost('/management/staff-accounts', {
      email: `${randomUUID()}@example.test`,
    }).expect(201);
    const accountId = z
      .strictObject({
        data: z.strictObject({ accountId: z.uuid(), credentialSetupRequired: z.boolean() }),
      })
      .parse(provisioned.body).data.accountId;
    const assigned = await managerPost(`/management/events/${f.bookingId}/assignments`, {
      staffAccountId: accountId,
      expectedRevision: 0,
    }).expect(201);
    const assignment = z
      .strictObject({
        data: z.strictObject({
          assignmentId: z.uuid(),
          bookingId: z.uuid(),
          staffAccountId: z.uuid(),
          status: z.enum(['ACTIVE', 'REVOKED']),
          revision: z.int(),
        }),
      })
      .parse(assigned.body).data;
    const list = await request(app)
      .get(`/api/v1/management/events/${f.bookingId}/assignments`)
      .set('Authorization', `Bearer ${f.manager.accessToken}`)
      .expect(200);
    expect(z.strictObject({ data: z.array(z.unknown()) }).parse(list.body).data).toHaveLength(1);
    await managerPost(
      `/management/events/${f.bookingId}/assignments/${assignment.assignmentId}/revocation`,
      { expectedRevision: 1, reason: 'Thu hồi nhiệm vụ đã phân công' },
    ).expect(201);
    await managerPost(`/management/staff-accounts/${accountId}/operational-access`, {
      enabled: false,
      reason: 'Tắt quyền vận hành của nhân viên',
    }).expect(201);
    const summary = await request(app)
      .get(`/api/v1/bookings/${f.bookingId}/attendance-summary`)
      .set('Authorization', `Bearer ${f.couple.accessToken}`)
      .expect(200);
    expect(JSON.stringify(summary.body)).toContain('NOT_RECORDED');
    await request(app)
      .patch(`/api/v1/bookings/${f.bookingId}/check-in-settings`)
      .set('Authorization', `Bearer ${f.couple.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ checkInMode: 'NONE', expectedRevision: 1 })
      .expect(410);
    const newStaff = await f.actor('STAFF');
    await s.staff.assign(
      f.bookingId,
      { staffAccountId: newStaff.actorId, expectedRevision: 0 },
      randomUUID(),
      f.manager,
    );
    const disabled = await request(app)
      .get(`/api/v1/staff/events/${f.bookingId}/guests/search?query=nguyễn`)
      .set('Authorization', `Bearer ${newStaff.accessToken}`);
    expect(errorResponseSchema.parse(disabled.body).error.code).toBe('FEATURE_RETIRED');
  });
  it('serializes undo and operational disable against check-in, with current role/session rechecked', async () => {
    const x = await enabledFixture();
    const record = await x.s.journal.checkIn(
      x.f.bookingId,
      x.guest.guestId,
      {},
      randomUUID(),
      x.staff,
    );
    const undo = {
      checkInRecordId: record.checkInRecordId,
      expectedLedgerRevision: record.ledgerRevision,
      reason: 'Sửa thao tác nhầm Guest',
    };
    const corrections = await Promise.allSettled([
      x.s.journal.undo(x.f.bookingId, x.guest.guestId, undo, randomUUID(), x.staff),
      x.s.journal.undo(x.f.bookingId, x.guest.guestId, undo, randomUUID(), x.staff),
    ]);
    expect(corrections.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await x.s.readers.getBookingAttendance(x.f.bookingId)).checkedInGuestCount).toBe(0);
    const race = await Promise.allSettled([
      x.s.journal.checkIn(x.f.bookingId, x.guest.guestId, {}, randomUUID(), x.staff),
      x.s.accounts.setOperationalAccess(
        x.staff.actorId,
        { enabled: false, reason: 'Kết thúc quyền vận hành Staff' },
        randomUUID(),
        x.f.manager,
      ),
    ]);
    expect(race[1].status).toBe('fulfilled');
    expect((await x.s.readers.getBookingAttendance(x.f.bookingId)).checkedInGuestCount).toBe(
      race[0].status === 'fulfilled' ? 1 : 0,
    );
    await expect(
      x.s.journal.search(x.f.bookingId, { query: 'nguyễn' }, x.staff),
    ).rejects.toMatchObject({ status: 401 });
  });
  it('mounts the actual production runtime Staff router and closes the shared native database resource', async () => {
    const { f } = await enabledFixture();
    const url = new URL(catalogMigrationDatabaseUrl!);
    url.pathname = '/' + db.databaseName;
    const config = parseEnvironment({ NODE_ENV: 'test', DATABASE_URL: url.toString() });
    const runtime = await createInvitationStudioRuntime(config);
    try {
      const app = createApp({
        runtimeEnvironment: 'test',
        registerRoutes: (e) => e.use('/api/v1', runtime.router),
      });
      const response = await request(app)
        .get(`/api/v1/bookings/${f.bookingId}/check-in-settings`)
        .set('Authorization', `Bearer ${f.couple.accessToken}`)
        .expect(410);
      expect(errorResponseSchema.parse(response.body).error.code).toBe('FEATURE_RETIRED');
      expect(
        (await runtime.providers.attendance.getBookingAttendance(f.bookingId)).checkedInGuestCount,
      ).toBe(0);
    } finally {
      await runtime.resource.close();
    }
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
    await expect(
      s.accounts.provision('valid@example.test', 'x'.repeat(129), f.manager),
    ).rejects.toMatchObject({ code: 'INVALID_IDEMPOTENCY_KEY' });
    const managerAccount = await db.prisma.account.findUniqueOrThrow({
      where: { id: f.manager.actorId },
    });
    await expect(
      s.accounts.provision(managerAccount.emailNormalized, randomUUID(), f.manager),
    ).rejects.toMatchObject({ status: 404 });
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
