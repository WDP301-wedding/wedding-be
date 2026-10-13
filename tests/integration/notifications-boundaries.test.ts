import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createNotificationRouter } from '../../src/modules/notifications-automation/http/notification.router.js';
import { NotificationService } from '../../src/modules/notifications-automation/application/notification.service.js';
import { createNotificationScopeReader } from '../../src/modules/booking-lifecycle/infrastructure/notification-scope.reader.js';
import { createNotificationRecipientReader } from '../../src/modules/identity-access/authorization/notification-recipient.reader.js';
import { createNotificationCutoffReader } from '../../src/modules/invitation-studio/infrastructure/notification-cutoff.reader.js';
import { NotificationRepository } from '../../src/modules/notifications-automation/infrastructure/notification.repository.js';
import { readNotificationOutbox } from '../../src/modules/notifications-automation/infrastructure/notification-outbox.reader.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { notificationFixture } from './notifications-fixture.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'SPEC-09 owner and HTTP recovery boundaries',
  () => {
    const db = new CatalogTestDatabase('ntf_boundaries');
    beforeAll(() => db.connect(), 60000);
    afterAll(() => db.disconnect());
    async function setup() {
      const x = await notificationFixture(db.prisma);
      const app = createApp({
        registerRoutes: (app) => app.use('/api/v1', createNotificationRouter(x.service)),
      });
      return { ...x, app };
    }
    it('returns absent owner facts without granting access and expires Android destinations at the exact boundary', async () => {
      const x = await setup(),
        { f } = x;
      const scopes = createNotificationScopeReader(db.prisma),
        recipients = createNotificationRecipientReader(db.prisma, () => x.now),
        cutoffs = createNotificationCutoffReader(db.prisma);
      expect(await scopes.canRead(randomUUID(), f.couple.actorId)).toBe(false);
      expect(await scopes.canRead(f.bookingId, f.couple.actorId)).toBe(true);
      expect(await scopes.schedule(randomUUID())).toBeNull();
      await db.prisma.booking.update({
        where: { id: f.bookingId },
        data: { effectiveTimelineRevisionId: null },
      });
      expect(await scopes.schedule(f.bookingId)).toMatchObject({
        scheduleRevision: 1,
        phase: 'CONFIRMED',
      });
      expect(await cutoffs.read(randomUUID())).toBeNull();
      expect(await recipients.email(randomUUID())).toBeNull();
      expect(await recipients.email(f.couple.actorId)).toContain('@example.test');
      expect(await recipients.manager(f.couple.actorId)).toBe(false);
      expect(await recipients.android(f.couple.actorId, f.android.sessionId)).toBe(true);
      await db.prisma.session.update({
        where: { id: f.android.sessionId },
        data: { idleExpiresAt: x.now },
      });
      expect(await recipients.android(f.couple.actorId, f.android.sessionId)).toBe(false);
      expect(
        await createNotificationRecipientReader(db.prisma).android(
          f.couple.actorId,
          f.couple.sessionId,
        ),
      ).toBe(false);
      await db.prisma.account.update({
        where: { id: f.couple.actorId },
        data: { status: 'DISABLED', disabledAt: x.now },
      });
      expect(await recipients.email(f.couple.actorId)).toBeNull();
    });
    it('bounds independent outbox reads to explicit scopes and excludes already consumed events', async () => {
      const x = await setup(),
        event = x.event();
      await db.prisma.bookingOutboxEvent.create({
        data: {
          id: event.eventId,
          aggregateId: x.f.bookingId,
          eventType: event.eventType,
          eventVersion: 1,
          aggregateRevision: 1,
          correlationId: randomUUID(),
          occurredAt: x.now,
          payload: { bookingId: x.f.bookingId },
        },
      });
      expect(
        await readNotificationOutbox(new NotificationRepository(db.prisma, () => x.now, [])),
      ).toEqual([]);
      expect(
        (await readNotificationOutbox(new NotificationRepository(db.prisma))).some(
          (e) => e.eventId === event.eventId,
        ),
      ).toBe(true);
      expect((await readNotificationOutbox(x.repository)).map((e) => e.bookingId)).toEqual(
        expect.arrayContaining([x.f.bookingId]),
      );
      await x.events.consume(event);
      expect(
        (await readNotificationOutbox(x.repository)).some((e) => e.eventId === event.eventId),
      ).toBe(false);
    });
    it('exercises installation, recipient, inbox and recovery contracts through authenticated HTTP', async () => {
      const x = await setup(),
        { f } = x;
      const send = (
        method: 'post' | 'patch' | 'delete',
        path: string,
        body: object,
        token = f.manager.accessToken,
      ) =>
        request(x.app)
          [method]('/api/v1' + path)
          .auth(token, { type: 'bearer' })
          .set('Idempotency-Key', randomUUID())
          .send(body);
      const installationId = randomUUID();
      await send(
        'post',
        '/notifications/android-installations',
        { installationId, pushToken: 'fixture-private-android-token-0000' },
        f.android.accessToken,
      ).expect(201);
      await send(
        'delete',
        '/notifications/android-installations/' + installationId,
        { expectedRevision: 1 },
        f.android.accessToken,
      ).expect(200);
      await send('post', `/management/notifications/bookings/${f.bookingId}/recipients`, {
        accountId: f.manager.actorId,
        purpose: 'OPERATIONS',
        enabled: true,
        expectedRevision: 0,
      }).expect(201);
      await x.events.consume(x.event());
      const managerInbox = await request(x.app)
        .get('/api/v1/notifications/inbox?limit=1')
        .auth(f.manager.accessToken, { type: 'bearer' })
        .expect(200);
      expect(managerInbox.headers['cache-control']).toBe('no-store');
      const managerItem = (await x.service.inbox({}, f.manager)).items[0]!;
      await send('patch', `/notifications/inbox/${managerItem.notificationIntentId}/read`, {
        expectedRevision: managerItem.revision,
      }).expect(200);
      const own = (await x.service.inbox({ limit: 1 }, f.couple)).items[0]!;
      await x.service.markRead(
        own.notificationIntentId,
        { expectedRevision: own.revision },
        randomUUID(),
        f.couple,
      );
      expect((await x.service.inbox({ cursor: own.notificationIntentId }, f.couple)).items).toEqual(
        [],
      );
      await expect(
        x.service.markRead(
          own.notificationIntentId,
          { expectedRevision: own.revision },
          randomUUID(),
          f.couple,
        ),
      ).rejects.toMatchObject({ status: 409 });
      const saved = await db.prisma.notificationIntent.update({
        where: { id: own.notificationIntentId },
        data: { state: 'RETRYABLE_FAILED' },
      });
      await send('post', `/management/notifications/${saved.id}/requeue`, {
        expectedRevision: saved.revision,
        reason: 'Confirmed pre-send rejection',
      }).expect(201);
      const unknown = await db.prisma.notificationIntent.update({
        where: { id: saved.id },
        data: { state: 'UNKNOWN', attemptCount: 1 },
      });
      await send('post', `/management/notifications/${saved.id}/resolve`, {
        expectedRevision: unknown.revision,
        reason: 'Provider checked',
        outcome: 'NOT_SENT',
        evidenceReference: 'isolated-provider-rejection',
      }).expect(201);
      const filtered = await x.service.operations(
        {
          limit: 1,
          state: 'RETRYABLE_FAILED',
          purpose: 'booking.completed',
          cursor: '00000000-0000-4000-8000-000000000000',
        },
        f.manager,
      );
      expect(filtered.items).toHaveLength(1);
      expect(filtered.items[0]).toMatchObject({
        state: 'RETRYABLE_FAILED',
        hasProviderReceipt: false,
      });
      await send(
        'post',
        `/bookings/${f.bookingId}/guests/${randomUUID()}/invitation-deliveries`,
        { intendedEmail: 'guest@example.test', expectedRevision: 0 },
        f.couple.accessToken,
      ).expect(404);
      await request(x.app).get('/api/v1/unrelated').expect(404);
    });
    it('rejects stale, absent and exhausted recovery commands without mutating evidence', async () => {
      const x = await setup(),
        { f } = x;
      await expect(
        x.service.actor({ ...f.couple, actorId: f.manager.actorId }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        new NotificationService(x.repository, x.crypto, x.guests, null).deliver(
          f.bookingId,
          randomUUID(),
          { intendedEmail: 'guest@example.test', expectedRevision: 0 },
          randomUUID(),
          f.couple,
        ),
      ).rejects.toMatchObject({ code: 'GUEST_DELIVERY_UNCONFIGURED' });
      await expect(
        x.service.registry(
          randomUUID(),
          { accountId: f.manager.actorId, purpose: 'PRINT', enabled: true, expectedRevision: 0 },
          randomUUID(),
          f.manager,
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        x.service.registry(
          f.bookingId,
          { accountId: f.couple.actorId, purpose: 'PRINT', enabled: true, expectedRevision: 0 },
          randomUUID(),
          f.manager,
        ),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        x.service.registry(
          f.bookingId,
          { accountId: f.manager.actorId, purpose: 'PRINT', enabled: true, expectedRevision: 7 },
          randomUUID(),
          f.manager,
        ),
      ).rejects.toMatchObject({ status: 409 });
      const row = await x.repository.enqueue(db.prisma, {
        eventId: randomUUID(),
        bookingId: f.bookingId,
        purpose: 'booking.completed',
        recipientId: f.couple.actorId,
        accountId: f.couple.actorId,
        channel: 'EMAIL',
        scheduledAt: x.now,
      });
      const requeue = { expectedRevision: row.revision, reason: 'Isolated recovery' },
        resolution = { ...requeue, outcome: 'NOT_SENT', evidenceReference: 'test-receipt' };
      await expect(
        x.service.recover(randomUUID(), requeue, randomUUID(), f.manager),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        x.service.recover(row.id, { ...requeue, expectedRevision: 99 }, randomUUID(), f.manager),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        x.service.recover(row.id, resolution, randomUUID(), f.manager, true),
      ).rejects.toMatchObject({ code: 'NOTIFICATION_OUTCOME_NOT_UNKNOWN' });
      await expect(
        x.service.recover(row.id, requeue, randomUUID(), f.manager),
      ).rejects.toMatchObject({ code: 'NOTIFICATION_REQUEUE_INELIGIBLE' });
      await db.prisma.notificationIntent.update({
        where: { id: row.id },
        data: { state: 'UNKNOWN', attemptCount: 6 },
      });
      expect(
        await x.service.recover(row.id, resolution, randomUUID(), f.manager, true),
      ).toMatchObject({ state: 'DEAD_LETTER' });
      const exhausted = await db.prisma.notificationIntent.findUniqueOrThrow({
        where: { id: row.id },
      });
      await expect(
        x.service.recover(
          row.id,
          { ...requeue, expectedRevision: exhausted.revision },
          randomUUID(),
          f.manager,
        ),
      ).rejects.toMatchObject({ code: 'NOTIFICATION_REQUEUE_INELIGIBLE' });
      expect(await db.prisma.notificationAttempt.count({ where: { intentId: row.id } })).toBe(1);
      await db.prisma.consultationAccess.deleteMany({
        where: { accountId: f.couple.actorId, consultationId: f.consultationId },
      });
      await expect(
        x.service.markRead(
          row.id,
          { expectedRevision: exhausted.revision },
          randomUUID(),
          f.couple,
        ),
      ).rejects.toMatchObject({ status: 404 });
    });
  },
);
