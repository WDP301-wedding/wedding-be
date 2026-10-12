import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { NotificationFoundation } from '../../src/modules/notifications-automation/infrastructure/notification-foundation.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)('notification durable foundation', () => {
  const db = new CatalogTestDatabase('notification_foundation');
  const accountId = randomUUID();
  let s: NotificationFoundation;
  let recipientId: string;
  beforeAll(async () => {
    await db.connect();
    await db.prisma.account.create({
      data: {
        id: accountId,
        emailNormalized: 'notification@example.invalid',
        displayEmail: 'notification@example.invalid',
        displayName: 'Notification test',
      },
    });
    recipientId = (
      await db.prisma.notificationRecipient.create({ data: { accountId, purposes: ['CONTRACT'] } })
    ).id;
    s = new NotificationFoundation(db.prisma, () => new Date('2026-10-12T00:00:00Z'));
  }, 60000);
  afterAll(() => db.disconnect());
  const input = () => ({
    eventId: randomUUID(),
    owner: 'booking-lifecycle' as const,
    bookingId: null,
    recipientId,
    channel: 'EMAIL' as const,
    purpose: 'CONTRACT' as const,
    templateVersion: 1,
    scheduledAt: '2026-10-12T00:00:00.000Z',
    data: {},
  });

  it('deduplicates concurrent events and refuses changed replay payloads', async () => {
    const command = input();
    const [a, b] = await Promise.all([s.enqueue(command), s.enqueue(command)]);
    expect(a.id).toBe(b.id);
    await expect(s.enqueue({ ...command, data: { revision: 2 } })).rejects.toMatchObject({
      code: 'NOTIFICATION_SOURCE_CONFLICT',
    });
    expect(await db.prisma.notificationIntent.count({ where: { eventId: command.eventId } })).toBe(
      1,
    );
  });
  it('deduplicates equivalent UUID case without creating conflicting locks or receipts', async () => {
    const command = input();
    const uppercase = {
      ...command,
      eventId: command.eventId.toUpperCase(),
      recipientId: command.recipientId.toUpperCase(),
    };
    const [a, b] = await Promise.all([s.enqueue(command), s.enqueue(uppercase)]);
    expect(a.id).toBe(b.id);
    expect(await db.prisma.notificationIntent.count({ where: { eventId: command.eventId } })).toBe(
      1,
    );
    const receipt = {
      owner: command.owner,
      eventId: command.eventId,
      sourceDigest: 'd'.repeat(64),
      intents: [command],
    };
    expect(
      await s.consume({ ...receipt, eventId: uppercase.eventId, intents: [uppercase] }),
    ).toEqual(await s.consume(receipt));
  });
  it('claims each due intent once while excluding future schedules and preserving private payloads', async () => {
    const a = await s.enqueue(input());
    const future = await s.enqueue({ ...input(), scheduledAt: '2026-10-13T00:00:00.000Z' });
    const claimed = (await Promise.all([s.claimDue(100), s.claimDue(100)])).flat();
    expect(claimed.filter((v) => v.id === a.id)).toHaveLength(1);
    expect(claimed.some((v) => v.id === future.id)).toBe(false);
    expect(
      await db.prisma.notificationAttempt.count({ where: { intentId: a.id, outcome: 'CLAIMED' } }),
    ).toBe(1);
    expect(() => s.claimDue(101)).toThrow();
    await expect(
      s.enqueue({ ...input(), data: { password: 'must-not-persist' } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
  it('lease expiry becomes UNKNOWN rather than allowing a duplicate send', async () => {
    const a = await s.enqueue(input());
    const [claim] = (await s.claimDue(100)).filter((v) => v.id === a.id);
    const later = new NotificationFoundation(db.prisma, () => new Date('2026-10-12T00:03:00Z'));
    await later.reconcileExpired(100);
    expect(
      (await db.prisma.notificationIntent.findUniqueOrThrow({ where: { id: a.id } })).state,
    ).toBe('UNKNOWN');
    expect((await later.claimDue(100)).some((v) => v.id === a.id)).toBe(false);
    await later.recordOutcome(a.id, claim!.leaseId!, 'DELIVERED', {
      providerMessageId: 'test-receipt',
    });
    expect(
      (await db.prisma.notificationIntent.findUniqueOrThrow({ where: { id: a.id } })).state,
    ).toBe('DELIVERED');
  });
  it('rejects stale lease results and records identical results once', async () => {
    const a = await s.enqueue(input());
    const [claim] = (await s.claimDue(100)).filter((v) => v.id === a.id);
    await expect(s.recordOutcome(a.id, randomUUID(), 'DELIVERED', {})).rejects.toMatchObject({
      code: 'NOTIFICATION_LEASE_STALE',
    });
    await s.recordOutcome(a.id, claim!.leaseId!, 'RETRYABLE_FAILED', {
      errorCode: 'PROVIDER_UNAVAILABLE',
    });
    await s.recordOutcome(a.id, claim!.leaseId!, 'RETRYABLE_FAILED', {
      errorCode: 'PROVIDER_UNAVAILABLE',
    });
    expect(
      await db.prisma.notificationAttempt.count({
        where: { intentId: a.id, outcome: 'RETRYABLE_FAILED' },
      }),
    ).toBe(1);
    const row = await db.prisma.notificationIntent.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.nextAttemptAt.toISOString()).toBe('2026-10-12T00:01:00.000Z');
  });
  it('retains immutable delivery evidence and source references at the database boundary', async () => {
    const a = await s.enqueue(input());
    await s.claimDue(100);
    await expect(
      db.prisma.notificationAttempt.deleteMany({ where: { intentId: a.id } }),
    ).rejects.toThrow();
    await expect(
      db.prisma.notificationIntent.update({
        where: { id: a.id },
        data: { data: { revision: 999 } },
      }),
    ).rejects.toThrow();
  });

  it('consumes a producer event atomically, retaining its receipt without changing another consumer', async () => {
    const first = input();
    const command = {
      owner: first.owner,
      eventId: first.eventId,
      sourceDigest: 'a'.repeat(64),
      intents: [first, { ...first, channel: 'IN_APP' }],
    };
    const ids = await s.consume(command);
    expect(await s.consume({ ...command, intents: [...command.intents].reverse() })).toEqual(ids);
    expect(ids).toHaveLength(2);
    expect(
      await db.prisma.notificationEventReceipt.count({ where: { eventId: first.eventId } }),
    ).toBe(1);
    await expect(s.consume({ ...command, sourceDigest: 'b'.repeat(64) })).rejects.toMatchObject({
      code: 'NOTIFICATION_SOURCE_CONFLICT',
    });
    const failed = input();
    await expect(
      s.consume({
        owner: failed.owner,
        eventId: failed.eventId,
        sourceDigest: 'c'.repeat(64),
        intents: [failed, { ...failed, recipientId: randomUUID() }],
      }),
    ).rejects.toThrow();
    expect(await db.prisma.notificationIntent.count({ where: { eventId: failed.eventId } })).toBe(
      0,
    );
    expect(
      await db.prisma.notificationEventReceipt.count({ where: { eventId: failed.eventId } }),
    ).toBe(0);
  });

  it('exhausts exactly five retries after the initial attempt and protects future scheduling', async () => {
    const a = await s.enqueue(input());
    let clock = new Date('2026-10-12T00:00:00Z');
    const runner = new NotificationFoundation(db.prisma, () => clock);
    for (let attempt = 1; attempt <= 6; attempt++) {
      const claim = (await runner.claimDue(100)).find((v) => v.id === a.id)!;
      expect(claim.attemptCount).toBe(attempt);
      const failed = await runner.recordOutcome(a.id, claim.leaseId!, 'RETRYABLE_FAILED', {
        errorCode: 'PROVIDER_UNAVAILABLE',
      });
      expect(failed.state).toBe(attempt === 6 ? 'DEAD_LETTER' : 'RETRYABLE_FAILED');
      if (attempt < 6) clock = failed.nextAttemptAt;
    }
    expect((await runner.claimDue(100)).some((v) => v.id === a.id)).toBe(false);
    expect(
      await db.prisma.notificationAttempt.count({ where: { intentId: a.id, outcome: 'CLAIMED' } }),
    ).toBe(6);
    const security = await db.prisma.$queryRaw<
      { name: string; secured: boolean }[]
    >`SELECT relname AS name, relrowsecurity AS secured FROM pg_class WHERE relname LIKE 'Notification%' AND relkind='r'`;
    expect(security.length).toBeGreaterThanOrEqual(8);
    expect(security.every((v) => v.secured)).toBe(true);
  });
});
