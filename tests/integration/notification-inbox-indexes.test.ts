import { appendFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../src/generated/prisma/client.js';
import { createNotificationInboxReader } from '../../src/modules/notifications-automation/infrastructure/notification-inbox.reader.js';
import { createNotificationBookingReader } from '../../src/modules/booking-lifecycle/infrastructure/notification-context.reader.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';

type Plan = { 'Node Type': string; 'Index Name'?: string; Plans?: Plan[] };
function indexes(plan: Plan): string[] {
  return [plan['Index Name'] ?? '', ...(plan.Plans ?? []).flatMap(indexes)];
}

(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'notification inbox index access paths',
  () => {
    const db = new CatalogTestDatabase('notification_inbox_indexes');
    let f: Awaited<ReturnType<typeof studioFixture>>;
    beforeAll(async () => {
      await db.connect();
      // Reproduce the old plans only in this helper's newly created test database.
      // This mode deliberately fails the access-path assertions below.
      if (process.env.POSTGRES_INDEX_EVIDENCE === 'baseline') {
        await db.prisma.$executeRaw`DROP INDEX "NotificationInbox_unread_account_booking_idx"`;
        await db.prisma.$executeRaw`DROP INDEX "NotificationInbox_createdAt_id_idx"`;
      }
      f = await studioFixture(db.prisma);
      const recipient = await db.prisma.notificationRecipient.create({
        data: { accountId: f.couple.actorId },
      });
      await db.prisma.$executeRaw`
      INSERT INTO "NotificationIntent" (id,"eventId",owner,"bookingId","recipientId",channel,purpose,
        "templateVersion","scheduledAt",data,"payloadDigest","nextAttemptAt")
      SELECT md5('inbox-index-intent-'||g)::uuid,md5('inbox-index-event-'||g)::uuid,
        'booking-lifecycle',${f.bookingId}::uuid,${recipient.id}::uuid,'IN_APP','CONTRACT',
        1,${f.now},'{}'::jsonb,repeat('0',64),${f.now} FROM generate_series(1,30000) g`;
      await db.prisma.$executeRaw`
      INSERT INTO "NotificationInbox" (id,"intentId","accountId","bookingId","readAt","createdAt")
      SELECT md5('inbox-index-row-'||g)::uuid,md5('inbox-index-intent-'||g)::uuid,
        ${f.couple.actorId}::uuid,CASE WHEN g%2=0 THEN ${f.bookingId}::uuid ELSE NULL END,
        CASE WHEN g%100=0 THEN NULL ELSE ${f.now}::timestamptz END,
        ${f.now}::timestamptz - g*interval '10 minutes' FROM generate_series(1,30000) g`;
      await db.prisma.$executeRaw`ANALYZE "NotificationInbox"`;
    }, 60000);
    afterAll(() => db.disconnect(), 60000);

    async function explain(query: Prisma.Sql) {
      const evidence = ['true', 'baseline'].includes(process.env.POSTGRES_INDEX_EVIDENCE ?? '');
      const samples = [];
      for (let i = 0; i < (evidence ? 8 : 1); i++) {
        const [row] = await db.prisma.$queryRaw<{ 'QUERY PLAN': { Plan: Plan }[] }[]>(
          Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`,
        );
        samples.push(row!['QUERY PLAN'][0]!);
      }
      if (evidence) {
        const report = JSON.stringify({ query: query.text, samples: samples.slice(1) });
        const evidencePath = process.env.POSTGRES_INDEX_EVIDENCE_PATH;
        if (evidencePath) await appendFile(evidencePath, report + '\n');
        else console.info(report);
      }
      return samples[0]!.Plan;
    }

    it('counts only visible unread rows using the partial index', async () => {
      const booking = createNotificationBookingReader(db.prisma);
      const reader = createNotificationInboxReader(db.prisma, booking.notificationBookingIdsQuery);
      const native = db.prisma.$queryRaw.bind(db.prisma);
      let captured: Prisma.Sql | undefined;
      const spy = vi.spyOn(db.prisma, '$queryRaw').mockImplementationOnce((query) => {
        captured = query as Prisma.Sql;
        return native(query);
      });
      try {
        expect(await reader.unread(f.couple.actorId, false)).toEqual({
          bookingIds: [f.bookingId],
          count: 300,
        });
      } finally {
        spy.mockRestore();
      }
      // Explain the actual reader statement, including the owner's audience CTE.
      expect(captured).toBeDefined();
      const plan = await explain(captured!);
      expect(indexes(plan)).toContain('NotificationInbox_unread_account_booking_idx');
      expect(await reader.unread(f.manager.actorId, true)).toMatchObject({ count: 0 });
      const unread = await db.prisma.notificationInbox.findFirstOrThrow({
        where: { readAt: null },
      });
      await db.prisma.notificationInbox.update({
        where: { id: unread.id },
        data: { readAt: f.now, revision: { increment: 1 } },
      });
      expect(await reader.unread(f.couple.actorId, false)).toMatchObject({ count: 299 });
    });

    it('finds the oldest retention batch in index order without a sort', async () => {
      const cutoff = new Date(f.now.getTime() - 90 * 86400000);
      const query = Prisma.sql`SELECT id FROM "NotificationInbox" WHERE "createdAt"<=${cutoff}
      ORDER BY "createdAt",id LIMIT 100`;
      const plan = await explain(query);
      expect(indexes(plan)).toContain('NotificationInbox_createdAt_id_idx');
      expect(JSON.stringify(plan)).not.toContain('"Node Type":"Sort"');
      const rows = await db.prisma.$queryRaw<{ id: string }[]>(query);
      expect(rows).toHaveLength(100);
      expect(rows[0]!.id).toBe(
        (
          await db.prisma.$queryRaw<{ id: string }[]>`
      SELECT md5('inbox-index-row-30000')::uuid AS id`
        )[0]!.id,
      );
    });
  },
);
