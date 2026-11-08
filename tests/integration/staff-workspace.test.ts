import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';
import { createStaffServices } from '../../src/modules/staff-operations/infrastructure/staff.composition.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'assigned events without named guests',
  () => {
    const db = new CatalogTestDatabase('staff_workspace');
    beforeAll(() => db.connect(), 60000);
    afterAll(() => db.disconnect());
    async function fixture() {
      const f = await studioFixture(db.prisma);
      const staff = await f.actor('STAFF'),
        other = await f.actor('STAFF');
      const s = createStaffServices(db.prisma);
      const assignment = await s.staff.assign(
        f.bookingId,
        { staffAccountId: staff.actorId, expectedRevision: 0 },
        randomUUID(),
        f.manager,
      );
      await s.staff.assign(
        f.bookingId,
        { staffAccountId: other.actorId, expectedRevision: 0 },
        randomUUID(),
        f.manager,
      );
      return { ...f, staff, other, s, assignment };
    }
    it('reads operational facts and lists only assigned events with no guests or check-in configuration', async () => {
      const f = await fixture();
      const view = await f.s.workspace.read(f.bookingId, f.staff);
      expect(view).toMatchObject({
        planningHeadcount: 20,
        operations: { phase: 'CONFIRMED', tableCount: 2 },
      });
      expect(view.operations.offerings[0]).toMatchObject({ category: 'MENU', quantity: 2 });
      expect(view).not.toHaveProperty('settings');
      expect(view).not.toHaveProperty('attendance');
      expect(view).not.toHaveProperty('listedGuestCount');
      expect(JSON.stringify(view)).not.toMatch(
        /unitPriceVnd|lineTotalVnd|depositAmountVnd|contractTotalVnd/u,
      );
      expect(await db.prisma.guest.count({ where: { bookingId: f.bookingId } })).toBe(0);
      expect(await db.prisma.staffConfiguration.count({ where: { bookingId: f.bookingId } })).toBe(
        0,
      );
      expect((await f.s.workspace.list({}, f.staff)).items.map((e) => e.bookingId)).toEqual([
        f.bookingId,
      ]);
      const outsider = await f.actor('STAFF');
      expect((await f.s.workspace.list({}, outsider)).items).toEqual([]);
      await expect(f.s.workspace.read(f.bookingId, outsider)).rejects.toMatchObject({
        code: 'EVENT_ASSIGNMENT_REQUIRED',
      });
      await expect(f.s.workspace.read(f.bookingId, f.couple)).rejects.toMatchObject({
        status: 404,
      });
    });
    it('preserves task ownership, revisions, durable retry and immutable history', async () => {
      const f = await fixture();
      const body = {
        kind: 'TASK',
        title: 'Chuẩn bị sân khấu',
        description: 'Kiểm tra âm thanh',
        assignedAccountId: f.staff.actorId,
      };
      await expect(
        f.s.workspace.create(f.bookingId, body, randomUUID(), f.staff),
      ).rejects.toMatchObject({ code: 'STAFF_WORK_ACTION_FORBIDDEN' });
      const key = randomUUID();
      const item = await f.s.workspace.create(f.bookingId, body, key, f.manager);
      expect(await f.s.workspace.create(f.bookingId, body, key, f.manager)).toEqual(item);
      const update = { expectedRevision: 1, status: 'IN_PROGRESS', note: 'Đang kiểm tra thiết bị' };
      await expect(
        f.s.workspace.update(f.bookingId, item.id, update, randomUUID(), f.other),
      ).rejects.toMatchObject({ code: 'STAFF_WORK_ACTION_FORBIDDEN' });
      const saved = await f.s.workspace.update(f.bookingId, item.id, update, randomUUID(), f.staff);
      expect(saved.revision).toBe(2);
      await expect(
        f.s.workspace.update(f.bookingId, item.id, update, randomUUID(), f.staff),
      ).rejects.toMatchObject({ code: 'STAFF_WORK_REVISION_STALE' });
      await f.s.workspace.update(
        f.bookingId,
        item.id,
        { expectedRevision: 2, status: 'DONE', note: 'Đã hoàn tất kiểm tra' },
        randomUUID(),
        f.staff,
      );
      await expect(
        f.s.workspace.update(
          f.bookingId,
          item.id,
          { expectedRevision: 3, status: 'OPEN', note: 'Mở lại' },
          randomUUID(),
          f.staff,
        ),
      ).rejects.toMatchObject({ code: 'STAFF_WORK_ACTION_FORBIDDEN' });
      expect(
        (await f.s.workspace.history(f.bookingId, item.id, {}, f.staff)).items.map(
          (h) => h.revision,
        ),
      ).toEqual([1, 2, 3]);
    });
    it('lets Staff report incidents while Manager accepts and resolves them', async () => {
      const f = await fixture();
      const item = await f.s.workspace.create(
        f.bookingId,
        {
          kind: 'INCIDENT',
          title: 'Thiếu micro',
          description: 'Micro sân khấu chưa hoạt động',
          priority: 'URGENT',
        },
        randomUUID(),
        f.staff,
      );
      const body = { expectedRevision: 1, status: 'DONE', note: 'Đã xử lý' };
      await expect(
        f.s.workspace.update(f.bookingId, item.id, body, randomUUID(), f.staff),
      ).rejects.toMatchObject({ code: 'STAFF_WORK_ACTION_FORBIDDEN' });
      expect(
        (await f.s.workspace.update(f.bookingId, item.id, body, randomUUID(), f.manager)).status,
      ).toBe('DONE');
    });
    it('only allows the addressed recipient to acknowledge a handover, once', async () => {
      const f = await fixture();
      const item = await f.s.workspace.create(
        f.bookingId,
        {
          kind: 'HANDOVER',
          title: 'Bàn giao âm thanh',
          description: 'Thiết bị đã được kiểm tra',
          assignedAccountId: f.other.actorId,
        },
        randomUUID(),
        f.staff,
      );
      const body = { expectedRevision: 1, status: 'DONE', note: 'Đã nhận thông tin bàn giao' };
      await expect(
        f.s.workspace.update(f.bookingId, item.id, body, randomUUID(), f.staff),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        f.s.workspace.update(f.bookingId, item.id, body, randomUUID(), f.manager),
      ).rejects.toMatchObject({ code: 'STAFF_HANDOVER_ACK_REQUIRED' });
      expect(
        (await f.s.workspace.update(f.bookingId, item.id, body, randomUUID(), f.other)).status,
      ).toBe('DONE');
      await expect(
        f.s.workspace.update(
          f.bookingId,
          item.id,
          { ...body, expectedRevision: 2 },
          randomUUID(),
          f.other,
        ),
      ).rejects.toMatchObject({ status: 403 });
      const general = await f.s.workspace.create(
        f.bookingId,
        {
          kind: 'HANDOVER',
          title: 'Bàn giao cho quản lý',
          description: 'Cần kiểm tra thiết bị dự phòng',
        },
        randomUUID(),
        f.staff,
      );
      await expect(
        f.s.workspace.update(
          f.bookingId,
          general.id,
          { ...body, assignedAccountId: f.other.actorId },
          randomUUID(),
          f.manager,
        ),
      ).rejects.toMatchObject({ code: 'STAFF_HANDOVER_ACK_REQUIRED' });
      expect(
        (await f.s.workspace.update(f.bookingId, general.id, body, randomUUID(), f.manager)).status,
      ).toBe('DONE');
    });
    it('revocation denies workspace, work history and command replay and hides the event', async () => {
      const f = await fixture();
      const key = randomUUID(),
        body = {
          kind: 'INCIDENT',
          title: 'Sự cố trước thu hồi',
          description: 'Lưu lịch sử tác nghiệp',
        };
      const item = await f.s.workspace.create(f.bookingId, body, key, f.staff);
      await f.s.staff.revoke(
        f.bookingId,
        f.assignment.assignmentId,
        { expectedRevision: 1, reason: 'Điều chuyển nhân sự sang ca khác' },
        randomUUID(),
        f.manager,
      );
      for (const result of [
        () => f.s.workspace.read(f.bookingId, f.staff),
        () => f.s.workspace.page(f.bookingId, {}, f.staff),
        () => f.s.workspace.history(f.bookingId, item.id, {}, f.staff),
        () => f.s.workspace.create(f.bookingId, body, key, f.staff),
      ])
        await expect(result()).rejects.toMatchObject({ code: 'EVENT_ASSIGNMENT_REQUIRED' });
      expect((await f.s.workspace.list({}, f.staff)).items).toEqual([]);
      expect(await db.prisma.staffWorkItem.count({ where: { bookingId: f.bookingId } })).toBe(1);
    });
    it('allows group archival with retained named data without changing planning or check-in history', async () => {
      const f = await fixture();
      const group = (await f.s.guests.guests.groups(f.bookingId, f.couple))[0]!;
      const old = await f.s.guests.guests.createGuest(
        f.bookingId,
        { name: 'Retained historical identity', guestGroupId: group.guestGroupId },
        randomUUID(),
        f.couple,
      );
      expect(
        (
          await f.s.guests.guests.updateGroup(
            f.bookingId,
            group.guestGroupId,
            { expectedRevision: group.revision, status: 'ARCHIVED' },
            randomUUID(),
            f.couple,
          )
        ).status,
      ).toBe('ARCHIVED');
      expect(await db.prisma.guest.findUnique({ where: { id: old.guestId } })).toMatchObject({
        name: 'Retained historical identity',
      });
      expect((await f.s.guests.guests.plan(f.bookingId, f.couple)).planningHeadcount).toBe(20);
    });
  },
);
