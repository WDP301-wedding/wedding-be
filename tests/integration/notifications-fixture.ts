import { randomBytes, randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';
import { createGuestServices } from '../../src/modules/guest-management/infrastructure/guest.composition.js';
import { NotificationRepository } from '../../src/modules/notifications-automation/infrastructure/notification.repository.js';
import { NotificationCrypto } from '../../src/modules/notifications-automation/infrastructure/notification-crypto.js';
import { NotificationEvents } from '../../src/modules/notifications-automation/application/notification-events.js';
import { NotificationService } from '../../src/modules/notifications-automation/application/notification.service.js';
import { NotificationDispatcher } from '../../src/modules/notifications-automation/application/notification-dispatcher.js';
import {
  createEmailIntentIdempotencyKey,
  type SendEmailCommand,
} from '../../src/integrations/email/email-provider.js';
import type { PushCommand } from '../../src/modules/notifications-automation/infrastructure/fcm-push.provider.js';
export async function notificationFixture(prisma: PrismaClient) {
  const f = await studioFixture(prisma);
  let now = f.now;
  const repository = new NotificationRepository(prisma, () => now, [f.bookingId]),
    crypto = new NotificationCrypto('v1', new Map([['v1', randomBytes(32)]])),
    guests = createGuestServices(prisma, () => now),
    events = new NotificationEvents(repository),
    service = new NotificationService(repository, crypto, guests, 'https://wedding.example.test');
  const emails: SendEmailCommand[] = [],
    pushes: PushCommand[] = [];
  const email = {
    send(command: SendEmailCommand) {
      emails.push(command);
      return Promise.resolve({
        messageId: randomUUID(),
        idempotencyKey: createEmailIntentIdempotencyKey({
          intentType: 'notification-email-ntf-v1',
          entityId: command.idempotencyKey.split('/')[1]!,
        }),
      });
    },
  };
  const push = {
    send(command: PushCommand) {
      pushes.push(command);
      return Promise.resolve({ messageId: randomUUID() });
    },
  };
  const dispatcher = new NotificationDispatcher(repository, crypto, email, push, guests.readers);
  const publish = async () => {
    const design = await f.services.designs.create(
      { bookingId: f.bookingId, content: f.content, idempotencyKey: randomUUID() },
      f.couple,
    );
    return f.services.publication.publish(
      {
        bookingId: f.bookingId,
        designId: design.designId,
        designRevisionId: design.revisionId,
        expectedRevision: 1,
        expectedPublicationRevision: 0,
        idempotencyKey: randomUUID(),
      },
      f.couple,
    );
  };
  const event = (
    eventType = 'booking.completed',
    sequence = 1,
    payload: unknown = { bookingId: f.bookingId },
  ) => ({
    eventId: randomUUID(),
    bookingId: f.bookingId,
    eventType,
    producer: eventType.split('.')[0] as
      'booking' | 'billing' | 'invitation' | 'guest' | 'identity',
    eventVersion: 1,
    sourceSequence: sequence,
    payload,
  });
  return {
    f,
    repository,
    crypto,
    guests,
    events,
    service,
    dispatcher,
    email,
    push,
    emails,
    pushes,
    publish,
    event,
    get now() {
      return now;
    },
    setNow: (value: Date) => {
      now = value;
    },
  };
}
