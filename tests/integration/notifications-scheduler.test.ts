import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { notificationFixture } from './notifications-fixture.js';
import { NotificationScheduler } from '../../src/modules/notifications-automation/application/notification-scheduler.js';
import { startNotificationWorker } from '../../src/modules/notifications-automation/application/notification-worker.js';
import { createBookingAutomationPort } from '../../src/modules/booking-lifecycle/application/automation.js';
import { createPrismaBookingAutomationRepository } from '../../src/modules/booking-lifecycle/infrastructure/automation.repository.js';
import { PrismaInvitationAutomationReader } from '../../src/modules/invitation-studio/infrastructure/prisma-automation.reader.js';
import { NotificationRepository } from '../../src/modules/notifications-automation/infrastructure/notification.repository.js';
import { NotificationEvents } from '../../src/modules/notifications-automation/application/notification-events.js';
import { AppError } from '../../src/core/errors/app-error.js';
import { scheduleId } from '../../src/modules/notifications-automation/application/notification-scheduler.js';
(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'RV-16 native due owners and actual worker recovery',
  () => {
    const db = new CatalogTestDatabase('ntf_scheduler');
    beforeAll(() => db.connect(), 60000);
    afterAll(() => db.disconnect());
    async function setup() {
      const x = await notificationFixture(db.prisma),
        booking = createBookingAutomationPort(
          createPrismaBookingAutomationRepository(db.prisma, () => x.now),
          async () => {},
        ),
        invitation = new PrismaInvitationAutomationReader(db.prisma),
        scheduler = new NotificationScheduler(x.events, booking, invitation);
      const row = await db.prisma.booking.findUniqueOrThrow({
          where: { id: x.f.bookingId },
          include: { proposalSnapshot: true },
        }),
        date = row.eventDate.toISOString().slice(0, 10),
        start = new Date(
          `${date}T${row.proposalSnapshot!.shiftStartTime.toISOString().slice(11, 16)}:00+07:00`,
        ),
        end = new Date(
          `${date}T${row.proposalSnapshot!.shiftEndTime.toISOString().slice(11, 16)}:00+07:00`,
        );
      return { ...x, clock: x, booking, invitation, scheduler, start, end };
    }
    it('persists a ten-page checkpoint, resumes the original fence and uses fallback schedule revision', async () => {
      const x = await setup();
      const dueAt = x.now.toISOString(),
        fences: string[] = [];
      let page = 0;
      const booking = {
        ...x.booking,
        listDue: vi.fn<typeof x.booking.listDue>((input) => {
          if (input.kind === 'COMPLETION') return Promise.resolve({ items: [], nextCursor: null });
          fences.push(input.dueBefore);
          page++;
          return Promise.resolve({
            items: [
              {
                bookingId: x.f.bookingId,
                bookingRevision: 1,
                dueAt,
                coupleAccountId: x.f.couple.actorId,
              },
            ],
            nextCursor: page < 11 ? String(page) : null,
          });
        }),
      };
      const scheduler = new NotificationScheduler(
        new NotificationEvents(new NotificationRepository(db.prisma, () => x.now)),
        booking,
        { listMediaCutoffs: () => Promise.resolve({ items: [], nextCursor: null }) },
      );
      await scheduler.run();
      expect(page).toBe(10);
      expect(
        await db.prisma.notificationScan.findUnique({ where: { name: 'D3_REMINDER/all' } }),
      ).toMatchObject({ cursor: '10' });
      x.clock.setNow(new Date(x.now.getTime() + 3600000));
      await scheduler.run();
      expect(fences).toEqual(Array.from({ length: 11 }, () => dueAt));
      expect(
        await db.prisma.notificationScan.findUnique({ where: { name: 'D3_REMINDER/all' } }),
      ).toMatchObject({ cursor: null });
      expect(
        await db.prisma.notificationIntent.count({
          where: { bookingId: x.f.bookingId, purpose: 'D3_REMINDER' },
        }),
      ).toBe(1);
    });
    it.each(['COMPLETED', 'REPLAYED', 'SKIPPED_TERMINAL', 'SUPERSEDED'] as const)(
      'never replays a terminal completion command: %s',
      async (outcome) => {
        const x = await setup(),
          dueAt = x.now.toISOString();
        await db.prisma.notificationDueCommand.create({
          data: {
            id: scheduleId(x.f.bookingId, 'COMPLETION', 1, dueAt),
            bookingId: x.f.bookingId,
            expectedRevision: 1,
            dueAt: x.now,
            requestedAt: x.now,
            outcome,
          },
        });
        const completeDue = vi.fn<typeof x.booking.completeDue>();
        const scheduler = new NotificationScheduler(
          x.events,
          {
            ...x.booking,
            completeDue,
            listDue: (input) =>
              Promise.resolve({
                items:
                  input.kind === 'COMPLETION'
                    ? [
                        {
                          bookingId: x.f.bookingId,
                          bookingRevision: 1,
                          dueAt,
                          coupleAccountId: x.f.couple.actorId,
                        },
                      ]
                    : [],
                nextCursor: null,
              }),
          },
          { listMediaCutoffs: () => Promise.resolve({ items: [], nextCursor: null }) },
        );
        await scheduler.run();
        expect(completeDue).not.toHaveBeenCalled();
        expect(
          await db.prisma.notificationDueCommand.findFirst({ where: { bookingId: x.f.bookingId } }),
        ).toMatchObject({ outcome });
      },
    );
    it('supersedes a stale owner revision and excludes media cutoff facts outside worker scope', async () => {
      const x = await setup(),
        outside = randomUUID(),
        dueAt = x.now.toISOString();
      const completeDue = vi.fn<typeof x.booking.completeDue>(() =>
        Promise.reject(
          new AppError({
            status: 409,
            code: 'STALE_BOOKING_REVISION',
            message: 'Owner advanced',
          }),
        ),
      );
      const scheduler = new NotificationScheduler(
        x.events,
        {
          ...x.booking,
          completeDue,
          listDue: (input) =>
            Promise.resolve({
              items:
                input.kind === 'COMPLETION'
                  ? [
                      {
                        bookingId: x.f.bookingId,
                        bookingRevision: 1,
                        dueAt,
                        coupleAccountId: x.f.couple.actorId,
                      },
                    ]
                  : [],
              nextCursor: null,
            }),
        },
        {
          listMediaCutoffs: () =>
            Promise.resolve({
              items: [
                {
                  bookingId: outside,
                  cutoffAt: dueAt,
                  policyRevision: 1,
                  coupleAccountId: x.f.couple.actorId,
                },
              ],
              nextCursor: null,
            }),
        },
      );
      await scheduler.run();
      await scheduler.run();
      expect(completeDue).toHaveBeenCalledOnce();
      expect(
        await db.prisma.notificationDueCommand.findFirst({ where: { bookingId: x.f.bookingId } }),
      ).toMatchObject({ outcome: 'SUPERSEDED', lastErrorCode: 'STALE_BOOKING_REVISION' });
      expect(await db.prisma.notificationIntent.count({ where: { bookingId: outside } })).toBe(0);
    });
    it('deduplicates concurrent first scans from independent schedulers', async () => {
      const x = await setup();
      x.clock.setNow(new Date(x.start.getTime() - 72 * 3600000));
      const second = new NotificationScheduler(x.events, x.booking, x.invitation);
      await Promise.all([x.scheduler.run(), second.run()]);
      expect(
        await db.prisma.notificationIntent.count({
          where: { bookingId: x.f.bookingId, purpose: 'D3_REMINDER' },
        }),
      ).toBe(1);
    }, 30000);
    it('runs D-3 and cutoff without polling; dedups restart and unrelated Booking changes; completes +12h once', async () => {
      const x = await setup(),
        { f } = x;
      x.clock.setNow(new Date(x.start.getTime() - 72 * 3600000));
      await f.services.service.changeCutoff(
        {
          bookingId: f.bookingId,
          cutoffAt: new Date(x.clock.now.getTime() + 86400000).toISOString(),
          expectedRevision: 0,
          idempotencyKey: randomUUID(),
        },
        f.manager,
      );
      let runs = 0;
      const errors = vi.fn(),
        worker = startNotificationWorker(
          {
            async run() {
              await x.scheduler.run();
              await x.dispatcher.run();
              runs++;
            },
          },
          errors,
          10,
        );
      await vi.waitFor(() => expect(runs).toBeGreaterThan(0), { timeout: 15000 });
      await worker.close();
      expect(errors).not.toHaveBeenCalled();
      expect(x.emails).toHaveLength(2);
      expect(
        await db.prisma.notificationIntent.count({
          where: { bookingId: f.bookingId, purpose: 'D3_REMINDER' },
        }),
      ).toBe(1);
      await db.prisma.booking.update({
        where: { id: f.bookingId },
        data: { revision: { increment: 1 } },
      });
      await x.scheduler.run();
      await x.dispatcher.run();
      expect(x.emails).toHaveLength(2);
      x.clock.setNow(new Date(x.end.getTime() + 12 * 3600000 - 1));
      await x.scheduler.run();
      expect(
        (await db.prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } })).phase,
      ).toBe('CONFIRMED');
      x.clock.setNow(new Date(x.end.getTime() + 12 * 3600000));
      await Promise.all([x.scheduler.run(), x.scheduler.run()]);
      await x.scheduler.run();
      expect(
        (await db.prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } })).phase,
      ).toBe('COMPLETED');
      expect(
        await db.prisma.bookingAutomationCommand.count({ where: { bookingId: f.bookingId } }),
      ).toBe(1);
      expect(
        await db.prisma.bookingOutboxEvent.count({
          where: { aggregateId: f.bookingId, eventType: 'booking.completed' },
        }),
      ).toBe(1);
      expect(await db.prisma.staffCheckInRecord.count({ where: { bookingId: f.bookingId } })).toBe(
        0,
      );
    }, 30000);
    it('skips reminders over 24h late and respects a bounded fixture scope', async () => {
      const x = await setup(),
        { f } = x;
      x.clock.setNow(new Date(x.start.getTime() - 72 * 3600000 + 86400001));
      await x.scheduler.run();
      await x.dispatcher.run();
      expect(x.emails).toHaveLength(0);
      expect(
        await db.prisma.notificationIntent.findFirst({
          where: { bookingId: f.bookingId, purpose: 'D3_REMINDER' },
        }),
      ).toMatchObject({ state: 'SKIPPED_STALE' });
      const other = await notificationFixture(db.prisma),
        scheduler = new NotificationScheduler(
          new NotificationEvents(new NotificationRepository(db.prisma, () => x.clock.now, [])),
          x.booking,
          x.invitation,
        );
      await scheduler.run();
      expect(
        await db.prisma.notificationIntent.count({ where: { bookingId: other.f.bookingId } }),
      ).toBe(0);
    });
    it('cancels a queued cutoff on revision change and journals failed owner completion for restart', async () => {
      const x = await setup(),
        { f } = x;
      await f.services.service.changeCutoff(
        {
          bookingId: f.bookingId,
          cutoffAt: new Date(x.clock.now.getTime() + 86400000).toISOString(),
          expectedRevision: 0,
          idempotencyKey: randomUUID(),
        },
        f.manager,
      );
      await x.scheduler.run();
      const old = await db.prisma.notificationIntent.findFirstOrThrow({
        where: { bookingId: f.bookingId, purpose: 'MEDIA_CUTOFF' },
      });
      await f.services.service.changeCutoff(
        {
          bookingId: f.bookingId,
          cutoffAt: new Date(x.clock.now.getTime() + 2 * 86400000).toISOString(),
          expectedRevision: 1,
          idempotencyKey: randomUUID(),
        },
        f.manager,
      );
      await x.dispatcher.run();
      expect(
        (await db.prisma.notificationIntent.findUniqueOrThrow({ where: { id: old.id } })).state,
      ).toBe('CANCELLED');
      expect(x.emails).toHaveLength(0);
      x.clock.setNow(new Date(x.end.getTime() + 12 * 3600000));
      const failing = new NotificationScheduler(
        x.events,
        {
          ...x.booking,
          completeDue: async (...args) => {
            await x.booking.completeDue(...args);
            throw Error('lost response after owner commit');
          },
        },
        x.invitation,
      );
      await failing.run();
      expect(
        await db.prisma.notificationDueCommand.findFirst({ where: { bookingId: f.bookingId } }),
      ).toMatchObject({ outcome: 'RETRY_PENDING', lastErrorCode: 'OWNER_COMMAND_PENDING' });
      await x.scheduler.run();
      expect(
        await db.prisma.notificationDueCommand.findFirst({ where: { bookingId: f.bookingId } }),
      ).toMatchObject({ outcome: 'REPLAYED' });
    });
  },
);
