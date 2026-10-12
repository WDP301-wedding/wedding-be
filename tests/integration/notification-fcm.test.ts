import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';
import { createGuestServices } from '../../src/modules/guest-management/infrastructure/guest.composition.js';
import { createNotificationBookingReader } from '../../src/modules/booking-lifecycle/infrastructure/notification-context.reader.js';
import { createNotificationIdentityReader } from '../../src/modules/identity-access/authorization/notification-recipient.reader.js';
import { NotificationFoundation } from '../../src/modules/notifications-automation/infrastructure/notification-foundation.js';
import { NotificationEventConsumer } from '../../src/modules/notifications-automation/infrastructure/event-consumer.js';
import { AndroidPushDispatcher } from '../../src/modules/notifications-automation/application/android-push-dispatcher.js';
import { NotificationDispatcher } from '../../src/modules/notifications-automation/application/notification-dispatcher.js';
import { NotificationSettings } from '../../src/modules/notifications-automation/application/notification-settings.js';
import { NotificationEmailDelivery } from '../../src/modules/notifications-automation/infrastructure/email-delivery.js';
import { PrismaInvitationAutomationReader } from '../../src/modules/invitation-studio/infrastructure/prisma-automation.reader.js';
import type { FcmSender } from '../../src/modules/notifications-automation/infrastructure/fcm-delivery.js';
import { notificationChannels } from '../../src/modules/notifications-automation/domain/notification-template.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)('FCM durable device dispatch', () => {
  let db: CatalogTestDatabase;
  beforeEach(async () => {
    db = new CatalogTestDatabase('notification_fcm');
    await db.connect();
  }, 60000);
  afterEach(() => db.disconnect());
  async function fixture(count = 1) {
    const f = await studioFixture(db.prisma);
    let clock = f.now;
    const foundation = new NotificationFoundation(db.prisma, () => clock);
    const identity = createNotificationIdentityReader(db.prisma, () => clock);
    const booking = createNotificationBookingReader(db.prisma);
    const consumer = new NotificationEventConsumer(foundation, booking, identity, true);
    const recipient = await consumer.coupleRecipient(f.couple.actorId, 'TIMELINE_CHANGED');
    const send = vi.fn<FcmSender['send']>().mockResolvedValue({
      outcome: 'ACCEPTED',
      providerMessageId: 'projects/wedding-test/messages/accepted',
    });
    const push = new AndroidPushDispatcher(consumer, { send });
    const guests = createGuestServices(db.prisma, () => clock);
    const settings = new NotificationSettings(foundation, guests.identity.resolver, booking);
    const dispatcher = new NotificationDispatcher(
      consumer,
      new NotificationEmailDelivery({ enabled: false }),
      guests.links,
      new PrismaInvitationAutomationReader(db.prisma),
      null,
      { emailAllowlist: null, bookingAllowlist: null, guestLinkUrl: null },
      push,
    );
    async function device() {
      return db.prisma.notificationInstallation.create({
        data: {
          accountId: f.couple.actorId,
          sessionId: f.android.sessionId,
          installationId: randomUUID(),
          pushToken: `native-${randomUUID()}`,
        },
      });
    }
    for (let i = 0; i < count; i++) await device();
    const intent = await foundation.enqueue({
      eventId: randomUUID(),
      owner: 'booking-lifecycle',
      bookingId: f.bookingId,
      recipientId: recipient.id,
      channel: 'ANDROID',
      purpose: 'TIMELINE_CHANGED',
      templateVersion: 1,
      scheduledAt: clock.toISOString(),
      data: { referenceId: randomUUID() },
    });
    async function claim() {
      return (await foundation.claimDue()).find((r) => r.id === intent.id)!;
    }
    async function dispatch() {
      const row = await claim();
      const evidence = await dispatcher.send(row);
      const { outcome, ...metadata } = evidence;
      return foundation.recordOutcome(row.id, row.leaseId!, outcome, metadata);
    }
    return {
      f,
      foundation,
      consumer,
      identity,
      booking,
      recipient,
      send,
      push,
      dispatcher,
      settings,
      intent,
      device,
      claim,
      dispatch,
      setClock: (value: Date) => {
        clock = value;
      },
    };
  }
  it('stores provider acceptance per device, freezes targets and never resends accepted devices on retry', async () => {
    const x = await fixture(2);
    x.send
      .mockResolvedValueOnce({
        outcome: 'ACCEPTED',
        providerMessageId: 'projects/wedding-test/messages/one',
      })
      .mockResolvedValueOnce({
        outcome: 'RETRYABLE_FAILED',
        errorCode: 'FCM_TEMPORARILY_UNAVAILABLE',
      });
    expect((await x.dispatch()).state).toBe('RETRYABLE_FAILED');
    const firstToken = x.send.mock.calls[0]![0].token;
    await x.device();
    x.setClock(new Date(x.f.now.getTime() + 60000));
    expect((await x.dispatch()).state).toBe('PROVIDER_ACCEPTED');
    expect(x.send).toHaveBeenCalledTimes(3);
    expect(x.send.mock.calls[2]![0].token).not.toBe(firstToken);
    expect(
      await db.prisma.notificationPushDelivery.count({ where: { intentId: x.intent.id } }),
    ).toBe(2);
    expect(await x.foundation.claimDue()).toEqual([]);
    expect((await x.settings.statuses(x.f.manager.accessToken, {})).items[0]).toMatchObject({
      state: 'PROVIDER_ACCEPTED',
      channel: 'ANDROID',
    });
    const records = await db.prisma.notificationPushDelivery.findMany({
      where: { intentId: x.intent.id },
    });
    await expect(
      db.prisma.notificationPushDelivery.update({
        where: {
          intentId_installationId: {
            intentId: x.intent.id,
            installationId: records[0]!.installationId,
          },
        },
        data: { state: 'QUEUED' },
      }),
    ).rejects.toThrow();
    await expect(
      db.prisma.notificationPushDelivery.deleteMany({ where: { intentId: x.intent.id } }),
    ).rejects.toThrow();
  }, 30000);
  it('operator requeue retries failed devices only and keeps successful evidence', async () => {
    const x = await fixture(2);
    x.send
      .mockResolvedValueOnce({
        outcome: 'ACCEPTED',
        providerMessageId: 'projects/wedding-test/messages/one',
      })
      .mockResolvedValueOnce({ outcome: 'DEAD_LETTER', errorCode: 'FCM_REQUEST_REJECTED' });
    const failed = await x.dispatch();
    expect(failed.state).toBe('DEAD_LETTER');
    await x.settings.requeue(
      x.f.manager.accessToken,
      failed.id,
      { expectedRevision: failed.revision, reason: 'Provider config corrected' },
      randomUUID(),
    );
    expect((await x.dispatch()).state).toBe('PROVIDER_ACCEPTED');
    expect(x.send).toHaveBeenCalledTimes(3);
  }, 30000);
  it('disables typed unregistered tokens and does not overwrite a concurrent refresh', async () => {
    const x = await fixture();
    x.send.mockResolvedValueOnce({ outcome: 'DEAD_LETTER', errorCode: 'FCM_UNREGISTERED' });
    expect((await x.dispatch()).state).toBe('DEAD_LETTER');
    expect(
      await db.prisma.notificationInstallation.findFirst({
        where: { accountId: x.f.couple.actorId },
      }),
    ).toMatchObject({ enabled: false, pushToken: null, revision: 2 });
    const y = await fixture();
    y.send.mockImplementationOnce(async (command) => {
      await db.prisma.notificationInstallation.updateMany({
        where: { pushToken: command.token },
        data: { pushToken: 'refreshed-token', revision: { increment: 1 } },
      });
      return { outcome: 'DEAD_LETTER', errorCode: 'FCM_UNREGISTERED' };
    });
    await y.dispatch();
    expect(
      await db.prisma.notificationInstallation.findFirst({
        where: { accountId: y.f.couple.actorId },
      }),
    ).toMatchObject({ enabled: true, pushToken: 'refreshed-token' });
  }, 30000);
  it('does not resend ambiguous sends after worker failure or lease expiry', async () => {
    const x = await fixture();
    x.send.mockResolvedValueOnce({ outcome: 'UNKNOWN', errorCode: 'FCM_RESULT_UNKNOWN' });
    expect((await x.dispatch()).state).toBe('UNKNOWN');
    x.setClock(new Date(x.f.now.getTime() + 600000));
    expect(await x.foundation.claimDue()).toEqual([]);
    expect(x.send).toHaveBeenCalledTimes(1);
    const y = await fixture();
    y.send.mockRejectedValueOnce(new Error('crash after provider call'));
    const row = await y.claim();
    await expect(y.dispatcher.send(row)).rejects.toThrow();
    y.setClock(new Date(y.f.now.getTime() + 120001));
    await y.foundation.reconcileExpired();
    expect(
      await db.prisma.notificationPushDelivery.findFirst({ where: { intentId: row.id } }),
    ).toMatchObject({ state: 'UNKNOWN', errorCode: 'LEASE_EXPIRED' });
    expect(await y.foundation.claimDue()).toEqual([]);
  }, 30000);
  it('honors account allowlist, push preferences, session revocation and absent devices', async () => {
    const x = await fixture();
    const row = await x.claim();
    expect(
      await new AndroidPushDispatcher(x.consumer, { send: x.send }, []).send(
        row,
        x.f.couple.actorId,
      ),
    ).toMatchObject({ outcome: 'SKIPPED_STALE' });
    await db.prisma.notificationPreference.create({
      data: { accountId: x.f.couple.actorId, reminderPush: false },
    });
    expect(await x.dispatcher.send(row)).toMatchObject({ outcome: 'CANCELLED' });
    await db.prisma.notificationPreference.update({
      where: { accountId: x.f.couple.actorId },
      data: { reminderPush: true },
    });
    await db.prisma.session.update({
      where: { id: x.f.android.sessionId },
      data: { status: 'REVOKED' },
    });
    expect(await x.dispatcher.send(row)).toMatchObject({ outcome: 'CANCELLED' });
    expect(x.send).not.toHaveBeenCalled();
    const empty = await fixture(0);
    expect(await empty.dispatcher.send(await empty.claim())).toMatchObject({
      errorCode: 'ANDROID_DEVICE_UNAVAILABLE',
    });
  }, 30000);
  it('revalidates device revision between sends and denies limited/foreign scope and credential purposes', async () => {
    const x = await fixture(2);
    x.send.mockImplementationOnce(async (command) => {
      await db.prisma.notificationInstallation.updateMany({
        where: { accountId: x.f.couple.actorId, pushToken: { not: command.token } },
        data: { revision: { increment: 1 }, pushToken: 'replacement' },
      });
      return { outcome: 'ACCEPTED', providerMessageId: 'projects/wedding-test/messages/one' };
    });
    expect((await x.dispatch()).state).toBe('PROVIDER_ACCEPTED');
    expect(x.send).toHaveBeenCalledTimes(1);
    const y = await fixture();
    const row = await y.claim();
    const booking = await y.booking.read(y.f.bookingId);
    vi.spyOn(y.booking, 'read').mockResolvedValueOnce({ ...booking!, couples: [] });
    expect(await y.push.send(row, y.f.couple.actorId)).toMatchObject({
      errorCode: 'ANDROID_RECIPIENT_REVOKED',
    });
    vi.spyOn(y.booking, 'read').mockResolvedValueOnce({
      ...booking!,
      couples: [{ accountId: y.f.couple.actorId, level: 'RESTRICTED' }],
    });
    expect(await y.push.send(row, y.f.couple.actorId)).toMatchObject({
      errorCode: 'ANDROID_RECIPIENT_REVOKED',
    });
    expect(
      await y.push.send({ ...row, purpose: 'PASSWORD_OTP' }, y.f.couple.actorId),
    ).toMatchObject({ errorCode: 'ANDROID_PURPOSE_NOT_ALLOWED' });
    expect(await y.push.send({ ...row, leaseId: randomUUID() }, y.f.couple.actorId)).toMatchObject({
      errorCode: 'LEASE_EXPIRED',
    });
    expect(notificationChannels('PASSWORD_OTP', true)).not.toContain('ANDROID');
    expect(notificationChannels('TIMELINE_CHANGED', true)).toContain('ANDROID');
  }, 30000);
  it('sends only to an assigned operational Manager with an active Android session', async () => {
    const x = await fixture(0);
    const android = await x.f.actor('MANAGER', 'ANDROID', x.f.manager.actorId);
    const recipient = await db.prisma.notificationRecipient.create({
      data: { accountId: x.f.manager.actorId, operational: true, purposes: ['TIMELINE_CHANGED'] },
    });
    await db.prisma.notificationInstallation.create({
      data: {
        accountId: x.f.manager.actorId,
        sessionId: android.sessionId,
        installationId: randomUUID(),
        pushToken: 'manager-native-token',
      },
    });
    const intent = await x.foundation.enqueue({
      eventId: randomUUID(),
      owner: 'booking-lifecycle',
      bookingId: x.f.bookingId,
      recipientId: recipient.id,
      channel: 'ANDROID',
      purpose: 'TIMELINE_CHANGED',
      templateVersion: 1,
      scheduledAt: x.f.now.toISOString(),
      data: {},
    });
    const row = (await x.foundation.claimDue()).find((r) => r.id === intent.id)!;
    expect(await x.dispatcher.send(row)).toMatchObject({ outcome: 'ACCEPTED' });
    expect(x.send.mock.calls[0]![0].token).toBe('manager-native-token');
    await db.prisma.notificationRecipient.update({
      where: { id: recipient.id },
      data: { operational: false, revision: { increment: 1 } },
    });
    expect(await x.push.send(row, x.f.manager.actorId)).toMatchObject({ outcome: 'CANCELLED' });
    expect(x.send).toHaveBeenCalledTimes(1);
  }, 30000);
});
