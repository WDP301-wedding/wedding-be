import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';
import { createGuestServices } from '../../src/modules/guest-management/infrastructure/guest.composition.js';
import { NotificationEventConsumer } from '../../src/modules/notifications-automation/infrastructure/event-consumer.js';
import { NotificationFoundation } from '../../src/modules/notifications-automation/infrastructure/notification-foundation.js';
import { createNotificationBookingReader } from '../../src/modules/booking-lifecycle/infrastructure/notification-context.reader.js';
import { createNotificationIdentityReader } from '../../src/modules/identity-access/authorization/notification-recipient.reader.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'notification real producer adapters',
  () => {
    const db = new CatalogTestDatabase('notification_events');
    beforeAll(() => db.connect(), 60000);
    afterAll(() => db.disconnect());
    it('consumes native publication/explicit planning facts once and leaves independent outboxes intact', async () => {
      const f = await studioFixture(db.prisma);
      const reader = createNotificationBookingReader(db.prisma);
      const c = new NotificationEventConsumer(
        new NotificationFoundation(db.prisma, () => f.now),
        reader,
        createNotificationIdentityReader(db.prisma, () => f.now),
      );
      const design = await f.services.designs.create(
        { bookingId: f.bookingId, content: f.content, idempotencyKey: randomUUID() },
        f.couple,
      );
      await f.services.publication.publish(
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
      const g = createGuestServices(db.prisma, () => f.now);
      await g.guests.groups(f.bookingId, f.couple);
      const plan = await g.guests.plan(f.bookingId, f.couple);
      await g.guests.updatePlan(
        f.bookingId.toUpperCase(),
        { expectedRevision: plan.revision, planningHeadcount: plan.planningHeadcount + 1 },
        randomUUID(),
        f.couple,
      );
      expect(await g.readers.getGuestListSummary(f.bookingId)).toMatchObject({
        listedGuestCount: 0,
      });
      const report = await g.readers.readReportPage(
        f.bookingId,
        { afterSequence: 0, limit: 50 },
        {
          requestId: randomUUID(),
          causationId: randomUUID(),
          actorAccountId: null,
          authority: 'SYSTEM',
          purpose: 'reporting:guest-management',
        },
      );
      expect(report.rows.every((r) => r.value.listedGuestCount === 0)).toBe(true);
      await c.poll(100);
      const count = await db.prisma.notificationIntent.count({ where: { bookingId: f.bookingId } });
      expect(count).toBeGreaterThanOrEqual(4);
      expect(
        await db.prisma.notificationRecipient.count({ where: { accountId: f.manager.actorId } }),
      ).toBe(0);
      expect(
        await db.prisma.notificationIntent.count({
          where: { bookingId: f.bookingId, purpose: 'GUEST_PLAN' },
        }),
      ).toBe(2);
      await c.poll(100);
      expect(await db.prisma.notificationIntent.count({ where: { bookingId: f.bookingId } })).toBe(
        count,
      );
      expect(
        await db.prisma.invitationStudioOutbox.count({ where: { bookingId: f.bookingId } }),
      ).toBe(1);
      expect(
        await db.prisma.guestOutbox.count({
          where: { bookingId: f.bookingId, eventType: 'guest.plan-changed' },
        }),
      ).toBe(1);
      expect(
        await db.prisma.bookingOutboxEvent.count({
          where: { aggregateId: f.bookingId, publishedAt: { not: null } },
        }),
      ).toBe(0);
      const intents = await db.prisma.notificationIntent.findMany({
        where: { bookingId: f.bookingId },
      });
      expect(JSON.stringify(intents.map((i) => i.data))).not.toMatch(
        /phone|email|notes|groups|credential/iu,
      );
    });
  },
);
