import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createNotificationRouter } from '../../src/modules/notifications-automation/http/notification.router.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { notificationFixture } from './notifications-fixture.js';
import {
  preferenceSchema,
  operationsSchema,
} from '../../src/modules/notifications-automation/http/notification.schemas.js';
import { z } from 'zod';
(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'Notifications HTTP, Identity and device privacy',
  () => {
    const db = new CatalogTestDatabase('ntf_http');
    beforeAll(() => db.connect(), 60000);
    afterAll(() => db.disconnect());
    async function setup() {
      const x = await notificationFixture(db.prisma),
        app = createApp({
          registerRoutes: (app) => app.use('/api/v1', createNotificationRouter(x.service)),
        });
      return { ...x, app };
    }
    it('enforces roles, strict inputs, idempotency and own preferences', async () => {
      const { app, f } = await setup(),
        path = '/api/v1/notifications/preferences',
        auth = `Bearer ${f.couple.accessToken}`,
        staff = await f.actor('STAFF');
      expect((await request(app).get(path)).status).toBe(401);
      expect(
        (await request(app).get(path).auth(staff.accessToken, { type: 'bearer' })).status,
      ).toBe(403);
      const initial = await request(app).get(path).set('Authorization', auth);
      expect(
        z.strictObject({ data: preferenceSchema }).parse(initial.body as unknown).data,
      ).toEqual({ revision: 0, reminderEmail: true, reminderPush: true });
      expect(initial.headers['cache-control']).toBe('no-store');
      const input = { expectedRevision: 0, reminderEmail: false, reminderPush: false },
        key = randomUUID();
      expect((await request(app).patch(path).set('Authorization', auth).send(input)).status).toBe(
        400,
      );
      expect(
        (
          await request(app)
            .patch(path)
            .set('Authorization', auth)
            .set('Idempotency-Key', 'bad')
            .send(input)
        ).status,
      ).toBe(422);
      expect(
        (
          await request(app)
            .patch(path)
            .set('Authorization', auth)
            .set('Idempotency-Key', key)
            .send({ ...input, accountId: f.manager.actorId })
        ).status,
      ).toBe(422);
      const saved = await request(app)
        .patch(path)
        .set('Authorization', auth)
        .set('Idempotency-Key', key)
        .send(input);
      expect(saved.status).toBe(200);
      expect(
        (
          await request(app)
            .patch(path)
            .set('Authorization', auth)
            .set('Idempotency-Key', key)
            .send(input)
        ).body,
      ).toEqual(saved.body);
      expect(
        (
          await request(app)
            .patch(path)
            .set('Authorization', auth)
            .set('Idempotency-Key', key)
            .send({ ...input, reminderEmail: true })
        ).status,
      ).toBe(409);
      expect(
        (
          await request(app)
            .patch(path)
            .set('Authorization', auth)
            .set('Idempotency-Key', randomUUID())
            .send(input)
        ).status,
      ).toBe(409);
      expect(
        (await request(app).get('/api/v1/management/notifications').set('Authorization', auth))
          .status,
      ).toBe(403);
      await db.prisma.session.update({
        where: { id: f.couple.sessionId },
        data: { status: 'REVOKED' },
      });
      expect(
        (
          await request(app)
            .patch(path)
            .set('Authorization', auth)
            .set('Idempotency-Key', key)
            .send(input)
        ).status,
      ).toBe(401);
    });
    it('binds five encrypted installations to Android sessions, replaces tokens, rejects cross-account and rechecks logout', async () => {
      const x = await setup(),
        { f } = x,
        ids = Array.from({ length: 5 }, () => randomUUID());
      await expect(
        x.service.register(
          { installationId: ids[0], pushToken: 'private-token-000000000' },
          randomUUID(),
          f.couple,
        ),
      ).rejects.toMatchObject({ status: 403 });
      let first: { installationId: string; revision: number; active: boolean } | undefined;
      for (const id of ids) {
        const result = await x.service.register(
          { installationId: id, pushToken: `PRIVATE-TOKEN-${id}` },
          randomUUID(),
          f.android,
        );
        first ??= result;
      }
      await expect(
        x.service.register(
          { installationId: randomUUID(), pushToken: 'PRIVATE-TOKEN-EXCESS-0000' },
          randomUUID(),
          f.android,
        ),
      ).rejects.toMatchObject({ code: 'INSTALLATION_LIMIT' });
      const replacement = await x.service.register(
        { installationId: ids[0], pushToken: 'PRIVATE-TOKEN-REPLACED-0000' },
        randomUUID(),
        f.android,
      );
      expect(replacement.revision).toBe(2);
      const other = await f.actor('COUPLE', 'ANDROID');
      await expect(
        x.service.register(
          { installationId: ids[0], pushToken: 'PRIVATE-TOKEN-STOLEN-0000' },
          randomUUID(),
          other,
        ),
      ).rejects.toMatchObject({ code: 'INSTALLATION_CONFLICT' });
      await expect(
        x.service.revoke(ids[0]!, { expectedRevision: 2 }, randomUUID(), other),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        x.service.revoke(ids[0]!, { expectedRevision: 1 }, randomUUID(), f.android),
      ).rejects.toMatchObject({ status: 409 });
      const raw = x.event();
      await x.events.consume(raw);
      expect(
        await db.prisma.notificationIntent.count({
          where: { eventId: raw.eventId, channel: 'PUSH' },
        }),
      ).toBe(5);
      await db.prisma.session.update({
        where: { id: f.android.sessionId },
        data: { status: 'REVOKED' },
      });
      await x.dispatcher.run();
      expect(x.pushes).toHaveLength(0);
      expect(x.emails).toHaveLength(1);
      const stored = await db.prisma.notificationInstallation.findUniqueOrThrow({
        where: { id: ids[0]! },
      });
      expect(stored.ciphertext).not.toContain('PRIVATE-TOKEN');
      expect(
        await x.service.revoke(ids[0]!, { expectedRevision: 2 }, randomUUID(), f.couple),
      ).toMatchObject({ active: false, revision: 3 });
    });
    it('deduplicates own inbox, reads once, paginates and conceals recipients/secrets from operations', async () => {
      const x = await setup(),
        { f } = x;
      for (let i = 0; i < 3; i++) await x.events.consume(x.event('booking.completed', i + 1));
      const inbox = await x.service.inbox({ limit: 1 }, f.couple);
      expect(inbox.items).toHaveLength(1);
      expect(inbox.nextCursor).not.toBeNull();
      expect(inbox.unreadCount).toBe(3);
      const own = inbox.items[0]!,
        other = await f.actor('COUPLE');
      await expect(
        x.service.markRead(
          own.notificationIntentId,
          { expectedRevision: own.revision },
          randomUUID(),
          other,
        ),
      ).rejects.toMatchObject({ status: 404 });
      const key = randomUUID(),
        read = await x.service.markRead(
          own.notificationIntentId,
          { expectedRevision: own.revision },
          key,
          f.couple,
        );
      expect(
        await x.service.markRead(
          own.notificationIntentId,
          { expectedRevision: own.revision },
          key,
          f.couple,
        ),
      ).toEqual(read);
      expect(
        await x.service.markRead(
          own.notificationIntentId,
          { expectedRevision: read.revision },
          randomUUID(),
          f.couple,
        ),
      ).toEqual(read);
      expect((await x.service.inbox({}, f.couple)).unreadCount).toBe(2);
      const page = await request(x.app)
        .get('/api/v1/management/notifications?limit=1')
        .auth(f.manager.accessToken, { type: 'bearer' });
      expect(page.status).toBe(200);
      expect(
        z.strictObject({ data: operationsSchema }).parse(page.body as unknown).data.items,
      ).toHaveLength(1);
      expect(JSON.stringify(page.body)).not.toMatch(
        /ciphertext|recipientId|accountId|emailNormalized|providerMessageId|text|token/u,
      );
      expect(
        (
          await request(x.app)
            .get('/api/v1/notifications/inbox?role=MANAGER')
            .auth(f.couple.accessToken, { type: 'bearer' })
        ).status,
      ).toBe(422);
      await db.prisma.consultationAccess.deleteMany({
        where: { accountId: f.couple.actorId, consultationId: f.consultationId },
      });
      expect((await x.service.inbox({}, f.couple)).items).toEqual([]);
    });
    it('honors informational preferences while transactional settlement stays deliverable and sends enabled push', async () => {
      const x = await setup(),
        { f } = x;
      await x.service.register(
        { installationId: randomUUID(), pushToken: 'PRIVATE-PUSH-ENABLED-000000' },
        randomUUID(),
        f.android,
      );
      await x.events.consume(x.event());
      await x.dispatcher.run();
      expect(x.pushes).toHaveLength(1);
      await x.service.setPreferences(
        { expectedRevision: 0, reminderEmail: false, reminderPush: false },
        randomUUID(),
        f.couple,
      );
      await x.events.consume(x.event('booking.completed', 2));
      await x.events.consume(
        x.event('billing.payment-succeeded', 3, {
          bookingId: f.bookingId,
          paymentId: randomUUID(),
          amountVnd: 123,
        }),
      );
      await x.dispatcher.run();
      expect(x.emails).toHaveLength(2);
      expect(x.pushes).toHaveLength(1);
    });
  },
);
