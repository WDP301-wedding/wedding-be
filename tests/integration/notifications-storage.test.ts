import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';
import { NotificationRepository } from '../../src/modules/notifications-automation/infrastructure/notification.repository.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'notification persistence and recovery',
  () => {
    const db = new CatalogTestDatabase('ntf_storage');
    beforeAll(() => db.connect(), 60000);
    afterAll(() => db.disconnect());
    it('deduplicates concurrent enqueue/claims, preserves timeout and accepts late acknowledgement', async () => {
      const f = await studioFixture(db.prisma);
      let now = f.now;
      const r = new NotificationRepository(db.prisma, () => now, [f.bookingId]);
      const input = {
        eventId: randomUUID(),
        bookingId: f.bookingId,
        purpose: 'booking.completed',
        recipientId: f.couple.actorId,
        accountId: f.couple.actorId,
        channel: 'EMAIL' as const,
        scheduledAt: now,
      };
      const rows = await Promise.all([r.enqueue(db.prisma, input), r.enqueue(db.prisma, input)]);
      expect(rows[0].id).toBe(rows[1].id);
      const claims = (await Promise.all([r.claim(), r.claim()])).flat();
      expect(claims).toHaveLength(1);
      now = new Date(now.getTime() + 120001);
      await r.recover();
      await r.recover();
      expect(await r.claim()).toHaveLength(0);
      expect(await db.prisma.notificationAttempt.count()).toBe(1);
      await r.finish(claims[0]!, 'DELIVERED', 'receipt');
      await r.finish(claims[0]!, 'DELIVERED', 'receipt');
      expect(
        await db.prisma.notificationIntent.findUnique({ where: { id: rows[0].id } }),
      ).toMatchObject({ state: 'DELIVERED', attemptCount: 1, providerMessageId: 'receipt' });
    });
    it('bounds retries and never exposes expired ciphertext', async () => {
      const f = await studioFixture(db.prisma);
      let now = f.now;
      const r = new NotificationRepository(db.prisma, () => now, [f.bookingId]);
      const row = await r.enqueue(db.prisma, {
        eventId: randomUUID(),
        bookingId: f.bookingId,
        purpose: 'test',
        recipientId: f.couple.actorId,
        accountId: f.couple.actorId,
        channel: 'EMAIL',
        scheduledAt: now,
      });
      for (let i = 0; i < 6; i++) {
        const [claim] = await r.claim();
        expect(claim!.id).toBe(row.id);
        await r.finish(claim!, 'RETRYABLE_FAILED', undefined, 'RATE_LIMIT');
        now = new Date(now.getTime() + 86400000);
      }
      expect(
        await db.prisma.notificationIntent.findUnique({ where: { id: row.id } }),
      ).toMatchObject({ state: 'DEAD_LETTER', attemptCount: 6 });
      expect(await r.claim()).toHaveLength(0);
      expect(await db.prisma.notificationAttempt.count({ where: { intentId: row.id } })).toBe(6);
      expect(await new NotificationRepository(db.prisma, () => now, []).claim()).toHaveLength(0);
    });
  },
);
