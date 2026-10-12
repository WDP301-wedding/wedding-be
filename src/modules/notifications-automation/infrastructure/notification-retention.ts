import type { NotificationFoundation } from './notification-foundation.js';
import type { createNotificationIdentityReader } from '../../identity-access/authorization/notification-recipient.reader.js';

/** Private content retention; immutable delivery/dedup facts remain available. */
export class NotificationRetention {
  constructor(
    readonly foundation: NotificationFoundation,
    readonly identity: ReturnType<typeof createNotificationIdentityReader>,
  ) {}
  async run() {
    const { prisma, now } = this.foundation,
      current = now();
    const expired = await prisma.notificationCredential.findMany({
      where: { purgedAt: null, expiresAt: { lte: current } },
      orderBy: [{ expiresAt: 'asc' }, { intentId: 'asc' }],
      take: 100,
      select: { intentId: true },
    });
    const credentials = expired.length
      ? (
          await prisma.notificationCredential.updateMany({
            where: { intentId: { in: expired.map((e) => e.intentId) }, purgedAt: null },
            data: { ciphertext: null, nonce: null, tag: null, purgedAt: current },
          })
        ).count
      : 0;
    const stale = await prisma.notificationInbox.findMany({
      where: { createdAt: { lte: new Date(current.getTime() - 90 * 86400000) } },
      take: 100,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    const inbox = stale.length
      ? (
          await prisma.notificationInbox.deleteMany({
            where: { id: { in: stale.map((i) => i.id) } },
          })
        ).count
      : 0;
    const candidates = await prisma.notificationRecipient.findMany({
      where: { deliveryEmail: { not: null }, nextRetentionAt: { lte: current } },
      orderBy: [{ nextRetentionAt: 'asc' }, { id: 'asc' }],
      take: 100,
    });
    let recipients = 0;
    for (const row of candidates) {
      const activeAccount = row.accountId ? await this.identity.account(row.accountId) : null;
      const pendingCredential = row.guestId
        ? await prisma.notificationIntent.findFirst({
            where: {
              recipientId: row.id,
              state: { in: ['QUEUED', 'IN_FLIGHT', 'RETRYABLE_FAILED', 'UNKNOWN'] },
              credential: { is: { purgedAt: null, expiresAt: { gt: current } } },
            },
            select: { id: true },
          })
        : null;
      const purge = !row.enabled || (row.accountId ? !activeAccount : !pendingCredential);
      const changed = await prisma.notificationRecipient.updateMany({
        where: { id: row.id, revision: row.revision, deliveryEmail: { not: null } },
        data: {
          nextRetentionAt: new Date(current.getTime() + 60000),
          ...(purge ? { deliveryEmail: null, enabled: false, revision: { increment: 1 } } : {}),
        },
      });
      if (purge) recipients += changed.count;
    }
    return { credentials, inbox, recipients };
  }
}
