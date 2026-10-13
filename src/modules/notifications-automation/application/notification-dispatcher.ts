import { z } from 'zod';
import { AppError } from '../../../core/errors/app-error.js';
import { EmailDeliveryError } from '../../../integrations/email/email-delivery-error.js';
import {
  createEmailIntentIdempotencyKey,
  type EmailProvider,
} from '../../../integrations/email/email-provider.js';
import { createNotificationRecipientReader } from '../../identity-access/authorization/notification-recipient.reader.js';
import { createNotificationScopeReader } from '../../booking-lifecycle/infrastructure/notification-scope.reader.js';
import { createNotificationCutoffReader } from '../../invitation-studio/infrastructure/notification-cutoff.reader.js';
import type { GuestReaders } from '../../guest-management/application/guest-readers.js';
import type { NotificationIntent } from '../../../generated/prisma/client.js';
import {
  credentialAad,
  type NotificationRepository,
} from '../infrastructure/notification.repository.js';
import { type NotificationCrypto } from '../infrastructure/notification-crypto.js';
import type { PushProvider } from '../infrastructure/fcm-push.provider.js';
import { failureOutcome } from '../domain/notification-policy.js';
import { guestSecretSchema } from './guest-delivery.adapter.js';
import { handlers, type Purpose } from './notification-events.js';
import { workerContext } from './notification-scheduler.js';
export class NotificationDispatcher {
  constructor(
    readonly repository: NotificationRepository,
    readonly crypto: NotificationCrypto,
    readonly email: EmailProvider,
    readonly push: PushProvider,
    readonly guests: GuestReaders,
  ) {}
  async run() {
    await this.repository.recover();
    for (const row of await this.repository.claim()) await this.send(row);
  }
  private async send(row: NotificationIntent) {
    try {
      if (row.purpose === 'GUEST_INVITATION') {
        if (
          row.ciphertext === null ||
          row.secretExpiresAt === null ||
          row.secretExpiresAt <= this.repository.now() ||
          row.credentialId === null ||
          !(await this.guests.isDeliveryCurrent(
            row.bookingId,
            row.credentialId,
            workerContext('notifications:guest-delivery'),
          ))
        ) {
          await this.repository.finish(row, 'CANCELLED');
          return;
        }
        const secret = guestSecretSchema.parse(
          this.crypto.open(row.ciphertext, credentialAad(row.bookingId, row.id)),
        );
        const receipt = await this.email.send({
          to: [secret.intendedEmail],
          subject: 'Thiệp mời cưới của bạn',
          text: `Mở thiệp mời: ${secret.link}`,
          idempotencyKey: createEmailIntentIdempotencyKey({
            intentType: 'notification-email-ntf-v1',
            entityId: row.id,
          }),
        });
        await this.repository.finish(row, 'DELIVERED', receipt.messageId);
        return;
      }
      const prisma = this.repository.prisma,
        scope = createNotificationScopeReader(prisma),
        identity = createNotificationRecipientReader(prisma, this.repository.now);
      const handler = handlers[row.purpose as Purpose];
      if (handler === undefined || row.accountId === null) {
        await this.repository.finish(row, 'DEAD_LETTER', undefined, 'UNKNOWN_PURPOSE');
        return;
      }
      const schedule = await scope.schedule(row.bookingId);
      if (schedule === null) {
        await this.repository.finish(row, 'CANCELLED');
        return;
      }
      const manager = await identity.manager(row.accountId);
      const registry =
        manager && handler.manager !== null
          ? await prisma.notificationRecipient.findFirst({
              where: {
                bookingId: row.bookingId,
                accountId: row.accountId,
                purpose: handler.manager,
                enabled: true,
              },
            })
          : null;
      if (manager ? registry === null : !(await scope.canRead(row.bookingId, row.accountId))) {
        await this.repository.finish(row, 'CANCELLED');
        return;
      }
      if (['D3_REMINDER', 'MEDIA_CUTOFF'].includes(row.purpose)) {
        const cutoff =
          row.purpose === 'MEDIA_CUTOFF'
            ? await createNotificationCutoffReader(prisma).read(row.bookingId)
            : null;
        const revision =
          row.purpose === 'MEDIA_CUTOFF' ? cutoff?.revision : schedule.scheduleRevision;
        const dueAt =
          row.purpose === 'MEDIA_CUTOFF' && cutoff !== null
            ? new Date(cutoff.cutoffAt.getTime() - 86400000)
            : schedule.d3At;
        if (
          schedule.phase !== 'CONFIRMED' ||
          row.scheduleRevision !== revision ||
          dueAt.getTime() !== row.scheduledAt.getTime()
        ) {
          await this.repository.finish(row, 'CANCELLED');
          return;
        }
        if (this.repository.now().getTime() - row.scheduledAt.getTime() > 86400000) {
          await this.repository.finish(row, 'SKIPPED_STALE');
          return;
        }
      }
      const preference = await prisma.notificationPreference.findUnique({
        where: { accountId: row.accountId },
      });
      if (
        !handler.transactional &&
        (row.channel === 'EMAIL'
          ? preference?.reminderEmail === false
          : preference?.reminderPush === false)
      ) {
        await this.repository.finish(row, 'CANCELLED');
        return;
      }
      if (row.channel === 'EMAIL') {
        const to = await identity.email(row.accountId);
        if (to === null) {
          await this.repository.finish(row, 'CANCELLED');
          return;
        }
        const receipt = await this.email.send({
          to: [to],
          subject: handler.title,
          text: `${handler.title}. Mã sự kiện: ${row.bookingId}.${row.referenceId === null ? '' : ` Tham chiếu: ${row.referenceId}.`} Mở ứng dụng để xem dữ liệu và quyền thao tác hiện tại.`,
          idempotencyKey: createEmailIntentIdempotencyKey({
            intentType: 'notification-email-ntf-v1',
            entityId: row.id,
          }),
        });
        await this.repository.finish(row, 'DELIVERED', receipt.messageId);
      } else {
        const device = await prisma.notificationInstallation.findFirst({
          where: { id: row.recipientId, accountId: row.accountId, active: true },
        });
        if (
          device === null ||
          device.ciphertext === null ||
          !(await identity.android(row.accountId, device.sessionId))
        ) {
          await this.repository.finish(row, 'CANCELLED');
          return;
        }
        const token = z
          .string()
          .parse(this.crypto.open(device.ciphertext, `${device.accountId}/ANDROID/${device.id}`));
        const receipt = await this.push.send({
          token,
          intentId: row.id,
          bookingId: row.bookingId,
          title: handler.title,
          screen: handler.screen,
        });
        await this.repository.finish(row, 'DELIVERED', receipt.messageId);
      }
    } catch (error) {
      const code = error instanceof AppError ? error.code : undefined;
      if (code === 'PUSH_TOKEN_INVALID')
        await this.repository.prisma.notificationInstallation.updateMany({
          where: { id: row.recipientId },
          data: { active: false, ciphertext: null, revision: { increment: 1 } },
        });
      await this.repository.finish(
        row,
        error instanceof EmailDeliveryError
          ? error.deliveryOutcome
          : code === 'PUSH_TOKEN_INVALID'
            ? 'DEAD_LETTER'
            : failureOutcome(code),
        undefined,
        code === 'NOTIFICATION_RETRYABLE'
          ? 'PROVIDER_REJECTED'
          : code === 'PUSH_TOKEN_INVALID'
            ? 'PUSH_TOKEN_INVALID'
            : 'PROVIDER_EFFECT_UNRESOLVED',
      );
    }
  }
}
