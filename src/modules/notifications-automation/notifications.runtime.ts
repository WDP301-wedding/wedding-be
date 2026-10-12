import type { Logger } from 'pino';
import type { Registry } from 'prom-client';
import type { Config } from '../../config/config.js';
import { createPrismaClient } from '../../core/database/prisma.js';
import { AppError } from '../../core/errors/app-error.js';
import { createGuestServices } from '../guest-management/infrastructure/guest.composition.js';
import { createBookingLifecycleProviders } from '../booking-lifecycle/booking-lifecycle.providers.js';
import { createNotificationBookingReader } from '../booking-lifecycle/infrastructure/notification-context.reader.js';
import { createNotificationIdentityReader } from '../identity-access/authorization/notification-recipient.reader.js';
import {
  createConsultationAccessReader,
  createPrismaConsultationAccessRepository,
} from '../identity-access/authorization/authorization.service.js';
import { PrismaInvitationAutomationReader } from '../invitation-studio/infrastructure/prisma-automation.reader.js';
import { NotificationFoundation } from './infrastructure/notification-foundation.js';
import { NotificationEventConsumer } from './infrastructure/event-consumer.js';
import { NotificationEmailDelivery } from './infrastructure/email-delivery.js';
import { NotificationFcmDelivery } from './infrastructure/fcm-delivery.js';
import { AndroidPushDispatcher } from './application/android-push-dispatcher.js';
import { CredentialCipher } from './infrastructure/credential-cipher.js';
import { createGuestDeliveryAdapter } from './infrastructure/guest-delivery.adapter.js';
import { NotificationScheduler } from './application/notification-scheduler.js';
import { NotificationDispatcher } from './application/notification-dispatcher.js';
import { NotificationWorker } from './application/notification-worker.js';
import { NotificationSettings } from './application/notification-settings.js';
import { createNotificationRouter } from './http/notification.router.js';

export async function createNotificationsRuntime(
  config: Config,
  logger: Logger,
  registry: Registry,
) {
  const prisma = createPrismaClient(config.database.url);
  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    const guests = createGuestServices(prisma);
    const foundation = new NotificationFoundation(prisma, guests.guests.now, guests.boundary);
    const bookingReader = createNotificationBookingReader(prisma);
    const consumer = new NotificationEventConsumer(
      foundation,
      bookingReader,
      createNotificationIdentityReader(prisma),
      config.notifications.fcm.enabled,
    );
    const access = createConsultationAccessReader(createPrismaConsultationAccessRepository(prisma));
    const booking = createBookingLifecycleProviders(
      prisma,
      access,
      undefined,
      config.identityAccess.retentionDays.disabledAccountPii,
    );
    const automation = booking.createAutomationWorker((context) => {
      if (context.purpose !== 'notifications:booking')
        throw new AppError({
          status: 403,
          code: 'FORBIDDEN',
          message: 'The notification worker purpose is required.',
        });
      return Promise.resolve();
    });
    const invitation = new PrismaInvitationAutomationReader(prisma),
      policy = config.notifications;
    const cipher =
      policy.credentialKeys && policy.activeKeyVersion
        ? new CredentialCipher(policy.credentialKeys, policy.activeKeyVersion)
        : null;
    const scheduler = new NotificationScheduler(
      consumer,
      automation,
      invitation,
      policy.bookingAllowlist,
    );
    const dispatcher = new NotificationDispatcher(
      consumer,
      new NotificationEmailDelivery(config.email),
      guests.links,
      invitation,
      cipher,
      policy,
      policy.fcm.enabled
        ? new AndroidPushDispatcher(
            consumer,
            new NotificationFcmDelivery(policy.fcm),
            policy.fcm.accountAllowlist,
          )
        : null,
    );
    const worker = new NotificationWorker(scheduler, dispatcher, logger, registry);
    const settings = new NotificationSettings(foundation, guests.identity.resolver, bookingReader);
    return Object.freeze({
      router: createNotificationRouter(
        settings,
        guests,
        cipher && policy.workerEnabled
          ? createGuestDeliveryAdapter(guests, foundation, cipher)
          : null,
      ),
      start: () => {
        if (policy.workerEnabled) worker.start();
      },
      resource: Object.freeze({
        name: 'notifications-automation',
        close: async () => {
          await worker.close();
          await prisma.$disconnect();
        },
      }),
    });
  } catch (error) {
    await prisma.$disconnect();
    throw error;
  }
}
