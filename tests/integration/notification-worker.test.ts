import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { SendEmailCommand } from '../../src/integrations/email/email-provider.js';
import { Registry } from 'prom-client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';
import { NotificationFoundation } from '../../src/modules/notifications-automation/infrastructure/notification-foundation.js';
import { NotificationEventConsumer } from '../../src/modules/notifications-automation/infrastructure/event-consumer.js';
import { NotificationScheduler } from '../../src/modules/notifications-automation/application/notification-scheduler.js';
import { NotificationDispatcher } from '../../src/modules/notifications-automation/application/notification-dispatcher.js';
import { NotificationWorker } from '../../src/modules/notifications-automation/application/notification-worker.js';
import { NotificationEmailDelivery } from '../../src/modules/notifications-automation/infrastructure/email-delivery.js';
import { createNotificationBookingReader } from '../../src/modules/booking-lifecycle/infrastructure/notification-context.reader.js';
import { createNotificationIdentityReader } from '../../src/modules/identity-access/authorization/notification-recipient.reader.js';
import { createPrismaBookingAutomationRepository } from '../../src/modules/booking-lifecycle/infrastructure/automation.repository.js';
import { PrismaInvitationAutomationReader } from '../../src/modules/invitation-studio/infrastructure/prisma-automation.reader.js';
import { createGuestServices } from '../../src/modules/guest-management/infrastructure/guest.composition.js';
import { createLogger } from '../../src/core/logging/logger.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'notification dispatch/worker conformance',
  () => {
    let db: CatalogTestDatabase;
    beforeEach(async () => {
      db = new CatalogTestDatabase('notification_worker');
      await db.connect();
    }, 60000);
    afterEach(() => db.disconnect());
    async function workerFixture() {
      const f = await studioFixture(db.prisma);
      const foundation = new NotificationFoundation(db.prisma, () => f.now);
      const consumer = new NotificationEventConsumer(
        foundation,
        createNotificationBookingReader(db.prisma),
        createNotificationIdentityReader(db.prisma, () => f.now),
      );
      const invitation = new PrismaInvitationAutomationReader(db.prisma);
      const scheduler = new NotificationScheduler(
        consumer,
        createPrismaBookingAutomationRepository(db.prisma, () => f.now),
        invitation,
      );
      const dispatcher = new NotificationDispatcher(
        consumer,
        new NotificationEmailDelivery({ enabled: false }),
        createGuestServices(db.prisma, () => f.now).links,
        invitation,
        null,
        { emailAllowlist: null, bookingAllowlist: null, guestLinkUrl: null },
      );
      let logs = '';
      const registry = new Registry();
      const worker = new NotificationWorker(
        scheduler,
        dispatcher,
        createLogger({
          level: 'info',
          runtimeEnvironment: 'test',
          destination: {
            write(value: string) {
              logs += value;
            },
          },
        }),
        registry,
      );
      vi.spyOn(consumer, 'poll').mockResolvedValue(0);
      const schedulerTick = vi.spyOn(scheduler, 'tick').mockResolvedValue(undefined);
      const recipient = await consumer.coupleRecipient(f.couple.actorId, 'PAYMENT');
      const intent = await foundation.enqueue({
        eventId: randomUUID(),
        owner: 'payments-billing',
        bookingId: f.bookingId,
        recipientId: recipient.id,
        channel: 'EMAIL',
        purpose: 'PAYMENT',
        templateVersion: 1,
        scheduledAt: f.now.toISOString(),
        data: {},
      });
      return {
        schedulerTick,
        f,
        foundation,
        consumer,
        scheduler,
        dispatcher,
        worker,
        intent,
        registry,
        logs: () => logs,
      };
    }
    it('stops new claims during shutdown and safely retries an intent known to be unsent', async () => {
      const x = await workerFixture();
      const send = vi.spyOn(x.dispatcher, 'send');
      const claim = x.foundation.claimDue.bind(x.foundation);
      vi.spyOn(x.foundation, 'claimDue').mockImplementation(async (limit) => {
        const rows = await claim(limit);
        void x.worker.close();
        return rows;
      });
      await x.worker.tick();
      expect(send).not.toHaveBeenCalled();
      const intent = await db.prisma.notificationIntent.findUniqueOrThrow({
        where: { id: x.intent.id },
      });
      expect(intent.state).toBe('RETRYABLE_FAILED');
      expect(intent.nextAttemptAt.getTime()).toBe(x.f.now.getTime() + 60000);
      expect(x.logs()).toContain('WORKER_STOPPED_BEFORE_SEND');
      await x.worker.close();
    }, 30000);
    it('retains uncertainty on a dispatch exception and reports worker failure without sensitive exception text', async () => {
      const x = await workerFixture();
      vi.spyOn(x.dispatcher, 'send').mockRejectedValueOnce(new Error('private-provider-body'));
      await x.worker.tick();
      expect(
        (await db.prisma.notificationIntent.findUniqueOrThrow({ where: { id: x.intent.id } }))
          .state,
      ).toBe('UNKNOWN');
      expect(x.logs()).toContain('DISPATCH_RESULT_UNKNOWN');
      x.schedulerTick.mockRejectedValueOnce(new Error('private-database-error'));
      await x.worker.tick();
      expect(x.logs()).toContain('notification_worker_failed');
      expect(x.logs()).toContain('"stage":"schedule"');
      expect(x.logs()).not.toMatch(/private-provider-body|private-database-error/u);
      expect(await x.registry.metrics()).toContain(
        'wedding_notification_worker_runs_total{outcome="failure"} 1',
      );
      await x.worker.close();
    }, 30000);
    it('starts one recurring timer, respects the cadence and clears it on shutdown', async () => {
      const x = await workerFixture();
      const tick = vi.spyOn(x.worker, 'tick').mockResolvedValue(undefined);
      const time = vi.spyOn(performance, 'now').mockReturnValue(0);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        x.worker.start();
        x.worker.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(tick).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(59999);
        expect(tick).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(tick).toHaveBeenCalledTimes(2);
        await x.worker.close();
        x.worker.start();
        await vi.advanceTimersByTimeAsync(120000);
        expect(tick).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
        time.mockRestore();
        await x.worker.close();
      }
    }, 30000);
    it('claims immediately before each send so a slow backlog does not orphan unsent intents', async () => {
      const f = await studioFixture(db.prisma);
      let clock = f.now;
      const foundation = new NotificationFoundation(db.prisma, () => clock);
      const consumer = new NotificationEventConsumer(
        foundation,
        createNotificationBookingReader(db.prisma),
        createNotificationIdentityReader(db.prisma, () => clock),
      );
      const recipient = await consumer.coupleRecipient(f.couple.actorId, 'PAYMENT');
      const ids: string[] = [];
      for (let n = 0; n < 15; n++) {
        const intent = await foundation.enqueue({
          eventId: randomUUID(),
          owner: 'payments-billing',
          bookingId: f.bookingId,
          recipientId: recipient.id,
          channel: 'EMAIL',
          purpose: 'PAYMENT',
          templateVersion: 1,
          scheduledAt: clock.toISOString(),
          data: { totalVnd: n, referenceId: randomUUID() },
        });
        ids.push(intent.id);
      }
      const send = vi.fn((command: SendEmailCommand) => {
        clock = new Date(clock.getTime() + 10000);
        return Promise.resolve({
          idempotencyKey: command.idempotencyKey,
          messageId: 'slow-' + send.mock.calls.length,
        });
      });
      const invitation = new PrismaInvitationAutomationReader(db.prisma);
      const scheduler = new NotificationScheduler(
        consumer,
        createPrismaBookingAutomationRepository(db.prisma, () => clock),
        invitation,
      );
      const dispatcher = new NotificationDispatcher(
        consumer,
        new NotificationEmailDelivery(
          {
            enabled: true,
            provider: 'brevo',
            apiKey: 'controlled',
            fromEmail: 'sender@example.invalid',
          },
          { send },
        ),
        createGuestServices(db.prisma, () => clock).links,
        invitation,
        null,
        { emailAllowlist: null, bookingAllowlist: [f.bookingId], guestLinkUrl: null },
      );
      const worker = new NotificationWorker(
        scheduler,
        dispatcher,
        createLogger({ level: 'silent', runtimeEnvironment: 'test' }),
        new Registry(),
      );
      await worker.tick();
      expect(send).toHaveBeenCalledTimes(15);
      const intents = await db.prisma.notificationIntent.findMany({
        where: { id: { in: ids } },
        include: { attempts: true },
      });
      expect(intents).toHaveLength(15);
      for (const intent of intents) {
        expect(intent.state).toBe('UNKNOWN');
        expect(intent.attempts.map((a) => a.outcome)).toEqual(['CLAIMED', 'ACCEPTED']);
        expect(intent.attempts.find((a) => a.outcome === 'ACCEPTED')?.providerMessageId).toMatch(
          /^slow-/u,
        );
      }
      await worker.close();
    }, 30000);
    it('keeps provider acceptance UNKNOWN, reconciles without resending, separates inbox and observes sanitized failures', async () => {
      const f = await studioFixture(db.prisma);
      let clock = f.now;
      const foundation = new NotificationFoundation(db.prisma, () => clock);
      const consumer = new NotificationEventConsumer(
        foundation,
        createNotificationBookingReader(db.prisma),
        createNotificationIdentityReader(db.prisma, () => clock),
      );
      const recipient = await consumer.coupleRecipient(f.couple.actorId, 'PAYMENT');
      const eventId = randomUUID();
      const command = {
        eventId,
        owner: 'payments-billing',
        bookingId: f.bookingId,
        recipientId: recipient.id,
        channel: 'EMAIL',
        purpose: 'PAYMENT',
        templateVersion: 1,
        scheduledAt: clock.toISOString(),
        data: { totalVnd: 10, referenceId: randomUUID() },
      };
      const emailIntent = await foundation.enqueue(command);
      const inboxIntent = await foundation.enqueue({ ...command, channel: 'IN_APP' });
      await db.prisma.notificationPreference.create({
        data: { accountId: f.couple.actorId, reminderEmail: false },
      });
      const send = vi.fn((v: SendEmailCommand) =>
        Promise.resolve({
          idempotencyKey: v.idempotencyKey,
          messageId: 'controlled-ack',
        }),
      );
      const fetcher = vi.fn(() =>
        Promise.resolve(
          Response.json({ events: [{ messageId: 'controlled-ack', event: 'delivered' }] }),
        ),
      );
      const email = new NotificationEmailDelivery(
        {
          enabled: true,
          provider: 'brevo',
          apiKey: 'controlled-key',
          fromEmail: 'sender@example.invalid',
        },
        { send },
        fetcher,
      );
      const invitation = new PrismaInvitationAutomationReader(db.prisma);
      const scheduler = new NotificationScheduler(
        consumer,
        createPrismaBookingAutomationRepository(db.prisma, () => clock),
        invitation,
      );
      const dispatcher = new NotificationDispatcher(
        consumer,
        email,
        createGuestServices(db.prisma, () => clock).links,
        invitation,
        null,
        { emailAllowlist: null, bookingAllowlist: null, guestLinkUrl: null },
      );
      let logs = '';
      const logger = createLogger({
        level: 'info',
        runtimeEnvironment: 'test',
        destination: {
          write(v: string) {
            logs += v;
          },
        },
      });
      const registry = new Registry();
      const worker = new NotificationWorker(scheduler, dispatcher, logger, registry);
      await Promise.all([worker.tick(), worker.tick()]);
      expect(send).toHaveBeenCalledTimes(1);
      expect(
        (await db.prisma.notificationIntent.findUniqueOrThrow({ where: { id: emailIntent.id } }))
          .state,
      ).toBe('UNKNOWN');
      expect(
        (await db.prisma.notificationIntent.findUniqueOrThrow({ where: { id: inboxIntent.id } }))
          .state,
      ).toBe('DELIVERED');
      expect(
        await db.prisma.notificationInbox.count({
          where: { intentId: inboxIntent.id, readAt: null },
        }),
      ).toBe(1);
      clock = new Date(clock.getTime() + 60000);
      await new NotificationWorker(scheduler, dispatcher, logger, new Registry()).tick();
      expect(
        (await db.prisma.notificationIntent.findUniqueOrThrow({ where: { id: emailIntent.id } }))
          .state,
      ).toBe('DELIVERED');
      expect(send).toHaveBeenCalledTimes(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
      const metrics = await registry.metrics();
      expect(metrics).toContain(
        'wedding_notification_delivery_attempts_total{channel="EMAIL",outcome="ACCEPTED"} 1',
      );
      expect(metrics).not.toMatch(/fixture@example|controlled-key|controlled-ack/iu);
      expect(logs).not.toMatch(/fixture@example|controlled-key|controlled-ack|Số tiền|to":/iu);
      await consumer.coupleRecipient(f.couple.actorId, 'TIMELINE_CHANGED');
      const muted = await foundation.enqueue({
        ...command,
        eventId: randomUUID(),
        purpose: 'TIMELINE_CHANGED',
      });
      await worker.tick();
      expect(
        (await db.prisma.notificationIntent.findUniqueOrThrow({ where: { id: muted.id } })).state,
      ).toBe('CANCELLED');
      const crash = await foundation.enqueue({ ...command, eventId: randomUUID() });
      send.mockRejectedValueOnce(new Error('provider body must remain private'));
      await worker.tick();
      expect(
        (await db.prisma.notificationIntent.findUniqueOrThrow({ where: { id: crash.id } })).state,
      ).toBe('UNKNOWN');
      await worker.tick();
      expect(send).toHaveBeenCalledTimes(2);
      expect(logs).not.toContain('provider body must remain private');
      await consumer.coupleRecipient(f.couple.actorId, 'D3_REMINDER');
      const stale = await foundation.enqueue({
        ...command,
        eventId: randomUUID(),
        purpose: 'D3_REMINDER',
        scheduledAt: new Date(clock.getTime() - 25 * 3600000).toISOString(),
        scheduleRevision: 1,
      });
      const changed = await foundation.enqueue({
        ...command,
        eventId: randomUUID(),
        purpose: 'D3_REMINDER',
        scheduleRevision: 999,
      });
      await worker.tick();
      expect(
        (await db.prisma.notificationIntent.findUniqueOrThrow({ where: { id: stale.id } })).state,
      ).toBe('SKIPPED_STALE');
      expect(
        (await db.prisma.notificationIntent.findUniqueOrThrow({ where: { id: changed.id } })).state,
      ).toBe('SKIPPED_STALE');
      await f.services.service.changeCutoff(
        {
          bookingId: f.bookingId,
          expectedRevision: 0,
          cutoffAt: new Date(clock.getTime() + 86400000).toISOString(),
          idempotencyKey: randomUUID(),
        },
        f.manager,
      );
      await scheduler.tick();
      const reminder = await db.prisma.notificationIntent.findFirstOrThrow({
        where: { bookingId: f.bookingId, purpose: 'MEDIA_CUTOFF', channel: 'EMAIL' },
      });
      await f.services.service.changeCutoff(
        {
          bookingId: f.bookingId,
          expectedRevision: 1,
          cutoffAt: new Date(clock.getTime() + 2 * 86400000).toISOString(),
          idempotencyKey: randomUUID(),
        },
        f.manager,
      );
      await worker.tick();
      expect(
        (await db.prisma.notificationIntent.findUniqueOrThrow({ where: { id: reminder.id } }))
          .state,
      ).toBe('SKIPPED_STALE');
      expect(send).toHaveBeenCalledTimes(2);
      await worker.close();
      await worker.tick();
      expect(send).toHaveBeenCalledTimes(2);
    }, 30000);
  },
);
