import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';
import { NotificationFoundation } from '../../src/modules/notifications-automation/infrastructure/notification-foundation.js';
import { NotificationEventConsumer } from '../../src/modules/notifications-automation/infrastructure/event-consumer.js';
import { NotificationScheduler } from '../../src/modules/notifications-automation/application/notification-scheduler.js';
import { createNotificationBookingReader } from '../../src/modules/booking-lifecycle/infrastructure/notification-context.reader.js';
import { createNotificationIdentityReader } from '../../src/modules/identity-access/authorization/notification-recipient.reader.js';
import { createPrismaBookingAutomationRepository } from '../../src/modules/booking-lifecycle/infrastructure/automation.repository.js';
import { createBookingAutomationPort } from '../../src/modules/booking-lifecycle/application/automation.js';
import { PrismaInvitationAutomationReader } from '../../src/modules/invitation-studio/infrastructure/prisma-automation.reader.js';
import { createGuestServices } from '../../src/modules/guest-management/infrastructure/guest.composition.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)('notification native automation', () => {
  let db: CatalogTestDatabase;
  beforeEach(async () => {
    db = new CatalogTestDatabase('notification_automation');
    await db.connect();
  }, 60000);
  afterEach(() => db.disconnect());
  it.each([false, true])(
    'native due jobs with Android=%s',
    async (androidEnabled) => {
      const f = await studioFixture(db.prisma);
      const b = await db.prisma.booking.findUniqueOrThrow({
        where: { id: f.bookingId },
        include: { proposalSnapshot: true },
      });
      const start =
        b.eventDate.getTime() +
        b.proposalSnapshot!.shiftStartTime.getUTCHours() * 3600000 -
        7 * 3600000;
      let clock = new Date(start - 72 * 3600000);
      const foundation = new NotificationFoundation(db.prisma, () => clock);
      const consumer = new NotificationEventConsumer(
        foundation,
        createNotificationBookingReader(db.prisma),
        createNotificationIdentityReader(db.prisma),
        androidEnabled,
      );
      const automation = createBookingAutomationPort(
        createPrismaBookingAutomationRepository(db.prisma, () => clock),
        async () => {},
      );
      const scheduler = new NotificationScheduler(
        consumer,
        automation,
        new PrismaInvitationAutomationReader(db.prisma),
      );
      await scheduler.tick();
      const first = await db.prisma.notificationIntent.findMany({
        where: { bookingId: f.bookingId, purpose: 'D3_REMINDER' },
      });
      expect(first).toHaveLength(androidEnabled ? 3 : 2);
      const guests = createGuestServices(db.prisma, () => f.now);
      await guests.guests.groups(f.bookingId, f.couple);
      const plan = await guests.guests.plan(f.bookingId, f.couple);
      await guests.guests.updatePlan(
        f.bookingId,
        { expectedRevision: plan.revision, planningHeadcount: plan.planningHeadcount + 1 },
        randomUUID(),
        f.couple,
      );
      await scheduler.tick();
      expect(
        await db.prisma.notificationIntent.count({
          where: { bookingId: f.bookingId, purpose: 'D3_REMINDER' },
        }),
      ).toBe(androidEnabled ? 3 : 2);
      // The worker can restart without losing a persisted due read or source intent identity.
      await new NotificationScheduler(
        consumer,
        automation,
        new PrismaInvitationAutomationReader(db.prisma),
      ).tick();
      expect(
        await db.prisma.notificationIntent.count({
          where: { bookingId: f.bookingId, purpose: 'D3_REMINDER' },
        }),
      ).toBe(androidEnabled ? 3 : 2);
      clock = new Date(
        b.eventDate.getTime() +
          b.proposalSnapshot!.shiftEndTime.getUTCHours() * 3600000 -
          7 * 3600000 +
          12 * 3600000 +
          1,
      );
      await scheduler.tick();
      expect(
        (await db.prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } })).phase,
      ).toBe('COMPLETED');
      const command = await db.prisma.notificationDueCommand.findFirstOrThrow({
        where: { bookingId: f.bookingId },
      });
      expect(command.state).toBe('DONE');
      expect(
        await automation.completeDue(
          {
            bookingId: f.bookingId,
            expectedBookingRevision: command.expectedRevision,
            commandId: command.id,
            now: command.requestedAt.toISOString(),
          },
          {
            requestId: randomUUID(),
            causationId: randomUUID(),
            authority: 'SYSTEM',
            actorAccountId: null,
          },
        ),
      ).toEqual({ outcome: 'REPLAYED' });
      expect(
        await db.prisma.bookingOutboxEvent.count({
          where: { aggregateId: f.bookingId, eventType: 'booking.completed' },
        }),
      ).toBe(1);
    },
    30000,
  );
  it('persists page fences, honors rehearsal scopes and ignores invalid cutoff revisions', async () => {
    const a = await studioFixture(db.prisma),
      b = await studioFixture(db.prisma);
    const head = await db.prisma.booking.findUniqueOrThrow({
      where: { id: a.bookingId },
      include: { proposalSnapshot: true },
    });
    let clock = new Date(
      head.eventDate.getTime() +
        head.proposalSnapshot!.shiftStartTime.getUTCHours() * 3600000 -
        7 * 3600000 -
        72 * 3600000,
    );
    const foundation = new NotificationFoundation(db.prisma, () => clock);
    const consumer = new NotificationEventConsumer(
      foundation,
      createNotificationBookingReader(db.prisma),
      createNotificationIdentityReader(db.prisma, () => clock),
    );
    for (const f of [a, b])
      await db.prisma.notificationRecipient.create({
        data: { accountId: f.manager.actorId, operational: true, purposes: ['D3_REMINDER'] },
      });
    const native = createPrismaBookingAutomationRepository(db.prisma, () => clock);
    const listDue = vi.fn(
      (
        input: Parameters<typeof native.listDue>[0],
        context: Parameters<typeof native.listDue>[1],
      ) => native.listDue({ ...input, limit: 1 }, context),
    );
    const booking = { ...native, listDue };
    const owned = new PrismaInvitationAutomationReader(db.prisma);
    const invitation = {
      readMediaCutoff: owned.readMediaCutoff.bind(owned),
      listMediaCutoffs: vi.fn(
        (
          input: Parameters<typeof owned.listMediaCutoffs>[0],
          context: Parameters<typeof owned.listMediaCutoffs>[1],
        ) => owned.listMediaCutoffs(input, context),
      ),
    };
    await a.services.service.changeCutoff(
      {
        bookingId: a.bookingId,
        expectedRevision: 0,
        cutoffAt: new Date(clock.getTime() + 86400000).toISOString(),
        idempotencyKey: randomUUID(),
      },
      a.manager,
    );
    const scheduler = new NotificationScheduler(consumer, booking, invitation, [
      a.bookingId,
      b.bookingId,
    ]);
    await scheduler.tick();
    const fence = await db.prisma.notificationScheduleScan.findUniqueOrThrow({
      where: { kind: 'D3_REMINDER' },
    });
    expect(fence.cursor).not.toBeNull();
    expect(await db.prisma.notificationIntent.count({ where: { purpose: 'D3_REMINDER' } })).toBe(4);
    clock = new Date(clock.getTime() + 60000);
    await scheduler.tick();
    expect(listDue.mock.calls.filter(([i]) => i.kind === 'D3_REMINDER')[1]?.[0]).toMatchObject({
      cursor: fence.cursor,
      dueBefore: fence.dueBefore.toISOString(),
    });
    expect(await db.prisma.notificationIntent.count({ where: { purpose: 'D3_REMINDER' } })).toBe(8);
    expect(await db.prisma.notificationIntent.count({ where: { purpose: 'MEDIA_CUTOFF' } })).toBe(
      2,
    );
    const priorCount = await db.prisma.notificationIntent.count();
    await new NotificationScheduler(consumer, booking, invitation, [randomUUID()]).tick();
    expect(await db.prisma.notificationIntent.count()).toBe(priorCount);
    const actualCutoff = await owned.readMediaCutoff(a.bookingId, {
      requestId: randomUUID(),
      causationId: randomUUID(),
      actorAccountId: null,
      authority: 'SYSTEM',
      purpose: 'notifications:media-cutoff',
    });
    invitation.listMediaCutoffs.mockResolvedValueOnce({
      nextCursor: null,
      items: [{ ...actualCutoff!, policyRevision: 0, coupleAccountId: a.couple.actorId }],
    });
    await scheduler.tick();
    expect(await db.prisma.notificationIntent.count({ where: { purpose: 'MEDIA_CUTOFF' } })).toBe(
      2,
    );
    clock = new Date(clock.getTime() + 60000);
    vi.spyOn(db.prisma.notificationScheduleScan, 'updateMany').mockResolvedValueOnce({ count: 0 });
    await scheduler.tick();
    expect(await db.prisma.notificationIntent.count()).toBe(priorCount);
  }, 30000);
  it('keeps frozen completion inputs on NOT_DUE/restart and marks stale owner revisions as conflicts', async () => {
    const f = await studioFixture(db.prisma);
    let clock = f.now;
    const foundation = new NotificationFoundation(db.prisma, () => clock);
    const consumer = new NotificationEventConsumer(
      foundation,
      createNotificationBookingReader(db.prisma),
      createNotificationIdentityReader(db.prisma, () => clock),
    );
    const booking = createPrismaBookingAutomationRepository(db.prisma, () => clock);
    const scheduler = new NotificationScheduler(
      consumer,
      booking,
      new PrismaInvitationAutomationReader(db.prisma),
      [f.bookingId],
    );
    const head = await db.prisma.booking.findUniqueOrThrow({
      where: { id: f.bookingId },
      include: { proposalSnapshot: true },
    });
    const stale = await db.prisma.notificationDueCommand.create({
      data: {
        id: randomUUID(),
        bookingId: f.bookingId,
        expectedRevision: head.revision + 1,
        requestedAt: clock,
      },
    });
    const current = await db.prisma.notificationDueCommand.create({
      data: {
        id: randomUUID(),
        bookingId: f.bookingId,
        expectedRevision: head.revision,
        requestedAt: clock,
      },
    });
    await new NotificationScheduler(
      consumer,
      booking,
      new PrismaInvitationAutomationReader(db.prisma),
      [randomUUID()],
    ).complete();
    expect(
      (await db.prisma.notificationDueCommand.findUniqueOrThrow({ where: { id: stale.id } })).state,
    ).toBe('PENDING');
    await scheduler.complete();
    expect(
      (await db.prisma.notificationDueCommand.findUniqueOrThrow({ where: { id: stale.id } })).state,
    ).toBe('CONFLICT');
    expect(
      await db.prisma.notificationDueCommand.findUniqueOrThrow({ where: { id: current.id } }),
    ).toEqual(current);
    const unavailable = new NotificationScheduler(
      consumer,
      { ...booking, completeDue: () => Promise.reject(new Error('controlled owner unavailable')) },
      new PrismaInvitationAutomationReader(db.prisma),
    );
    await expect(unavailable.complete()).rejects.toThrow('controlled owner unavailable');
    expect(
      (await db.prisma.notificationDueCommand.findUniqueOrThrow({ where: { id: current.id } }))
        .state,
    ).toBe('PENDING');
    clock = new Date(
      head.eventDate.getTime() +
        head.proposalSnapshot!.shiftEndTime.getUTCHours() * 3600000 -
        7 * 3600000 +
        12 * 3600000,
    );
    await new NotificationScheduler(
      consumer,
      booking,
      new PrismaInvitationAutomationReader(db.prisma),
    ).complete();
    const done = await db.prisma.notificationDueCommand.findUniqueOrThrow({
      where: { id: current.id },
    });
    expect(done).toMatchObject({
      state: 'DONE',
      requestedAt: current.requestedAt,
      expectedRevision: current.expectedRevision,
    });
    expect(
      await db.prisma.bookingAutomationCommand.findUniqueOrThrow({
        where: { commandId: current.id },
      }),
    ).toMatchObject({ requestedAt: current.requestedAt });
  }, 30000);
});
