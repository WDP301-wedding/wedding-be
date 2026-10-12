import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../src/core/database/prisma.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)('FCM populated upgrade', () => {
  const db = new CatalogTestDatabase('notification_fcm_upgrade');
  afterAll(() => db.disconnect());
  it('retains pre-FCM unknown email intent and accepted evidence byte-for-byte', async () => {
    const intentId = randomUUID(),
      leaseId = randomUUID(),
      eventId = randomUUID();
    let before = '';
    await db.connect(async (name, url) => {
      if (name !== '20261013010000_notification_fcm_delivery') return;
      const p = createPrismaClient(url);
      try {
        const f = await studioFixture(p);
        const recipient = await p.notificationRecipient.create({
          data: { accountId: f.couple.actorId, purposes: ['CONTRACT'] },
        });
        await p.$executeRaw`INSERT INTO "NotificationIntent" (id,"eventId",owner,"bookingId","recipientId",channel,purpose,"templateVersion","scheduledAt",data,"payloadDigest",state,revision,"attemptCount","nextAttemptAt","leaseId")
          VALUES (${intentId}::uuid,${eventId}::uuid,'booking-lifecycle',${f.bookingId}::uuid,${recipient.id}::uuid,'EMAIL','CONTRACT',1,${f.now},'{}'::jsonb,${'a'.repeat(64)},'UNKNOWN',1,1,${f.now},${leaseId}::uuid)`;
        await p.notificationAttempt.create({
          data: {
            intentId,
            leaseId,
            outcome: 'ACCEPTED',
            providerMessageId: 'existing-email-acceptance',
            occurredAt: f.now,
          },
        });
        const rows = await p.$queryRaw<
          { value: string }[]
        >`SELECT (to_jsonb(i)-'pushTargetsFrozenAt')::text AS value FROM "NotificationIntent" i WHERE id=${intentId}::uuid`;
        before = rows[0]!.value;
      } finally {
        await p.$disconnect();
      }
    });
    const rows = await db.prisma.$queryRaw<
      { value: string }[]
    >`SELECT (to_jsonb(i)-'pushTargetsFrozenAt')::text AS value FROM "NotificationIntent" i WHERE id=${intentId}::uuid`;
    expect(rows[0]!.value).toBe(before);
    expect(await db.prisma.notificationAttempt.findFirst({ where: { intentId } })).toMatchObject({
      outcome: 'ACCEPTED',
      providerMessageId: 'existing-email-acceptance',
    });
    expect(await db.prisma.notificationPushDelivery.count()).toBe(0);
    const protectedTable = await db.prisma.$queryRaw<
      { secured: boolean }[]
    >`SELECT relrowsecurity AS secured FROM pg_class WHERE relname='NotificationPushDelivery' AND relnamespace=current_schema()::regnamespace`;
    expect(protectedTable).toEqual([{ secured: true }]);
  }, 60000);
});
