import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import {
  result,
  page,
  inboxDto,
} from '../../src/modules/notifications-automation/http/notification.schemas.js';
import { createApp } from '../../src/app.js';
import { createPrismaClient } from '../../src/core/database/prisma.js';
import {
  newDatabaseDiagnostics,
  withDatabaseDiagnostics,
} from '../../src/core/database/diagnostics.js';
import { createGuestServices } from '../../src/modules/guest-management/infrastructure/guest.composition.js';
import { createNotificationBookingReader } from '../../src/modules/booking-lifecycle/infrastructure/notification-context.reader.js';
import { NotificationFoundation } from '../../src/modules/notifications-automation/infrastructure/notification-foundation.js';
import { NotificationSettings } from '../../src/modules/notifications-automation/application/notification-settings.js';
import { createNotificationRouter } from '../../src/modules/notifications-automation/http/notification.router.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';

const methods = ['inbox', 'unread'] as const;
type Method = (typeof methods)[number];
(catalogMigrationDatabaseUrl ? describe : describe.skip)('PERF-08 fresh inbox reads', () => {
  const db = new CatalogTestDatabase('notification_read_perf');
  beforeAll(() => db.connect(), 60000);
  afterAll(() => db.disconnect(), 60000);

  async function fixture(role: 'couple' | 'manager' = 'couple') {
    const f = await studioFixture(db.prisma);
    const actor = f[role];
    let clock = f.now;
    const guests = createGuestServices(db.prisma, () => clock);
    const foundation = new NotificationFoundation(db.prisma, () => clock);
    const booking = createNotificationBookingReader(db.prisma);
    const settings = new NotificationSettings(foundation, guests.identity.resolver, booking);
    const recipient = await db.prisma.notificationRecipient.create({
      data: { accountId: actor.actorId, purposes: ['CONTRACT'], operational: role === 'manager' },
    });
    async function add(bookingId: string | null = f.bookingId, read = false) {
      const intent = await foundation.enqueue({
        eventId: randomUUID(),
        owner: 'booking-lifecycle',
        bookingId,
        recipientId: recipient.id,
        channel: 'IN_APP',
        purpose: 'CONTRACT',
        templateVersion: 1,
        scheduledAt: f.now.toISOString(),
        data: { referenceId: randomUUID(), totalVnd: 123456 },
      });
      return db.prisma.notificationInbox.create({
        data: {
          intentId: intent.id,
          accountId: actor.actorId,
          bookingId,
          createdAt: f.now,
          readAt: read ? f.now : null,
        },
      });
    }
    return {
      f,
      actor,
      foundation,
      settings,
      booking,
      add,
      setNow: (value: Date) => {
        clock = value;
      },
    };
  }
  const read = (settings: NotificationSettings, method: Method, token: string) =>
    method === 'inbox' ? settings.inbox(token, {}) : settings.unread(token);

  function duringRead(
    settings: NotificationSettings,
    method: Method,
    change: () => Promise<unknown>,
  ) {
    if (method === 'inbox') {
      const native = settings.inboxReader.page.bind(settings.inboxReader);
      const spy = vi.spyOn(settings.inboxReader, 'page').mockImplementationOnce(async (...args) => {
        const snapshot = await native(...args);
        await change();
        return snapshot;
      });
      return () => spy.mockRestore();
    }
    const native = settings.inboxReader.unread.bind(settings.inboxReader);
    const spy = vi.spyOn(settings.inboxReader, 'unread').mockImplementationOnce(async (...args) => {
      const snapshot = await native(...args);
      await change();
      return snapshot;
    });
    return () => spy.mockRestore();
  }

  it.each(['couple', 'manager'] as const)(
    'bounds %s HTTP reads for empty and populated pages',
    async (role) => {
      const x = await fixture(role);
      const url = new URL(catalogMigrationDatabaseUrl!);
      url.pathname = '/' + db.databaseName;
      const measured = createPrismaClient(url.toString(), true);
      try {
        const guests = createGuestServices(measured, () => x.f.now);
        const settings = new NotificationSettings(
          new NotificationFoundation(measured, () => x.f.now),
          guests.identity.resolver,
          createNotificationBookingReader(measured),
        );
        const diagnostics: ReturnType<typeof newDatabaseDiagnostics>[] = [];
        const app = createApp({
          runtimeEnvironment: 'test',
          registerRoutes: (a) => {
            a.use((_req, _res, next) => {
              const state = newDatabaseDiagnostics();
              diagnostics.push(state);
              withDatabaseDiagnostics(state, next);
            });
            a.use('/api/v1', createNotificationRouter(settings, guests, null));
          },
        });
        const transaction = vi.spyOn(measured, '$transaction');
        try {
          for (const count of [0, 1, 20]) {
            for (let n = count === 20 ? 1 : 0; n < count; n++) await x.add();
            for (const method of methods) {
              const response = await request(app)
                .get(
                  '/api/v1/notifications/' +
                    (method === 'inbox' ? 'inbox?limit=20' : 'unread-count'),
                )
                .set('Authorization', 'Bearer ' + x.actor.accessToken);
              expect(response.status).toBe(200);
              expect(response.headers['cache-control']).toBe('no-store');
              expect(response.headers['referrer-policy']).toBe('no-referrer');
              if (method === 'inbox')
                expect(result(page(inboxDto)).parse(response.body).data.items).toHaveLength(count);
              else
                expect(
                  result(z.strictObject({ count: z.int().nonnegative() })).parse(response.body)
                    .data,
                ).toEqual({ count });
              expect(diagnostics.at(-1)!.queries).toBeLessThanOrEqual(4);
              expect(diagnostics.at(-1)!.errors).toBe(0);
            }
            if (count === 20) {
              const first = result(page(inboxDto)).parse(
                (
                  await request(app)
                    .get('/api/v1/notifications/inbox?limit=1')
                    .set('Authorization', 'Bearer ' + x.actor.accessToken)
                ).body,
              ).data;
              const next = await request(app)
                .get('/api/v1/notifications/inbox?limit=20&cursor=' + first.nextCursor!)
                .set('Authorization', 'Bearer ' + x.actor.accessToken);
              expect(next.status).toBe(200);
              expect(result(page(inboxDto)).parse(next.body).data.items).toHaveLength(19);
              expect(diagnostics.at(-1)!.queries).toBeLessThanOrEqual(4);
            }
          }
          expect(transaction).not.toHaveBeenCalled();
        } finally {
          transaction.mockRestore();
        }
      } finally {
        await measured.$disconnect();
      }
    },
    30000,
  );

  it('preserves tied pagination, read flags, global visibility and complete views without writes', async () => {
    const x = await fixture();
    const rows = [await x.add(), await x.add(x.f.bookingId, true), await x.add(null)];
    const foreign = await studioFixture(db.prisma);
    const hidden = await x.add(foreign.bookingId);
    const snapshots = async () => ({
      inbox: await db.prisma.notificationInbox.findMany({
        where: { accountId: x.actor.actorId },
        orderBy: { id: 'asc' },
      }),
      intents: await db.prisma.notificationIntent.findMany({
        where: { id: { in: [...rows, hidden].map((r) => r.intentId) } },
        orderBy: { id: 'asc' },
      }),
    });
    const before = await snapshots();
    const all = await x.settings.inbox(x.actor.accessToken, { limit: 50 });
    expect(all.items.map((i) => i.id)).toEqual(
      rows
        .map((r) => r.id)
        .sort()
        .reverse(),
    );
    expect(await x.settings.unread(x.actor.accessToken)).toEqual({ count: 2 });
    const first = await x.settings.inbox(x.actor.accessToken, { limit: 1 });
    const next = await x.settings.inbox(x.actor.accessToken, {
      limit: 50,
      cursor: first.nextCursor!,
    });
    expect([...first.items, ...next.items]).toEqual(all.items);
    expect(all.items.find((i) => i.id === rows[1]!.id)!.readAt).toBe(x.f.now.toISOString());
    expect(
      all.items.every(
        (i) => i.title === 'Hợp đồng đã được cập nhật' && i.resource.data.totalVnd === 123456,
      ),
    ).toBe(true);
    await expect(
      x.settings.inbox(x.actor.accessToken, { cursor: hidden.id }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      x.settings.inbox(x.actor.accessToken, { cursor: randomUUID() }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await snapshots()).toEqual(before);
  });

  it.each(methods)('%s has no cross-request audience cache', async (method) => {
    const x = await fixture();
    await x.add();
    const access = await db.prisma.consultationAccess.findFirstOrThrow({
      where: { consultationId: x.f.consultationId, accountId: x.actor.actorId },
    });
    const first = await read(x.settings, method, x.actor.accessToken);
    await db.prisma.consultationAccess.deleteMany({
      where: { consultationId: x.f.consultationId, accountId: x.actor.actorId },
    });
    expect(await read(x.settings, method, x.actor.accessToken)).toEqual(
      method === 'inbox' ? { items: [], nextCursor: null } : { count: 0 },
    );
    await db.prisma.consultationAccess.create({
      data: access,
    });
    expect(await read(x.settings, method, x.actor.accessToken)).toEqual(first);
  });

  it('keeps both owner predicates in the selected quoted schema', async () => {
    const x = await fixture();
    const item = await x.add();
    const schema = 'notification"scope_' + randomUUID().replaceAll('-', '');
    const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
    const qualified = quote(schema);
    await db.prisma.$executeRawUnsafe('CREATE SCHEMA ' + qualified);
    const url = new URL(catalogMigrationDatabaseUrl!);
    url.pathname = '/' + db.databaseName;
    url.searchParams.set('schema', schema);
    const isolated = createPrismaClient(url.toString());
    try {
      for (const table of [
        'Account',
        'AccountRole',
        'Session',
        'AccessCredential',
        'Booking',
        'Consultation',
        'ConsultationAccess',
        'NotificationIntent',
        'NotificationInbox',
      ]) {
        const name = quote(table);
        await db.prisma.$executeRawUnsafe(
          `CREATE TABLE ${qualified}.${name} (LIKE public.${name} INCLUDING DEFAULTS)`,
        );
        await db.prisma.$executeRawUnsafe(
          `INSERT INTO ${qualified}.${name} SELECT * FROM public.${name}`,
        );
      }
      await db.prisma.$executeRawUnsafe(
        `UPDATE ${qualified}."NotificationIntent" SET data=$1::jsonb WHERE id=$2::uuid`,
        JSON.stringify({ totalVnd: 654321 }),
        item.intentId,
      );
      const settings = new NotificationSettings(
        new NotificationFoundation(isolated, () => x.f.now),
        createGuestServices(isolated, () => x.f.now).identity.resolver,
        createNotificationBookingReader(isolated),
      );
      expect((await settings.inbox(x.actor.accessToken, {})).items[0]!.resource.data.totalVnd).toBe(
        654321,
      );
      expect(await settings.unread(x.actor.accessToken)).toEqual({ count: 1 });
      await db.prisma.$executeRawUnsafe(
        `DELETE FROM ${qualified}."ConsultationAccess" WHERE "accountId"=$1::uuid`,
        x.actor.actorId,
      );
      expect(await settings.inbox(x.actor.accessToken, {})).toEqual({
        items: [],
        nextCursor: null,
      });
      expect(await settings.unread(x.actor.accessToken)).toEqual({ count: 0 });
      expect(await x.settings.unread(x.actor.accessToken)).toEqual({ count: 1 });
      expect(
        (await x.settings.inbox(x.actor.accessToken, {})).items[0]!.resource.data.totalVnd,
      ).toBe(123456);
    } finally {
      await isolated.$disconnect();
      await db.prisma.$executeRawUnsafe('DROP SCHEMA ' + qualified + ' CASCADE');
    }
  });

  const revocations = methods.flatMap((method) =>
    [false, true].flatMap((populated) =>
      (['session', 'access'] as const).map((change) => ({ method, populated, change })),
    ),
  );
  it.each(revocations)(
    'rechecks $method populated=$populated after $change removal',
    async ({ method, populated, change }) => {
      const x = await fixture();
      if (populated) await x.add();
      const restore = duringRead(x.settings, method, () =>
        change === 'session'
          ? db.prisma.session.update({
              where: { id: x.actor.sessionId },
              data: { status: 'REVOKED' },
            })
          : db.prisma.consultationAccess.deleteMany({
              where: { consultationId: x.f.consultationId, accountId: x.actor.actorId },
            }),
      );
      try {
        await expect(read(x.settings, method, x.actor.accessToken)).rejects.toMatchObject({
          status: change === 'session' ? 401 : 404,
        });
      } finally {
        restore();
      }
    },
  );

  it.each(methods)('rechecks Manager assignment and role during %s', async (method) => {
    for (const change of ['assignment', 'role'] as const) {
      const x = await fixture('manager');
      await x.add();
      const restore = duringRead(x.settings, method, async () => {
        if (change === 'assignment') {
          const successor = await x.f.actor('MANAGER');
          await db.prisma.consultation.update({
            where: { id: x.f.consultationId },
            data: { managerAccountId: successor.actorId },
          });
        } else {
          await db.prisma.accountRole.deleteMany({ where: { accountId: x.actor.actorId } });
          await db.prisma.accountRole.create({
            data: { accountId: x.actor.actorId, role: 'COUPLE' },
          });
        }
      });
      try {
        await expect(read(x.settings, method, x.actor.accessToken)).rejects.toMatchObject({
          status: 404,
        });
      } finally {
        restore();
      }
    }
  });

  it.each(methods)(
    'rechecks account state and exact credential expiry during %s',
    async (method) => {
      for (const change of ['account', 'credential'] as const) {
        const x = await fixture();
        await x.add();
        const credential = await db.prisma.accessCredential.findFirstOrThrow({
          where: { sessionId: x.actor.sessionId },
        });
        if (change === 'credential') {
          const later = new Date(credential.expiresAt.getTime() + 86400000);
          await db.prisma.session.update({
            where: { id: x.actor.sessionId },
            data: { idleExpiresAt: later, absoluteExpiresAt: later },
          });
        }
        const restore = duringRead(x.settings, method, async () => {
          if (change === 'account')
            await db.prisma.account.update({
              where: { id: x.actor.actorId },
              data: { status: 'DISABLED', disabledAt: x.f.now },
            });
          else x.setNow(credential.expiresAt);
        });
        try {
          await expect(read(x.settings, method, x.actor.accessToken)).rejects.toMatchObject({
            status: 401,
          });
        } finally {
          restore();
        }
      }
    },
  );

  it.each(methods)(
    'preserves roleless consultation eligibility and rejects its removal during %s',
    async (method) => {
      const x = await fixture();
      await x.add();
      await db.prisma.accountRole.deleteMany({ where: { accountId: x.actor.actorId } });
      expect(await read(x.settings, method, x.actor.accessToken)).toMatchObject(
        method === 'inbox' ? { items: [expect.anything()] } : { count: 1 },
      );
      const restore = duringRead(x.settings, method, () =>
        db.prisma.consultationAccess.deleteMany({
          where: { consultationId: x.f.consultationId, accountId: x.actor.actorId },
        }),
      );
      try {
        await expect(read(x.settings, method, x.actor.accessToken)).rejects.toMatchObject({
          status: 403,
        });
      } finally {
        restore();
      }
    },
  );
});
