import { createHash, randomUUID } from 'node:crypto';
import type { BookingAutomationPort } from '../../booking-lifecycle/application/automation.js';
import type { InvitationAutomationReader } from '../../invitation-studio/application/automation.contracts.js';
import type { ContractContext } from '../../../core/database/booking-boundary.js';
import { AppError } from '../../../core/errors/app-error.js';
import { type NotificationEvents } from './notification-events.js';

export function scheduleId(bookingId: string, purpose: string, revision: number, dueAt: string) {
  const h = createHash('sha256')
    .update(`${bookingId}/${purpose}/${revision}/${dueAt}`)
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export const workerContext = (purpose: string): ContractContext => ({
  requestId: randomUUID(),
  causationId: randomUUID(),
  actorAccountId: null,
  authority: 'SYSTEM',
  purpose,
});
export class NotificationScheduler {
  constructor(
    readonly events: NotificationEvents,
    readonly booking: BookingAutomationPort,
    readonly invitation: InvitationAutomationReader,
  ) {}
  private allowed(bookingId: string) {
    return (
      this.events.repository.bookingIds === undefined ||
      this.events.repository.bookingIds.includes(bookingId)
    );
  }
  private async scan<T>(
    kind: string,
    fence: Date,
    read: (
      dueBefore: string,
      cursor: string | null,
    ) => Promise<{ items: readonly T[]; nextCursor: string | null }>,
    visit: (item: T) => Promise<void>,
  ) {
    const scope = this.events.repository.bookingIds;
    const name = `${kind}/${
      scope === undefined
        ? 'all'
        : createHash('sha256')
            .update([...scope].sort().join(','))
            .digest('hex')
    }`;
    const prisma = this.events.repository.prisma;
    await prisma.notificationScan.createMany({
      data: [{ name, fence }],
      skipDuplicates: true,
    });
    const saved = await prisma.notificationScan.findUniqueOrThrow({ where: { name } });
    let cursor = saved.cursor;
    const scanFence = cursor === null ? fence : saved.fence;
    for (let page = 0; page < 10; page++) {
      const result = await read(scanFence.toISOString(), cursor);
      for (const item of result.items) await visit(item);
      cursor = result.nextCursor;
      await prisma.notificationScan.update({
        where: { name },
        data: { cursor, fence: scanFence },
      });
      if (cursor === null) break;
    }
  }
  async run() {
    const now = this.events.repository.now();
    const pending = await this.events.repository.prisma.notificationDueCommand.findMany({
      where: {
        outcome: { in: ['RETRY_PENDING', 'NOT_DUE'] },
        ...(this.events.repository.bookingIds === undefined
          ? {}
          : { bookingId: { in: [...this.events.repository.bookingIds] } }),
      },
      orderBy: { dueAt: 'asc' },
      take: 100,
    });
    for (const command of pending)
      await this.complete(
        command.bookingId,
        command.expectedRevision,
        command.dueAt.toISOString(),
        command.requestedAt,
      );
    for (const kind of ['D3_REMINDER', 'COMPLETION'] as const) {
      await this.scan(
        kind,
        now,
        (dueBefore, cursor) =>
          this.booking.listDue(
            { kind, dueBefore, limit: 100, ...(cursor === null ? {} : { cursor }) },
            workerContext(`notifications:${kind.toLowerCase()}`),
          ),
        async (item) => {
          if (!this.allowed(item.bookingId)) return;
          if (kind === 'COMPLETION')
            await this.complete(item.bookingId, item.bookingRevision, item.dueAt, now);
          else
            await this.reminder(
              item.bookingId,
              'D3_REMINDER',
              item.scheduleRevision ?? item.bookingRevision,
              item.dueAt,
              now,
            );
        },
      );
    }
    await this.scan(
      'MEDIA_CUTOFF',
      new Date(now.getTime() + 86400000),
      (dueBefore, cursor) =>
        this.invitation.listMediaCutoffs(
          { dueBefore, limit: 100, ...(cursor === null ? {} : { cursor }) },
          workerContext('notifications:media-cutoff'),
        ),
      async (item) => {
        if (this.allowed(item.bookingId))
          await this.reminder(
            item.bookingId,
            'MEDIA_CUTOFF',
            item.policyRevision,
            new Date(new Date(item.cutoffAt).getTime() - 86400000).toISOString(),
            now,
          );
      },
    );
  }
  private async reminder(
    bookingId: string,
    purpose: 'D3_REMINDER' | 'MEDIA_CUTOFF',
    revision: number,
    dueAt: string,
    now: Date,
  ) {
    const eventId = scheduleId(bookingId, purpose, revision, dueAt);
    await this.events.repository.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`notifications:${bookingId}`}))`;
      for (const accountId of await this.events.recipients(tx, bookingId, purpose))
        await this.events.enqueueFor(
          tx,
          eventId,
          bookingId,
          purpose,
          accountId,
          new Date(dueAt),
          revision,
        );
      if (now.getTime() - new Date(dueAt).getTime() > 86400000)
        await tx.notificationIntent.updateMany({
          where: { eventId, state: { in: ['QUEUED', 'RETRYABLE_FAILED'] } },
          data: { state: 'SKIPPED_STALE', revision: { increment: 1 } },
        });
    });
  }
  private async complete(bookingId: string, revision: number, dueAt: string, now: Date) {
    const id = scheduleId(bookingId, 'COMPLETION', revision, dueAt),
      prisma = this.events.repository.prisma;
    // Empty-update ORM upserts can race through read/create. Let PostgreSQL
    // arbitrate the durable identity, then use the exact existing command.
    await prisma.notificationDueCommand.createMany({
      data: [
        {
          id,
          bookingId,
          expectedRevision: revision,
          dueAt: new Date(dueAt),
          requestedAt: now,
        },
      ],
      skipDuplicates: true,
    });
    const command = await prisma.notificationDueCommand.findUniqueOrThrow({ where: { id } });
    if (
      command.outcome === 'COMPLETED' ||
      command.outcome === 'REPLAYED' ||
      command.outcome === 'SKIPPED_TERMINAL' ||
      command.outcome === 'SUPERSEDED'
    )
      return;
    try {
      const result = await this.booking.completeDue(
        {
          bookingId,
          expectedBookingRevision: command.expectedRevision,
          commandId: id,
          now: command.requestedAt.toISOString(),
        },
        workerContext('notifications:completion'),
      );
      await prisma.notificationDueCommand.update({
        where: { id },
        data: { outcome: result.outcome, lastErrorCode: null },
      });
    } catch (error) {
      await prisma.notificationDueCommand.update({
        where: { id },
        data:
          error instanceof AppError && error.code === 'STALE_BOOKING_REVISION'
            ? { outcome: 'SUPERSEDED', lastErrorCode: 'STALE_BOOKING_REVISION' }
            : { outcome: 'RETRY_PENDING', lastErrorCode: 'OWNER_COMMAND_PENDING' },
      });
    }
  }
}
