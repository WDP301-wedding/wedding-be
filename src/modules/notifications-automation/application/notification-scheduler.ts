import { randomUUID } from 'node:crypto';
import type { BookingAutomationPort } from '../../booking-lifecycle/application/automation.js';
import type { InvitationAutomationReader } from '../../invitation-studio/application/automation.contracts.js';
import type { ContractContext } from '../../../core/database/booking-boundary.js';
import { AppError } from '../../../core/errors/app-error.js';
import type { NotificationEventConsumer } from '../infrastructure/event-consumer.js';
import { scheduledId } from '../domain/scheduled-id.js';
import { notificationChannels } from '../domain/notification-template.js';

export class NotificationScheduler {
  constructor(
    readonly consumer: NotificationEventConsumer,
    readonly booking: BookingAutomationPort,
    readonly invitation: InvitationAutomationReader,
    readonly bookingAllowlist: readonly string[] | null = null,
  ) {}
  async tick() {
    const { prisma, now } = this.consumer.foundation;
    for (const kind of ['D3_REMINDER', 'COMPLETION', 'MEDIA_CUTOFF'] as const) {
      const fence = new Date(now().getTime() + (kind === 'MEDIA_CUTOFF' ? 86400000 : 0));
      let scan = await prisma.notificationScheduleScan.upsert({
        where: { kind },
        create: { kind, dueBefore: fence },
        update: {},
      });
      if (scan.cursor === null && scan.dueBefore.getTime() !== fence.getTime()) {
        const changed = await prisma.notificationScheduleScan.updateMany({
          where: { kind, revision: scan.revision },
          data: { dueBefore: fence, revision: { increment: 1 } },
        });
        if (changed.count !== 1) continue;
        scan = await prisma.notificationScheduleScan.findUniqueOrThrow({ where: { kind } });
      }
      const context = workerContext(
        kind === 'MEDIA_CUTOFF' ? 'notifications:media-cutoff' : 'notifications:booking',
      );
      const query = {
        dueBefore: scan.dueBefore.toISOString(),
        limit: 100,
        ...(scan.cursor ? { cursor: scan.cursor } : {}),
      };
      let nextCursor: string | null;
      if (kind === 'MEDIA_CUTOFF') {
        const page = await this.invitation.listMediaCutoffs(query, context);
        nextCursor = page.nextCursor;
        for (const row of page.items) {
          if (this.bookingAllowlist && !this.bookingAllowlist.includes(row.bookingId)) continue;
          if (row.policyRevision < 1) continue;
          await this.reminder(
            row.bookingId,
            kind,
            row.policyRevision,
            new Date(new Date(row.cutoffAt).getTime() - 86400000).toISOString(),
          );
        }
      } else {
        const page = await this.booking.listDue({ ...query, kind }, context);
        nextCursor = page.nextCursor;
        for (const row of page.items) {
          if (this.bookingAllowlist && !this.bookingAllowlist.includes(row.bookingId)) continue;
          if (kind === 'COMPLETION') {
            await prisma.notificationDueCommand.upsert({
              where: {
                bookingId_expectedRevision: {
                  bookingId: row.bookingId,
                  expectedRevision: row.bookingRevision,
                },
              },
              create: {
                id: scheduledId([row.bookingId, 'COMPLETION', row.bookingRevision]),
                bookingId: row.bookingId,
                expectedRevision: row.bookingRevision,
                requestedAt: now(),
              },
              update: {},
            });
          } else {
            const snapshot = await this.consumer.booking.read(row.bookingId);
            if (snapshot?.scheduleRevision)
              await this.reminder(row.bookingId, kind, snapshot.scheduleRevision, row.dueAt);
          }
        }
      }
      await prisma.notificationScheduleScan.updateMany({
        where: { kind, revision: scan.revision },
        data: { cursor: nextCursor, revision: { increment: 1 } },
      });
    }
    await this.complete();
  }
  private async reminder(
    bookingId: string,
    purpose: 'D3_REMINDER' | 'MEDIA_CUTOFF',
    revision: number,
    dueAt: string,
  ) {
    const b = await this.consumer.booking.read(bookingId);
    if (!b || b.phase !== 'CONFIRMED') return;
    const eventId = scheduledId([bookingId, purpose, revision, dueAt]);
    const recipients: string[] = [];
    for (const couple of b.couples.filter((c) => c.level === 'FULL')) {
      if (!(await this.consumer.identity.account(couple.accountId))) continue;
      const r = await this.consumer.coupleRecipient(couple.accountId, purpose);
      if (r.enabled) recipients.push(r.id);
    }
    if (purpose === 'D3_REMINDER' && b.managerAccountId) {
      const manager = await this.consumer.identity.account(b.managerAccountId);
      if (manager?.roles.includes('MANAGER')) {
        const r = await this.consumer.foundation.prisma.notificationRecipient.findFirst({
          where: {
            accountId: b.managerAccountId,
            operational: true,
            enabled: true,
            purposes: { has: purpose },
          },
        });
        if (r) recipients.push(r.id);
      }
    }
    for (const recipientId of new Set(recipients))
      for (const channel of notificationChannels(purpose, this.consumer.androidEnabled)) {
        await this.consumer.foundation.enqueue({
          eventId,
          owner: purpose === 'MEDIA_CUTOFF' ? 'invitation-studio' : 'booking-lifecycle',
          bookingId,
          recipientId,
          channel,
          purpose,
          templateVersion: 1,
          scheduledAt: dueAt,
          scheduleRevision: revision,
          data: { revision, eventDate: b.eventDate.toISOString().slice(0, 10) },
        });
      }
  }
  async complete() {
    const { prisma } = this.consumer.foundation;
    const rows = await prisma.notificationDueCommand.findMany({
      where: { state: 'PENDING' },
      orderBy: [{ requestedAt: 'asc' }, { id: 'asc' }],
      take: 100,
    });
    for (const row of rows) {
      if (this.bookingAllowlist && !this.bookingAllowlist.includes(row.bookingId)) continue;
      try {
        const result = await this.booking.completeDue(
          {
            bookingId: row.bookingId,
            expectedBookingRevision: row.expectedRevision,
            commandId: row.id,
            now: row.requestedAt.toISOString(),
          },
          { ...workerContext('notifications:booking'), requestId: row.id, causationId: row.id },
        );
        if (result.outcome === 'NOT_DUE') continue;
        await prisma.notificationDueCommand.updateMany({
          where: { id: row.id, state: 'PENDING' },
          data: { state: 'DONE' },
        });
      } catch (error) {
        if (error instanceof AppError && error.code === 'STALE_BOOKING_REVISION') {
          await prisma.notificationDueCommand.updateMany({
            where: { id: row.id, state: 'PENDING' },
            data: { state: 'CONFLICT' },
          });
        } else throw error;
      }
    }
  }
}
export function workerContext(purpose: string): ContractContext {
  const id = randomUUID();
  return { requestId: id, causationId: id, authority: 'SYSTEM', actorAccountId: null, purpose };
}
