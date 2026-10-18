import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { z } from 'zod';
import {
  result,
  page,
  preferencesDto,
  installationDto,
  inboxDto,
  statusDto,
} from '../../src/modules/notifications-automation/http/notification.schemas.js';
const countResult = result(z.strictObject({ count: z.int().nonnegative() }));
const readAllResult = result(
  z.strictObject({ count: z.int().nonnegative(), throughCreatedAt: z.iso.datetime() }),
);
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';
import { createApp } from '../../src/app.js';
import { createGuestServices } from '../../src/modules/guest-management/infrastructure/guest.composition.js';
import { NotificationFoundation } from '../../src/modules/notifications-automation/infrastructure/notification-foundation.js';
import { NotificationSettings } from '../../src/modules/notifications-automation/application/notification-settings.js';
import { createNotificationRouter } from '../../src/modules/notifications-automation/http/notification.router.js';
import { createNotificationBookingReader } from '../../src/modules/booking-lifecycle/infrastructure/notification-context.reader.js';
import { createPrismaSessionRepository } from '../../src/modules/identity-access/session/session.repository.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)('notification private HTTP APIs', () => {
  const db = new CatalogTestDatabase('notification_http');
  beforeAll(() => db.connect(), 60000);
  afterAll(() => db.disconnect());
  it('PERF-08 conceals populated inbox data after access is revoked during the read', async () => {
    const f = await studioFixture(db.prisma),
      guests = createGuestServices(db.prisma, () => f.now);
    const foundation = new NotificationFoundation(db.prisma, () => f.now);
    const settings = new NotificationSettings(
      foundation,
      guests.identity.resolver,
      createNotificationBookingReader(db.prisma),
    );
    const recipient = await db.prisma.notificationRecipient.create({
      data: { accountId: f.couple.actorId, purposes: ['CONTRACT'] },
    });
    const intent = await foundation.enqueue({
      eventId: randomUUID(),
      owner: 'booking-lifecycle',
      bookingId: f.bookingId,
      recipientId: recipient.id,
      channel: 'IN_APP',
      purpose: 'CONTRACT',
      templateVersion: 1,
      scheduledAt: f.now.toISOString(),
      data: {},
    });
    await db.prisma.notificationInbox.create({
      data: { intentId: intent.id, accountId: f.couple.actorId, bookingId: f.bookingId },
    });
    expect((await settings.inbox(f.couple.accessToken, {})).items).toHaveLength(1);
    expect(await settings.unread(f.couple.accessToken)).toEqual({ count: 1 });
    const read = settings.inboxReader.page.bind(settings.inboxReader);
    const pending = vi.spyOn(settings.inboxReader, 'page').mockImplementationOnce((...args) => {
      const result = read(...args);
      return result.then(async (rows) => {
        await db.prisma.consultationAccess.deleteMany({
          where: { consultationId: f.consultationId, accountId: f.couple.actorId },
        });
        return rows;
      });
    });
    try {
      await expect(settings.inbox(f.couple.accessToken, {})).rejects.toMatchObject({ status: 404 });
    } finally {
      pending.mockRestore();
    }
    expect(await settings.unread(f.couple.accessToken)).toEqual({ count: 0 });
    const app = createApp({
      runtimeEnvironment: 'test',
      registerRoutes: (a) => a.use('/api/v1', createNotificationRouter(settings, guests, null)),
    });
    for (const route of ['inbox', 'unread-count']) {
      expect((await request(app).get('/api/v1/notifications/' + route)).status).toBe(401);
      expect(
        (
          await request(app)
            .get('/api/v1/notifications/' + route)
            .set('Authorization', 'Basic invalid')
        ).status,
      ).toBe(401);
    }
  });
  it('PERF-08 avoids an empty role transaction and rechecks revocation during inbox reads', async () => {
    const f = await studioFixture(db.prisma),
      guests = createGuestServices(db.prisma, () => f.now);
    const settings = new NotificationSettings(
      new NotificationFoundation(db.prisma, () => f.now),
      guests.identity.resolver,
      createNotificationBookingReader(db.prisma),
    );
    const transaction = vi.spyOn(db.prisma, '$transaction');
    try {
      expect(await settings.unread(f.couple.accessToken)).toEqual({ count: 0 });
      expect(transaction).not.toHaveBeenCalled();
    } finally {
      transaction.mockRestore();
    }
    const read = settings.inboxReader.page.bind(settings.inboxReader);
    const pending = vi.spyOn(settings.inboxReader, 'page').mockImplementationOnce((...args) => {
      const result = read(...args);
      return result.then(async (rows) => {
        await db.prisma.session.update({
          where: { id: f.couple.sessionId },
          data: { status: 'REVOKED' },
        });
        return rows;
      });
    });
    try {
      await expect(settings.inbox(f.couple.accessToken, {})).rejects.toMatchObject({ status: 401 });
    } finally {
      pending.mockRestore();
    }
  });
  it('isolates settings/devices, revalidates replays and never returns destinations or tokens', async () => {
    const f = await studioFixture(db.prisma),
      guests = createGuestServices(db.prisma, () => f.now);
    const foundation = new NotificationFoundation(db.prisma, () => f.now);
    const settings = new NotificationSettings(
      foundation,
      guests.identity.resolver,
      createNotificationBookingReader(db.prisma),
    );
    let unexpected = '';
    const app = createApp({
      runtimeEnvironment: 'test',
      reportUnexpectedError: (error) => {
        unexpected = error instanceof Error ? error.message : 'unexpected';
      },
      registerRoutes: (a) => a.use('/api/v1', createNotificationRouter(settings, guests, null)),
    });
    const auth = (actor = f.couple) => `Bearer ${actor.accessToken}`;
    const base = '/api/v1/notifications';
    expect((await request(app).get(base + '/preferences')).status).toBe(401);
    const staff = await f.actor('STAFF');
    expect(
      (
        await request(app)
          .get(base + '/preferences')
          .set('Authorization', auth(staff))
      ).status,
    ).toBe(403);
    expect(
      (await request(app).get('/api/v1/management/notifications').set('Authorization', auth()))
        .status,
    ).toBe(403);
    const initial = await request(app)
      .get(base + '/preferences')
      .set('Authorization', auth());
    expect(result(preferencesDto).parse(initial.body).data).toEqual({
      revision: 0,
      reminderEmail: true,
      reminderPush: true,
    });
    const key = randomUUID();
    const write = () =>
      request(app)
        .patch(base + '/preferences')
        .set('Authorization', auth())
        .set('Idempotency-Key', key)
        .send({ expectedRevision: 0, reminderEmail: false });
    const changed = await write();
    expect(changed.status, unexpected).toBe(200);
    expect((await write()).body).toEqual(changed.body);
    expect(
      (
        await request(app)
          .patch(base + '/preferences')
          .set('Authorization', auth())
          .set('Idempotency-Key', key)
          .send({ expectedRevision: 0, reminderEmail: true })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .patch(base + '/preferences')
          .set('Authorization', auth())
          .set('Idempotency-Key', randomUUID())
          .send({ expectedRevision: 1, reminderEmail: true, accountId: f.manager.actorId })
      ).status,
    ).toBe(422);
    const install = {
      installationId: randomUUID(),
      expectedRevision: 0,
      pushToken: 'private-token-for-test',
    };
    expect(
      (
        await request(app)
          .post(base + '/android-installations')
          .set('Authorization', auth())
          .set('Idempotency-Key', randomUUID())
          .send(install)
      ).status,
    ).toBe(403);
    const registration = () =>
      request(app)
        .post(base + '/android-installations')
        .set('Authorization', auth(f.android))
        .set('Idempotency-Key', key)
        .send(install);
    const registered = await registration();
    expect(registered.status).toBe(201);
    expect(JSON.stringify(registered.body)).not.toContain(install.pushToken);
    expect((await registration()).body).toEqual(registered.body);
    const second = await request(app)
      .post(base + '/android-installations')
      .set('Authorization', auth(f.android))
      .set('Idempotency-Key', randomUUID())
      .send({ ...install, expectedRevision: 1, pushToken: 'replacement-private-token' });
    expect(second.status).toBe(201);
    expect(result(installationDto).parse(second.body).data.id).toBe(
      result(installationDto).parse(registered.body).data.id,
    );
    for (let n = 0; n < 4; n++)
      expect(
        (
          await request(app)
            .post(base + '/android-installations')
            .set('Authorization', auth(f.android))
            .set('Idempotency-Key', randomUUID())
            .send({
              installationId: randomUUID(),
              expectedRevision: 0,
              pushToken: 'private-extra-token-' + n,
            })
        ).status,
      ).toBe(201);
    expect(
      (
        await request(app)
          .post(base + '/android-installations')
          .set('Authorization', auth(f.android))
          .set('Idempotency-Key', randomUUID())
          .send({ installationId: randomUUID(), expectedRevision: 0, pushToken: 'sixth-token' })
      ).status,
    ).toBe(409);
    const revoked = await request(app)
      .delete(
        base + '/android-installations/' + result(installationDto).parse(registered.body).data.id,
      )
      .set('Authorization', auth(f.android))
      .set('Idempotency-Key', randomUUID())
      .send({ expectedRevision: 2 });
    expect(result(installationDto).parse(revoked.body).data.enabled).toBe(false);
    await createPrismaSessionRepository(db.prisma).revokeSession({
      sessionId: f.android.sessionId,
      accountId: f.android.actorId,
      reason: 'notification-conformance',
      now: f.now,
    });
    expect((await registration()).status).toBe(401);
    const registry = await request(app)
      .patch('/api/v1/management/notifications/recipient')
      .set('Authorization', auth(f.manager))
      .set('Idempotency-Key', randomUUID())
      .send({
        expectedRevision: 0,
        enabled: true,
        purposes: ['PAYMENT'],
        intendedEmail: 'authorized@example.invalid',
      });
    expect(registry.status).toBe(200);
    expect(JSON.stringify(registry.body)).not.toContain('authorized@example.invalid');
  }, 30000);
  it('keeps inbox reads separate from delivery and requeues only the same known dead-letter intent with audit', async () => {
    const f = await studioFixture(db.prisma),
      guests = createGuestServices(db.prisma, () => f.now);
    let clock = f.now;
    const foundation = new NotificationFoundation(db.prisma, () => clock);
    const settings = new NotificationSettings(
      foundation,
      guests.identity.resolver,
      createNotificationBookingReader(db.prisma),
    );
    const app = createApp({
      runtimeEnvironment: 'test',
      registerRoutes: (a) => a.use('/api/v1', createNotificationRouter(settings, guests, null)),
    });
    const auth = (actor = f.couple) => `Bearer ${actor.accessToken}`;
    const recipient = await db.prisma.notificationRecipient.create({
      data: { accountId: f.couple.actorId, purposes: ['CONTRACT'] },
    });
    const input = {
      eventId: randomUUID(),
      owner: 'booking-lifecycle',
      bookingId: f.bookingId,
      recipientId: recipient.id,
      channel: 'IN_APP',
      purpose: 'CONTRACT',
      templateVersion: 1,
      scheduledAt: clock.toISOString(),
      data: {},
    };
    const intent = await foundation.enqueue(input);
    const inbox = await db.prisma.notificationInbox.create({
      data: {
        intentId: intent.id,
        accountId: f.couple.actorId,
        bookingId: f.bookingId,
        createdAt: clock,
      },
    });
    const [claim] = (await foundation.claimDue(100)).filter((i) => i.id === intent.id);
    await foundation.recordOutcome(intent.id, claim!.leaseId!, 'DELIVERED', {});
    const base = '/api/v1/notifications';
    const listed = await request(app)
      .get(base + '/inbox')
      .set('Authorization', auth());
    expect(listed.status).toBe(200);
    expect(result(page(inboxDto)).parse(listed.body).data.items).toHaveLength(1);
    expect(JSON.stringify(listed.body)).not.toMatch(
      /displayEmail|recipientId|leaseId|pushToken|ciphertext/iu,
    );
    expect(
      countResult.parse(
        (
          await request(app)
            .get(base + '/unread-count')
            .set('Authorization', auth())
        ).body,
      ).data.count,
    ).toBe(1);
    const foreign = await f.actor('COUPLE');
    expect(
      result(page(inboxDto)).parse(
        (
          await request(app)
            .get(base + '/inbox')
            .set('Authorization', auth(foreign))
        ).body,
      ).data.items,
    ).toEqual([]);
    expect(
      (
        await request(app)
          .post(base + '/inbox/' + inbox.id + '/read')
          .set('Authorization', auth(foreign))
          .set('Idempotency-Key', randomUUID())
          .send({ expectedRevision: 1 })
      ).status,
    ).toBe(404);
    const readKey = randomUUID(),
      read = () =>
        request(app)
          .post(base + '/inbox/' + inbox.id + '/read')
          .set('Authorization', auth())
          .set('Idempotency-Key', readKey)
          .send({ expectedRevision: 1 });
    const firstRead = await read();
    expect(firstRead.status).toBe(200);
    expect((await read()).body).toEqual(firstRead.body);
    expect(
      countResult.parse(
        (
          await request(app)
            .get(base + '/unread-count')
            .set('Authorization', auth())
        ).body,
      ).data.count,
    ).toBe(0);
    expect(
      (await db.prisma.notificationIntent.findUniqueOrThrow({ where: { id: intent.id } })).state,
    ).toBe('DELIVERED');
    const second = await foundation.enqueue({ ...input, eventId: randomUUID() });
    await db.prisma.notificationInbox.create({
      data: {
        intentId: second.id,
        accountId: f.couple.actorId,
        bookingId: f.bookingId,
        createdAt: clock,
      },
    });
    const fence = clock.toISOString();
    clock = new Date(clock.getTime() + 1000);
    const third = await foundation.enqueue({ ...input, eventId: randomUUID() });
    await db.prisma.notificationInbox.create({
      data: {
        intentId: third.id,
        accountId: f.couple.actorId,
        bookingId: f.bookingId,
        createdAt: clock,
      },
    });
    const allKey = randomUUID(),
      all = () =>
        request(app)
          .post(base + '/inbox/read-all')
          .set('Authorization', auth())
          .set('Idempotency-Key', allKey)
          .send({ throughCreatedAt: fence });
    const allRead = await all();
    expect(readAllResult.parse(allRead.body).data.count).toBe(1);
    expect((await all()).body).toEqual(allRead.body);
    expect(
      countResult.parse(
        (
          await request(app)
            .get(base + '/unread-count')
            .set('Authorization', auth())
        ).body,
      ).data.count,
    ).toBe(1);
    const failed = await foundation.enqueue({ ...input, eventId: randomUUID(), channel: 'EMAIL' });
    const claimed = (await foundation.claimDue(100)).find((i) => i.id === failed.id)!;
    const dead = await foundation.recordOutcome(failed.id, claimed.leaseId!, 'DEAD_LETTER', {
      errorCode: 'EMAIL_NOT_CONFIGURED',
    });
    const requeueKey = randomUUID(),
      requeue = () =>
        request(app)
          .post('/api/v1/management/notifications/' + failed.id + '/requeue')
          .set('Authorization', auth(f.manager))
          .set('Idempotency-Key', requeueKey)
          .send({ expectedRevision: dead.revision, reason: 'Đã sửa cấu hình email' });
    const retried = await requeue();
    expect(retried.status).toBe(200);
    expect(result(statusDto).parse(retried.body).data).toMatchObject({
      id: failed.id,
      state: 'QUEUED',
      attemptCount: 0,
    });
    expect((await requeue()).body).toEqual(retried.body);
    expect(await db.prisma.notificationIntent.count({ where: { eventId: failed.eventId } })).toBe(
      1,
    );
    expect(
      await db.prisma.auditLog.count({
        where: {
          action: 'notification.requeue-reason',
          entityId: failed.id,
          actorId: f.manager.actorId,
        },
      }),
    ).toBe(1);
    const unknown = await foundation.enqueue({ ...input, eventId: randomUUID(), channel: 'EMAIL' });
    const uncertain = (await foundation.claimDue(100)).find((i) => i.id === unknown.id)!;
    const unknownResult = await foundation.recordOutcome(
      unknown.id,
      uncertain.leaseId!,
      'UNKNOWN',
      { errorCode: 'PROVIDER_RESULT_UNKNOWN' },
    );
    expect(
      (
        await request(app)
          .post('/api/v1/management/notifications/' + unknown.id + '/requeue')
          .set('Authorization', auth(f.manager))
          .set('Idempotency-Key', randomUUID())
          .send({ expectedRevision: unknownResult.revision, reason: 'Không được gửi lại mù' })
      ).status,
    ).toBe(409);
    const status = await request(app)
      .get('/api/v1/management/notifications')
      .set('Authorization', auth(f.manager));
    expect(status.status).toBe(200);
    expect(JSON.stringify(status.body)).not.toMatch(
      /recipientId|deliveryEmail|pushToken|ciphertext|providerMessageId|fixture@example/iu,
    );
    expect(
      (
        await request(app)
          .get('/api/v1/management/notifications?state=unsupported')
          .set('Authorization', auth(f.manager))
      ).status,
    ).toBe(422);
    expect((await db.prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } })).phase).toBe(
      'CONFIRMED',
    );
  }, 30000);
});
