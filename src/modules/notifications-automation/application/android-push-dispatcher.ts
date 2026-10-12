import type { NotificationIntent } from '../../../generated/prisma/client.js';
import type { FcmSender } from '../infrastructure/fcm-delivery.js';
import type { DeliveryEvidence } from '../infrastructure/email-delivery.js';
import type { NotificationEventConsumer } from '../infrastructure/event-consumer.js';
import { notificationTemplate, mandatoryEmail } from '../domain/notification-template.js';
import { parse, purpose } from '../domain/notification-policy.js';

type Evidence =
  | DeliveryEvidence
  | { outcome: 'CANCELLED' | 'SKIPPED_STALE'; errorCode: string; providerMessageId?: never };
/** Freeze targets once; accepted/ambiguous devices are never automatically resent. */
export class AndroidPushDispatcher {
  constructor(
    readonly consumer: NotificationEventConsumer,
    readonly sender: FcmSender,
    readonly accountAllowlist: readonly string[] | null = null,
  ) {}
  async send(row: NotificationIntent, accountId: string): Promise<Evidence> {
    if (this.accountAllowlist && !this.accountAllowlist.includes(accountId))
      return { outcome: 'SKIPPED_STALE', errorCode: 'TEST_PUSH_ACCOUNT_NOT_ALLOWED' };
    if (mandatoryEmail.has(parse(purpose, row.purpose)))
      return { outcome: 'CANCELLED', errorCode: 'ANDROID_PURPOSE_NOT_ALLOWED' };
    if (!(await this.authorized(row, accountId)))
      return { outcome: 'CANCELLED', errorCode: 'ANDROID_RECIPIENT_REVOKED' };
    const { prisma, now } = this.consumer.foundation;
    const targets = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "NotificationIntent" WHERE id=${row.id}::uuid FOR UPDATE`;
      const current = await tx.notificationIntent.findUniqueOrThrow({ where: { id: row.id } });
      if (current.state !== 'IN_FLIGHT' || current.leaseId !== row.leaseId) return null;
      if (!current.pushTargetsFrozenAt) {
        const devices = await tx.notificationInstallation.findMany({
          where: { accountId, enabled: true, pushToken: { not: null } },
          orderBy: { id: 'asc' },
          take: 5,
        });
        for (const device of devices)
          await tx.notificationPushDelivery.create({
            data: {
              intentId: row.id,
              installationId: device.id,
              installationRevision: device.revision,
              updatedAt: now(),
            },
          });
        await tx.notificationIntent.update({
          where: { id: row.id },
          data: { pushTargetsFrozenAt: now(), revision: { increment: 1 } },
        });
      }
      return tx.notificationPushDelivery.findMany({
        where: { intentId: row.id },
        orderBy: { installationId: 'asc' },
      });
    });
    if (!targets) return { outcome: 'UNKNOWN', errorCode: 'LEASE_EXPIRED' };
    if (!targets.length) return { outcome: 'CANCELLED', errorCode: 'ANDROID_DEVICE_UNAVAILABLE' };
    const template = notificationTemplate(parse(purpose, row.purpose), row.data);
    for (const target of targets) {
      if (!['QUEUED', 'RETRYABLE_FAILED'].includes(target.state)) continue;
      if (target.retryNotBefore && target.retryNotBefore > now()) continue;
      const lease = await prisma.notificationIntent.findUniqueOrThrow({ where: { id: row.id } });
      if (
        lease.state !== 'IN_FLIGHT' ||
        lease.leaseId !== row.leaseId ||
        !lease.leaseExpiresAt ||
        lease.leaseExpiresAt.getTime() - now().getTime() <= 20000
      )
        return { outcome: 'UNKNOWN', errorCode: 'LEASE_EXPIRED' };
      const claimed = await prisma.notificationPushDelivery.updateMany({
        where: {
          intentId: row.id,
          installationId: target.installationId,
          state: { in: ['QUEUED', 'RETRYABLE_FAILED'] },
        },
        data: { state: 'IN_FLIGHT', leaseId: row.leaseId, updatedAt: now() },
      });
      if (!claimed.count) continue;
      const device = await prisma.notificationInstallation.findUnique({
        where: { id: target.installationId },
      });
      const valid =
        device?.enabled &&
        device.pushToken &&
        device.accountId === accountId &&
        device.revision === target.installationRevision &&
        (await this.consumer.identity.androidSession(accountId, device.sessionId)) &&
        (await this.authorized(row, accountId));
      const evidence: Evidence =
        valid && row.bookingId
          ? await this.sender.send({
              token: device.pushToken!,
              title: template.subject,
              notificationId: row.id,
              bookingId: row.bookingId,
              purpose: row.purpose,
              owner: row.owner,
              ...(template.data.referenceId ? { referenceId: template.data.referenceId } : {}),
            })
          : { outcome: 'CANCELLED', errorCode: 'ANDROID_DEVICE_REVOKED' };
      // A concurrent token refresh must not be disabled by an older token's rejection.
      if (evidence.errorCode === 'FCM_UNREGISTERED' && device)
        await prisma.notificationInstallation.updateMany({
          where: {
            id: device.id,
            revision: target.installationRevision,
            pushToken: device.pushToken,
          },
          data: { enabled: false, pushToken: null, revision: { increment: 1 } },
        });
      await prisma.notificationPushDelivery.updateMany({
        where: {
          intentId: row.id,
          installationId: target.installationId,
          state: 'IN_FLIGHT',
          leaseId: row.leaseId,
        },
        data: {
          state: evidence.outcome,
          providerMessageId: evidence.providerMessageId ?? null,
          errorCode: evidence.errorCode ?? null,
          retryNotBefore: 'retryNotBefore' in evidence ? (evidence.retryNotBefore ?? null) : null,
          updatedAt: now(),
        },
      });
    }
    const records = await prisma.notificationPushDelivery.findMany({ where: { intentId: row.id } });
    if (records.some((r) => ['IN_FLIGHT', 'UNKNOWN'].includes(r.state)))
      return { outcome: 'UNKNOWN', errorCode: 'FCM_RESULT_UNKNOWN' };
    const retrying = records.filter((r) => ['QUEUED', 'RETRYABLE_FAILED'].includes(r.state));
    if (retrying.length) {
      const deadlines = retrying.flatMap((r) =>
        r.retryNotBefore ? [r.retryNotBefore.getTime()] : [],
      );
      return {
        outcome: 'RETRYABLE_FAILED',
        errorCode: 'FCM_TEMPORARILY_UNAVAILABLE',
        ...(deadlines.length ? { retryNotBefore: new Date(Math.max(...deadlines)) } : {}),
      };
    }
    if (records.some((r) => r.state === 'DEAD_LETTER'))
      return { outcome: 'DEAD_LETTER', errorCode: 'FCM_DEVICE_DELIVERY_FAILED' };
    const accepted = records.find((r) => r.state === 'ACCEPTED');
    return accepted
      ? { outcome: 'ACCEPTED', providerMessageId: accepted.providerMessageId! }
      : { outcome: 'CANCELLED', errorCode: 'ANDROID_DEVICE_REVOKED' };
  }
  private async authorized(row: NotificationIntent, accountId: string) {
    const prisma = this.consumer.foundation.prisma;
    const [recipient, account, booking, preference] = await Promise.all([
      prisma.notificationRecipient.findUnique({ where: { id: row.recipientId } }),
      this.consumer.identity.account(accountId),
      row.bookingId ? this.consumer.booking.read(row.bookingId) : null,
      prisma.notificationPreference.findUnique({ where: { accountId } }),
    ]);
    return Boolean(
      recipient?.enabled &&
      recipient.accountId === accountId &&
      recipient.purposes.includes(row.purpose) &&
      account &&
      booking &&
      preference?.reminderPush !== false &&
      (booking.phase !== 'CANCELLED' || row.purpose === 'CANCELLATION_NOTICE') &&
      (booking.couples.some((c) => c.accountId === accountId && c.level === 'FULL') ||
        (recipient.operational &&
          account.roles.includes('MANAGER') &&
          booking.managerAccountId === accountId)),
    );
  }
}
