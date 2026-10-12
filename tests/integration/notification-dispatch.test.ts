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
import { createPrismaBookingLifecycleRepository } from '../../src/modules/booking-lifecycle/infrastructure/lifecycle.repository.js';
import { PrismaInvitationAutomationReader } from '../../src/modules/invitation-studio/infrastructure/prisma-automation.reader.js';
import { NotificationFoundation } from '../../src/modules/notifications-automation/infrastructure/notification-foundation.js';
import { NotificationEventConsumer } from '../../src/modules/notifications-automation/infrastructure/event-consumer.js';
import { NotificationEmailDelivery } from '../../src/modules/notifications-automation/infrastructure/email-delivery.js';
import { NotificationDispatcher } from '../../src/modules/notifications-automation/application/notification-dispatcher.js';
import type { NotificationInput } from '../../src/modules/notifications-automation/domain/notification-policy.js';
import type { SendEmailCommand } from '../../src/integrations/email/email-provider.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'notification final dispatch authority gates',
  () => {
    let db: CatalogTestDatabase;
    beforeEach(async () => {
      db = new CatalogTestDatabase('notification_dispatch');
      await db.connect();
    }, 60000);
    afterEach(() => db.disconnect());
    async function fixture() {
      const f = await studioFixture(db.prisma);
      let clock = f.now;
      const foundation = new NotificationFoundation(db.prisma, () => clock);
      const identity = createNotificationIdentityReader(db.prisma, () => clock);
      const booking = createNotificationBookingReader(db.prisma);
      const consumer = new NotificationEventConsumer(foundation, booking, identity);
      const recipient = await db.prisma.notificationRecipient.create({
        data: {
          accountId: f.couple.actorId,
          purposes: [
            'PAYMENT',
            'CONTRACT',
            'TIMELINE_REVIEW',
            'D3_REMINDER',
            'CANCELLATION_NOTICE',
          ],
        },
      });
      const send = vi.fn((command: SendEmailCommand) =>
        Promise.resolve({
          idempotencyKey: command.idempotencyKey,
          messageId: 'controlled-accepted',
        }),
      );
      const email = new NotificationEmailDelivery(
        {
          enabled: true,
          provider: 'brevo',
          apiKey: 'controlled',
          fromEmail: 'sender@example.invalid',
        },
        { send },
      );
      const guests = createGuestServices(db.prisma, () => clock);
      const invitation = new PrismaInvitationAutomationReader(db.prisma);
      const policy = { emailAllowlist: null, bookingAllowlist: null, guestLinkUrl: null };
      const dispatcher = new NotificationDispatcher(
        consumer,
        email,
        guests.links,
        invitation,
        null,
        policy,
      );
      async function claim(overrides: Partial<NotificationInput> = {}) {
        const intent = await foundation.enqueue({
          eventId: randomUUID(),
          owner: 'booking-lifecycle',
          bookingId: f.bookingId,
          recipientId: recipient.id,
          channel: 'EMAIL',
          purpose: 'CONTRACT',
          templateVersion: 1,
          scheduledAt: clock.toISOString(),
          data: {},
          ...overrides,
        });
        return (await foundation.claimDue()).find((i) => i.id === intent.id)!;
      }
      return {
        f,
        foundation,
        identity,
        booking,
        consumer,
        recipient,
        send,
        email,
        guests,
        invitation,
        policy,
        dispatcher,
        claim,
        setClock: (value: Date) => {
          clock = value;
        },
      };
    }
    it('rechecks lease, recipient, account and booking scope before any provider effect', async () => {
      const x = await fixture();
      const lease = await x.claim();
      expect(await x.dispatcher.send({ ...lease, leaseId: randomUUID() })).toMatchObject({
        outcome: 'UNKNOWN',
        errorCode: 'LEASE_EXPIRED',
      });
      x.setClock(new Date(x.f.now.getTime() + 110000));
      expect(await x.dispatcher.send(lease)).toMatchObject({
        outcome: 'UNKNOWN',
        errorCode: 'LEASE_EXPIRED',
      });
      x.setClock(x.f.now);
      const revoked = await x.claim();
      await db.prisma.notificationRecipient.update({
        where: { id: x.recipient.id },
        data: { enabled: false, revision: { increment: 1 } },
      });
      expect(await x.dispatcher.send(revoked)).toMatchObject({
        outcome: 'CANCELLED',
        errorCode: 'RECIPIENT_REVOKED',
      });
      await db.prisma.notificationRecipient.update({
        where: { id: x.recipient.id },
        data: { enabled: true, revision: { increment: 1 } },
      });
      const foreign = await x.f.actor('COUPLE');
      const recipient = await x.consumer.coupleRecipient(foreign.actorId, 'CONTRACT');
      expect(await x.dispatcher.send(await x.claim({ recipientId: recipient.id }))).toMatchObject({
        outcome: 'CANCELLED',
        errorCode: 'RECIPIENT_SCOPE_REVOKED',
      });
      vi.spyOn(x.booking, 'read').mockResolvedValueOnce(null);
      expect(await x.dispatcher.send(await x.claim())).toMatchObject({
        outcome: 'CANCELLED',
        errorCode: 'BOOKING_UNAVAILABLE',
      });
      const disabled = await x.claim();
      await db.prisma.account.update({
        where: { id: x.f.couple.actorId },
        data: { status: 'DISABLED', disabledAt: x.f.now },
      });
      expect(await x.dispatcher.send(disabled)).toMatchObject({
        outcome: 'CANCELLED',
        errorCode: 'ACCOUNT_REVOKED',
      });
      expect(x.send).not.toHaveBeenCalled();
    }, 30000);
    it('suppresses superseded/terminal reminders and disabled push while allowing a financial cancellation notice', async () => {
      const x = await fixture();
      expect(
        await x.dispatcher.send(
          await x.claim({ purpose: 'TIMELINE_REVIEW', data: { referenceId: randomUUID() } }),
        ),
      ).toMatchObject({ outcome: 'SKIPPED_STALE', errorCode: 'TIMELINE_SUPERSEDED' });
      expect(await x.dispatcher.send(await x.claim({ channel: 'ANDROID' }))).toMatchObject({
        outcome: 'DEAD_LETTER',
        errorCode: 'ANDROID_PROVIDER_DISABLED',
      });
      const head = await db.prisma.booking.findUniqueOrThrow({ where: { id: x.f.bookingId } });
      await createPrismaBookingLifecycleRepository(db.prisma, () => x.f.now).cancel({
        bookingId: head.id,
        expectedBookingRevision: head.revision,
        reason: 'Controlled native cancellation',
        context: { requestId: randomUUID(), actorAccountId: x.f.manager.actorId },
      });
      expect(await x.dispatcher.send(await x.claim())).toMatchObject({
        outcome: 'CANCELLED',
        errorCode: 'BOOKING_CANCELLED',
      });
      expect(
        await x.dispatcher.send(
          await x.claim({ owner: 'payments-billing', purpose: 'D3_REMINDER', scheduleRevision: 1 }),
        ),
      ).toMatchObject({ outcome: 'SKIPPED_STALE', errorCode: 'BOOKING_TERMINAL' });
      expect(
        await x.dispatcher.send(await x.claim({ owner: 'payments-billing', purpose: 'PAYMENT' })),
      ).toMatchObject({ outcome: 'ACCEPTED' });
      expect(
        await x.dispatcher.send(await x.claim({ purpose: 'CANCELLATION_NOTICE' })),
      ).toMatchObject({ outcome: 'ACCEPTED' });
      expect(x.send).toHaveBeenCalledTimes(2);
      expect((await db.prisma.booking.findUniqueOrThrow({ where: { id: head.id } })).phase).toBe(
        'CANCELLED',
      );
    }, 30000);
    it('fences developer destinations/bookings and recovers an inbox-only unknown result without sending email', async () => {
      const x = await fixture();
      const fenced = new NotificationDispatcher(
        x.consumer,
        x.email,
        x.guests.links,
        x.invitation,
        null,
        {
          emailAllowlist: ['approved@example.invalid'],
          bookingAllowlist: [x.f.bookingId],
          guestLinkUrl: null,
        },
      );
      expect(await fenced.send(await x.claim())).toMatchObject({
        outcome: 'SKIPPED_STALE',
        errorCode: 'TEST_RECIPIENT_NOT_ALLOWED',
      });
      expect(await fenced.send(await x.claim({ bookingId: null }))).toMatchObject({
        outcome: 'SKIPPED_STALE',
        errorCode: 'TEST_BOOKING_NOT_ALLOWED',
      });
      const invalid = new NotificationEventConsumer(x.foundation, x.booking, {
        ...x.identity,
        account: async (accountId) => {
          const account = await x.identity.account(accountId);
          return account ? { ...account, email: 'invalid-address' } : null;
        },
      });
      expect(
        await new NotificationDispatcher(
          invalid,
          x.email,
          x.guests.links,
          x.invitation,
          null,
          x.policy,
        ).send(await x.claim()),
      ).toMatchObject({ outcome: 'DEAD_LETTER', errorCode: 'DESTINATION_INVALID' });
      const inApp = await x.claim({ channel: 'IN_APP' });
      await db.prisma.notificationInbox.create({
        data: {
          intentId: inApp.id,
          accountId: x.f.couple.actorId,
          bookingId: x.f.bookingId,
          createdAt: x.f.now,
        },
      });
      await x.foundation.recordOutcome(inApp.id, inApp.leaseId!, 'UNKNOWN', {
        errorCode: 'CONTROLLED_RESULT_UNKNOWN',
      });
      x.setClock(new Date(x.f.now.getTime() + 60000));
      await x.dispatcher.reconcile();
      expect(
        (await db.prisma.notificationIntent.findUniqueOrThrow({ where: { id: inApp.id } })).state,
      ).toBe('DELIVERED');
      expect(await db.prisma.notificationInbox.count({ where: { intentId: inApp.id } })).toBe(1);
      expect(x.send).not.toHaveBeenCalled();
    }, 30000);
  },
);
