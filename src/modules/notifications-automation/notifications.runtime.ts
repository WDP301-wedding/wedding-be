import type { Config } from '../../config/config.js';
import { createPrismaClient } from '../../core/database/prisma.js';
import { createLogger } from '../../core/logging/logger.js';
import { createEmailProvider } from '../../integrations/email/email-provider.factory.js';
import { createGuestServices } from '../guest-management/infrastructure/guest.composition.js';
import type { BookingAutomationPort } from '../booking-lifecycle/application/automation.js';
import type { InvitationAutomationReader } from '../invitation-studio/application/automation.contracts.js';
import { parseNotificationSettings } from '../../config/notifications.js';
import { NotificationRepository } from './infrastructure/notification.repository.js';
import { NotificationCrypto } from './infrastructure/notification-crypto.js';
import {
  createFcmPushProvider,
  unavailablePush,
  pushError,
} from './infrastructure/fcm-push.provider.js';
import { readNotificationOutbox } from './infrastructure/notification-outbox.reader.js';
import { NotificationEvents } from './application/notification-events.js';
import { NotificationScheduler } from './application/notification-scheduler.js';
import { NotificationDispatcher } from './application/notification-dispatcher.js';
import { startNotificationWorker } from './application/notification-worker.js';
import { NotificationService } from './application/notification.service.js';
import { createNotificationRouter } from './http/notification.router.js';
export async function createNotificationsRuntime(
  config: Config,
  booking: BookingAutomationPort,
  invitation: InvitationAutomationReader,
  billingRecovery?: {
    run(bookingIds?: readonly string[]): Promise<{ attempted: number; failed: number }>;
  },
) {
  const prisma = createPrismaClient(config.database.url);
  let worker: ReturnType<typeof startNotificationWorker> | undefined;
  try {
    await prisma.$connect();
    const settings = config.notifications ?? parseNotificationSettings({}),
      repository = new NotificationRepository(prisma, () => new Date(), settings.bookingIds),
      crypto = new NotificationCrypto(settings.activeKeyVersion, settings.keys),
      guests = createGuestServices(prisma);
    const events = new NotificationEvents(repository),
      scheduler = new NotificationScheduler(events, booking, invitation);
    // No fake external send receipts in this runtime, including local worker mode.
    const email = config.email.enabled
      ? createEmailProvider(config.email)
      : { send: () => Promise.reject(pushError('NOTIFICATION_RETRYABLE')) };
    const dispatcher = new NotificationDispatcher(
      repository,
      crypto,
      email,
      settings.fcm === null ? unavailablePush : createFcmPushProvider(settings.fcm),
      guests.readers,
    );
    const service = new NotificationService(
        repository,
        crypto,
        guests,
        config.invitationStudio.publicOrigin,
      ),
      logger = createLogger({
        level: config.runtime.logLevel,
        runtimeEnvironment: config.runtime.environment,
      });
    const tick = {
      async run() {
        await repository.recover();
        const recovery = await billingRecovery?.run(settings.bookingIds);
        if (recovery?.failed)
          logger.warn(
            { event: 'billing_worker_recovery_pending', failed: recovery.failed },
            'verified payment application needs retry',
          );
        for (const event of await readNotificationOutbox(repository)) await events.consume(event);
        await scheduler.run();
        await dispatcher.run();
        logger.info(
          {
            event: 'notification_worker_tick',
            scope: settings.bookingIds === undefined ? 'all' : 'bounded',
          },
          'notification worker tick completed',
        );
      },
    };
    let stopOperation: Promise<void> | undefined;
    const stop = () => (stopOperation ??= worker?.close() ?? Promise.resolve());
    return {
      router: createNotificationRouter(service),
      tick,
      stop,
      start() {
        if (settings.workerEnabled && worker === undefined)
          worker = startNotificationWorker(tick, () =>
            logger.error(
              { event: 'notification_worker_failed' },
              'notification worker needs retry',
            ),
          );
      },
      resource: {
        name: 'notifications-runtime',
        async close() {
          await stop();
          await prisma.$disconnect();
        },
      },
    };
  } catch (error) {
    await worker?.close();
    await prisma.$disconnect();
    throw error;
  }
}
