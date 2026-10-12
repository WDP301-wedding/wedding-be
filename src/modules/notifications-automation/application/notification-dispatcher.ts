import { z } from 'zod';
import type { NotificationIntent } from '../../../generated/prisma/client.js';
import type { GuestLinksService } from '../../guest-management/application/guest-links.service.js';
import { createEmailIntentIdempotencyKey } from '../../../integrations/email/email-provider.js';
import type { NotificationEventConsumer } from '../infrastructure/event-consumer.js';
import type { CredentialCipher } from '../infrastructure/credential-cipher.js';
import type {
  NotificationEmailDelivery,
  DeliveryEvidence,
} from '../infrastructure/email-delivery.js';
import { notificationTemplate, mandatoryEmail } from '../domain/notification-template.js';
import { purpose as purposeSchema, parse } from '../domain/notification-policy.js';
import { workerContext } from './notification-scheduler.js';
import type { InvitationAutomationReader } from '../../invitation-studio/application/automation.contracts.js';
import { NotificationRetention } from '../infrastructure/notification-retention.js';
import type { AndroidPushDispatcher } from './android-push-dispatcher.js';

export interface DispatchPolicy {
  emailAllowlist: readonly string[] | null;
  bookingAllowlist: readonly string[] | null;
  guestLinkUrl: string | null;
}
export class NotificationDispatcher {
  constructor(
    readonly consumer: NotificationEventConsumer,
    readonly email: NotificationEmailDelivery,
    readonly guest: GuestLinksService,
    readonly invitation: InvitationAutomationReader,
    readonly cipher: CredentialCipher | null,
    readonly policy: DispatchPolicy,
    readonly push: AndroidPushDispatcher | null = null,
  ) {}
  async send(
    row: NotificationIntent,
  ): Promise<DeliveryEvidence | { outcome: 'CANCELLED' | 'SKIPPED_STALE'; errorCode: string }> {
    const { prisma, now } = this.consumer.foundation;
    const lease = await prisma.notificationIntent.findUnique({
      where: { id: row.id },
      select: { state: true, leaseId: true, leaseExpiresAt: true },
    });
    if (
      lease?.state !== 'IN_FLIGHT' ||
      lease.leaseId !== row.leaseId ||
      !lease.leaseExpiresAt ||
      lease.leaseExpiresAt.getTime() - now().getTime() <= 10000
    )
      return { outcome: 'UNKNOWN', errorCode: 'LEASE_EXPIRED' };
    const recipient = await prisma.notificationRecipient.findUnique({
      where: { id: row.recipientId },
    });
    const purpose = parse(purposeSchema, row.purpose);
    if (!recipient?.enabled || !recipient.purposes.includes(purpose))
      return cancelled('RECIPIENT_REVOKED');
    if (
      this.policy.bookingAllowlist &&
      (!row.bookingId || !this.policy.bookingAllowlist.includes(row.bookingId))
    )
      return skipped('TEST_BOOKING_NOT_ALLOWED');
    const booking = row.bookingId ? await this.consumer.booking.read(row.bookingId) : null;
    if (row.bookingId && !booking) return cancelled('BOOKING_UNAVAILABLE');
    if (
      booking?.phase === 'CANCELLED' &&
      purpose !== 'CANCELLATION_NOTICE' &&
      row.owner !== 'payments-billing'
    )
      return cancelled('BOOKING_CANCELLED');
    const template = notificationTemplate(purpose, row.data);
    if (
      purpose === 'TIMELINE_REVIEW' &&
      template.data.referenceId !== booking?.currentTimelineRevisionId
    )
      return skipped('TIMELINE_SUPERSEDED');
    if (purpose === 'D3_REMINDER' || purpose === 'MEDIA_CUTOFF') {
      if (booking?.phase !== 'CONFIRMED') return skipped('BOOKING_TERMINAL');
      if (now().getTime() - row.scheduledAt.getTime() > 86400000)
        return skipped('REMINDER_TOO_LATE');
      if (purpose === 'D3_REMINDER' && row.scheduleRevision !== booking.scheduleRevision)
        return skipped('SCHEDULE_CHANGED');
      if (purpose === 'MEDIA_CUTOFF') {
        const cutoff = await this.invitation.readMediaCutoff(
          row.bookingId!,
          workerContext('notifications:media-cutoff'),
        );
        const matched =
          cutoff?.policyRevision === row.scheduleRevision &&
          new Date(cutoff.cutoffAt).getTime() - 86400000 === row.scheduledAt.getTime();
        if (!matched) return skipped('CUTOFF_CHANGED');
      }
    }
    let destination = recipient.deliveryEmail;
    if (recipient.accountId) {
      const account = await this.consumer.identity.account(recipient.accountId);
      if (!account) return cancelled('ACCOUNT_REVOKED');
      const owningCouple = booking?.couples.some((c) => c.accountId === account.accountId);
      const assignedManager =
        recipient.operational &&
        account.roles.includes('MANAGER') &&
        booking?.managerAccountId === account.accountId;
      if (booking && !owningCouple && !assignedManager) return cancelled('RECIPIENT_SCOPE_REVOKED');
      destination ??= account.email;
      if (row.channel === 'IN_APP') {
        await prisma.notificationInbox.upsert({
          where: { intentId_accountId: { intentId: row.id, accountId: account.accountId } },
          create: {
            intentId: row.id,
            accountId: account.accountId,
            bookingId: row.bookingId,
            createdAt: now(),
          },
          update: {},
        });
        return { outcome: 'DELIVERED' };
      }
      const preference = await prisma.notificationPreference.findUnique({
        where: { accountId: account.accountId },
      });
      if (
        row.channel === 'EMAIL' &&
        !mandatoryEmail.has(purpose) &&
        preference?.reminderEmail === false
      )
        return cancelled('EMAIL_PREFERENCE_DISABLED');
    }
    if (row.channel === 'ANDROID')
      return this.push && recipient.accountId
        ? this.push.send(row, recipient.accountId)
        : { outcome: 'DEAD_LETTER', errorCode: 'ANDROID_PROVIDER_DISABLED' };
    if (row.channel !== 'EMAIL' || !destination || !z.email().safeParse(destination).success)
      return { outcome: 'DEAD_LETTER', errorCode: 'DESTINATION_INVALID' };
    if (
      this.policy.emailAllowlist &&
      !this.policy.emailAllowlist.includes(destination.toLowerCase())
    )
      return skipped('TEST_RECIPIENT_NOT_ALLOWED');
    let text = template.text;
    if (purpose === 'GUEST_INVITATION') {
      const sealed = await prisma.notificationCredential.findUnique({
        where: { intentId: row.id },
      });
      if (sealed && sealed.expiresAt <= now()) return skipped('CREDENTIAL_EXPIRED');
      if (!this.cipher || !sealed?.ciphertext || !sealed.nonce || !sealed.tag || !row.bookingId)
        return { outcome: 'DEAD_LETTER', errorCode: 'GUEST_DELIVERY_UNAVAILABLE' };
      let raw: string;
      try {
        raw = this.cipher.open(
          {
            keyVersion: sealed.keyVersion,
            nonce: sealed.nonce,
            tag: sealed.tag,
            ciphertext: sealed.ciphertext,
            expiresAt: sealed.expiresAt,
          },
          { bookingId: row.bookingId, intentId: row.id, purpose },
        );
      } catch {
        return { outcome: 'DEAD_LETTER', errorCode: 'CREDENTIAL_DECRYPTION_FAILED' };
      }
      let target: Awaited<ReturnType<GuestLinksService['validateDeliveryCredential']>>;
      try {
        target = await this.guest.validateDeliveryCredential(
          raw,
          row.bookingId,
          sealed.credentialId,
        );
      } catch {
        return cancelled('GUEST_CREDENTIAL_REVOKED');
      }
      const link = new URL(this.policy.guestLinkUrl ?? target.publicUrl);
      link.hash = raw;
      text = `Bạn nhận được lời mời dự tiệc. Mở liên kết riêng để xem thiệp: ${link.toString()}`;
    }
    return this.email.send({
      subject: template.subject,
      text,
      to: [destination],
      idempotencyKey: createEmailIntentIdempotencyKey({
        entityId: row.id,
        intentType: `notification-email-v${row.templateVersion}`,
      }),
    });
  }
  async reconcile() {
    const { prisma, now } = this.consumer.foundation;
    const rows = await prisma.notificationIntent.findMany({
      where: { state: 'UNKNOWN', nextReconcileAt: { lte: now() } },
      orderBy: [{ nextReconcileAt: 'asc' }, { id: 'asc' }],
      take: 100,
    });
    for (const row of rows) {
      if (row.channel === 'IN_APP') {
        const inbox = await prisma.notificationInbox.findFirst({ where: { intentId: row.id } });
        if (inbox)
          await this.consumer.foundation.recordOutcome(row.id, row.leaseId!, 'DELIVERED', {});
      } else if (row.channel === 'EMAIL') {
        const accepted = await prisma.notificationAttempt.findFirst({
          where: { intentId: row.id, leaseId: row.leaseId!, providerMessageId: { not: null } },
          orderBy: { occurredAt: 'desc' },
        });
        if (accepted?.providerMessageId) {
          const evidence = await this.email.reconcile(accepted.providerMessageId);
          if (evidence.outcome === 'DELIVERED' || evidence.outcome === 'DEAD_LETTER') {
            const { outcome, ...metadata } = evidence;
            await this.consumer.foundation.recordOutcome(row.id, row.leaseId!, outcome, metadata);
          }
        }
      }
      await prisma.notificationIntent.updateMany({
        where: { id: row.id, state: 'UNKNOWN', revision: row.revision },
        data: { nextReconcileAt: new Date(now().getTime() + 60000), revision: { increment: 1 } },
      });
    }
    await new NotificationRetention(this.consumer.foundation, this.consumer.identity).run();
  }
}
const cancelled = (errorCode: string) => ({ outcome: 'CANCELLED' as const, errorCode });
const skipped = (errorCode: string) => ({ outcome: 'SKIPPED_STALE' as const, errorCode });
