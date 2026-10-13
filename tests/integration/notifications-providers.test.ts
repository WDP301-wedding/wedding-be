import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { notificationFixture } from './notifications-fixture.js';
import { credentialAad } from '../../src/modules/notifications-automation/infrastructure/notification.repository.js';
import { NotificationDispatcher } from '../../src/modules/notifications-automation/application/notification-dispatcher.js';
import { AppError } from '../../src/core/errors/app-error.js';
import type { EmailProvider } from '../../src/integrations/email/email-provider.js';
import { readNotificationOutbox } from '../../src/modules/notifications-automation/infrastructure/notification-outbox.reader.js';
(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'Notifications with real owner sources',
  () => {
    const db = new CatalogTestDatabase('ntf_providers');
    beforeAll(() => db.connect(), 60000);
    afterAll(() => db.disconnect());
    it('atomically encrypts authorized Guest delivery, replays once, sends read-only fragment and purges secret', async () => {
      const x = await notificationFixture(db.prisma),
        { f, guests, service } = x;
      await x.publish();
      const [group] = await guests.guests.groups(f.bookingId, f.couple),
        guest = await guests.guests.createGuest(
          f.bookingId,
          {
            guestGroupId: group!.guestGroupId,
            name: 'PRIVATE NAME',
            phone: '+84912345678',
            operationalNote: 'PRIVATE NOTES',
          },
          randomUUID(),
          f.couple,
        );
      const input = { intendedEmail: 'guest@example.test', expectedRevision: 0 },
        key = randomUUID();
      const result = await service.deliver(f.bookingId, guest.guestId, input, key, f.couple);
      expect(await service.deliver(f.bookingId, guest.guestId, input, key, f.couple)).toEqual(
        result,
      );
      await expect(
        service.deliver(
          f.bookingId,
          guest.guestId,
          { ...input, intendedEmail: 'other@example.test' },
          key,
          f.couple,
        ),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
      const row = await db.prisma.notificationIntent.findUniqueOrThrow({
        where: { id: result.notificationIntentId },
      });
      expect(row.ciphertext).not.toMatch(/PRIVATE|example.test|wgc_/u);
      expect(row.secretExpiresAt!.getTime() - x.now.getTime()).toBe(72 * 3600000);
      const secret = x.crypto.open(row.ciphertext!, credentialAad(f.bookingId, row.id)) as {
        link: string;
      };
      expect(secret.link).toContain('#credential=wgc_');
      expect(
        JSON.stringify(
          await db.prisma.guestCommand.findMany({ where: { bookingId: f.bookingId } }),
        ),
      ).not.toMatch(/wgc_/u);
      await x.dispatcher.run();
      await x.dispatcher.run();
      expect(x.emails).toHaveLength(1);
      expect(x.emails[0]!.text).toContain('#credential=wgc_');
      expect(x.emails[0]!.text).not.toContain('PRIVATE');
      const token = new URL(secret.link).hash.slice('#credential='.length);
      const exchange = await guests.links.exchange(token, '127.0.0.1');
      expect(await guests.links.view(exchange.capability)).toHaveProperty('invitation');
      expect(
        (await db.prisma.notificationIntent.findUniqueOrThrow({ where: { id: row.id } }))
          .ciphertext,
      ).toBeNull();
      expect(await db.prisma.staffCheckInRecord.count({ where: { bookingId: f.bookingId } })).toBe(
        0,
      );
    });
    it('rolls back issuance on encryption failure and cancels revoked, archived or expired recipients', async () => {
      const x = await notificationFixture(db.prisma),
        { f } = x;
      await x.publish();
      const [group] = await x.guests.guests.groups(f.bookingId, f.couple),
        guest = await x.guests.guests.createGuest(
          f.bookingId,
          { guestGroupId: group!.guestGroupId, name: 'An' },
          randomUUID(),
          f.couple,
        );
      const fault = vi.spyOn(x.crypto, 'seal').mockImplementation(() => {
        throw Error('encryption unavailable');
      });
      await expect(
        x.service.deliver(
          f.bookingId,
          guest.guestId,
          { intendedEmail: 'guest@example.test', expectedRevision: 0 },
          randomUUID(),
          f.couple,
        ),
      ).rejects.toThrow('encryption unavailable');
      fault.mockRestore();
      expect(
        await db.prisma.guestInvitationCredential.count({ where: { guestId: guest.guestId } }),
      ).toBe(0);
      const first = await x.service.deliver(
        f.bookingId,
        guest.guestId,
        { intendedEmail: 'guest@example.test', expectedRevision: 0 },
        randomUUID(),
        f.couple,
      );
      await x.guests.links.issue(
        f.bookingId,
        guest.guestId,
        { expectedRevision: 1 },
        randomUUID(),
        f.couple,
      );
      await x.dispatcher.run();
      expect(x.emails).toHaveLength(0);
      expect(
        (
          await db.prisma.notificationIntent.findUniqueOrThrow({
            where: { id: first.notificationIntentId },
          })
        ).state,
      ).toBe('CANCELLED');
      const second = await x.service.deliver(
        f.bookingId,
        guest.guestId,
        { intendedEmail: 'guest@example.test', expectedRevision: 2 },
        randomUUID(),
        f.couple,
      );
      x.setNow(new Date(x.now.getTime() + 73 * 3600000));
      await x.dispatcher.run();
      expect(
        (
          await db.prisma.notificationIntent.findUniqueOrThrow({
            where: { id: second.notificationIntentId },
          })
        ).ciphertext,
      ).toBeNull();
      expect(x.emails).toHaveLength(0);
    });
    it('deduplicates producer facts, handles stale/invalid versions and only explicitly configured Managers', async () => {
      const x = await notificationFixture(db.prisma),
        { f } = x;
      const raw = x.event();
      expect(await Promise.all([x.events.consume(raw), x.events.consume(raw)])).toEqual([
        'ACCEPTED',
        'REPLAYED',
      ]);
      expect(await db.prisma.notificationIntent.count({ where: { eventId: raw.eventId } })).toBe(1);
      await x.service.registry(
        f.bookingId,
        { accountId: f.manager.actorId, purpose: 'OPERATIONS', enabled: true, expectedRevision: 0 },
        randomUUID(),
        f.manager,
      );
      const newer = x.event('booking.completed', 9);
      await x.events.consume(newer);
      expect(await db.prisma.notificationIntent.count({ where: { eventId: newer.eventId } })).toBe(
        2,
      );
      expect(await x.events.consume(x.event('booking.completed', 2))).toBe('IGNORED_STALE');
      expect(await x.events.consume({ ...x.event(), eventVersion: 2 })).toBe('INVALID_SCHEMA');
      expect(
        await x.events.consume(x.event('booking.completed', 10, { bookingId: randomUUID() })),
      ).toBe('INVALID_SCHEMA');
      expect(await x.events.consume(x.event('guest.unrecognized'))).toBe('IGNORED_UNSUPPORTED');
      const p = x.event('billing.payment-succeeded', 10, {
        bookingId: f.bookingId,
        paymentId: randomUUID(),
        amountVnd: 300000,
      });
      await x.events.consume(p);
      expect(await x.events.consume({ ...p, eventId: randomUUID(), sourceSequence: 2 })).toBe(
        'ACCEPTED',
      );
      await x.dispatcher.run();
      expect(JSON.stringify(x.emails)).not.toMatch(/PRIVATE|operationalNote|pushToken/u);
      const inbox = await x.service.inbox({}, f.couple);
      expect(inbox.items.length).toBeGreaterThan(0);
    });
    it('consumes actual Guest/Invitation outbox with zero names and preserves independent planning', async () => {
      const x = await notificationFixture(db.prisma),
        { f } = x;
      await x.guests.guests.groups(f.bookingId, f.couple);
      await x.publish();
      const rows = await readNotificationOutbox(x.repository);
      expect(rows.some((e) => e.producer === 'guest')).toBe(true);
      expect(rows.some((e) => e.producer === 'invitation')).toBe(true);
      for (const row of rows) await x.events.consume(row);
      expect(await readNotificationOutbox(x.repository)).toEqual([]);
      expect((await x.guests.guests.plan(f.bookingId, f.couple)).planningHeadcount).toBe(20);
      expect(await db.prisma.guest.count({ where: { bookingId: f.bookingId } })).toBe(0);
      await x.dispatcher.run();
      expect(x.emails.length).toBeGreaterThan(0);
    });
    it('keeps UNKNOWN for Manager evidence, refuses blind requeue and retries the same intent only after NOT_SENT', async () => {
      const x = await notificationFixture(db.prisma),
        { f } = x;
      const raw = x.event();
      await x.events.consume(raw);
      const send = vi
        .fn<EmailProvider['send']>()
        .mockRejectedValue(
          new AppError({ status: 504, code: 'PROVIDER_TIMEOUT', message: 'private provider body' }),
        );
      const dispatcher = new NotificationDispatcher(
        x.repository,
        x.crypto,
        { send },
        x.push,
        x.guests.readers,
      );
      await dispatcher.run();
      await dispatcher.run();
      expect(send).toHaveBeenCalledOnce();
      let row = await db.prisma.notificationIntent.findFirstOrThrow({
        where: { eventId: raw.eventId },
      });
      expect(row.state).toBe('UNKNOWN');
      await expect(
        x.service.recover(
          row.id,
          { expectedRevision: row.revision, reason: 'retry' },
          randomUUID(),
          f.manager,
        ),
      ).rejects.toMatchObject({ code: 'NOTIFICATION_REQUEUE_INELIGIBLE' });
      const resolution = await x.service.recover(
        row.id,
        {
          expectedRevision: row.revision,
          reason: 'Provider confirms no send',
          evidenceReference: 'provider-check/test-1',
          outcome: 'NOT_SENT',
        },
        randomUUID(),
        f.manager,
        true,
      );
      await x.service.recover(
        row.id,
        { expectedRevision: resolution.revision, reason: 'Retry verified unsent' },
        randomUUID(),
        f.manager,
      );
      await x.dispatcher.run();
      row = await db.prisma.notificationIntent.findUniqueOrThrow({ where: { id: row.id } });
      expect(row.state).toBe('DELIVERED');
      expect(row.attemptCount).toBe(2);
      expect(x.emails[0]!.idempotencyKey).toBe(send.mock.calls[0]![0].idempotencyKey);
      expect(await db.prisma.notificationIntent.count({ where: { eventId: raw.eventId } })).toBe(1);
      await expect(
        db.prisma.notificationAttempt.deleteMany({ where: { intentId: row.id } }),
      ).rejects.toThrow();
    });
  },
);
