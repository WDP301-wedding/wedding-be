import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBookingBoundaryUnitOfWork } from '../../../src/core/database/booking-unit-of-work.js';
import { createGuestServices } from '../../../src/modules/guest-management/infrastructure/guest.composition.js';
import { createPaymentsBillingProviders } from '../../../src/modules/payments-billing/payments-billing.providers.js';
import { studioFixture } from '../invitation-studio/studio-fixture.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)('billing reads and booking locks', () => {
  const db = new CatalogTestDatabase('billing_read_locks');
  beforeAll(() => db.connect(), 60000);
  afterAll(() => db.disconnect());

  it('finishes an authorized ledger read while another booking reader retains its shared lock', async () => {
    const f = await studioFixture(db.prisma);
    const guest = createGuestServices(db.prisma);
    const billing = createPaymentsBillingProviders(db.prisma, { vnpay: { enabled: false } });
    const context = {
      authority: 'AUTHENTICATED' as const,
      actorAccountId: f.couple.actorId,
      requestId: randomUUID(),
      causationId: randomUUID(),
    };
    await guest.guests.groups(f.bookingId, f.couple);
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reader = guest.guests.read(f.bookingId, f.couple, async () => {
      entered();
      await held;
    });
    await ready;
    let finished = false;
    const ledger = billing.views.read({ bookingId: f.bookingId, limit: 20 }, context);
    const completed = ledger.then(() => {
      finished = true;
      return 'completed' as const;
    });
    const observe = async () => {
      while (!finished) {
        const [row] = await db.prisma.$queryRaw<{ waiting: boolean }[]>`
          SELECT EXISTS(SELECT 1 FROM pg_stat_activity
          WHERE datname=current_database() AND wait_event_type='Lock'
          AND wait_event='advisory') AS waiting`;
        if (row!.waiting) return 'waiting' as const;
        await delay(10);
      }
      return 'completed' as const;
    };
    const observer = observe();
    try {
      expect(await Promise.race([completed, observer])).toBe('completed');
      expect(await ledger).toMatchObject({
        billingRevision: 0,
        history: [],
        totals: { paidVnd: 0 },
      });
    } finally {
      release();
      await Promise.allSettled([reader, ledger]);
      finished = true;
      await observer;
    }
  }, 15000);

  it('keeps read scopes fenced against writers and rejects writes at the database', async () => {
    const scope = createBookingBoundaryUnitOfWork(db.prisma);
    const bookingId = randomUUID();
    const context = {
      authority: 'SYSTEM' as const,
      actorAccountId: null,
      requestId: randomUUID(),
      causationId: randomUUID(),
    };
    await scope.readBoundary.run({ bookingId, context }, async (scoped) => {
      expect(scope.isReadScope()).toBe(true);
      const locks = await db.prisma.$transaction(async (tx) => {
        const [exclusive] = await tx.$queryRaw<{ acquired: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtext(${bookingId})) AS acquired`;
        const [shared] = await tx.$queryRaw<{ acquired: boolean }[]>`
          SELECT pg_try_advisory_xact_lock_shared(hashtext(${bookingId})) AS acquired`;
        return { exclusive: exclusive!.acquired, shared: shared!.acquired };
      });
      expect(locks).toEqual({ exclusive: false, shared: true });
      expect(
        await scope.withClient(
          bookingId,
          scoped,
          (client) => client.$queryRaw`SELECT current_setting('transaction_read_only') AS value`,
        ),
      ).toEqual([{ value: 'on' }]);
    });
    expect(scope.isReadScope()).toBe(false);
    const auditId = randomUUID();
    await expect(
      scope.readBoundary.run({ bookingId, context }, (scoped) =>
        scope.withClient(bookingId, scoped, (client) =>
          client.auditLog.create({
            data: {
              id: auditId,
              requestId: context.requestId,
              actorType: 'SYSTEM',
              action: 'test.forbidden-read-write',
              entityType: 'booking',
              entityId: bookingId,
              metadata: {},
            },
          }),
        ),
      ),
    ).rejects.toThrow(/read.only/iu);
    expect(await db.prisma.auditLog.count({ where: { id: auditId } })).toBe(0);
  });

  it('retains the exclusive writer fence and commits commands normally', async () => {
    const scope = createBookingBoundaryUnitOfWork(db.prisma);
    const bookingId = randomUUID(),
      auditId = randomUUID();
    const context = {
      authority: 'SYSTEM' as const,
      actorAccountId: null,
      requestId: randomUUID(),
      causationId: randomUUID(),
    };
    await scope.boundary.run({ bookingId, context }, async (scoped) => {
      expect(scope.isReadScope()).toBe(false);
      const [otherReader] = await db.prisma.$queryRaw<{ acquired: boolean }[]>`
        SELECT pg_try_advisory_xact_lock_shared(hashtext(${bookingId})) AS acquired`;
      expect(otherReader!.acquired).toBe(false);
      await scope.withClient(bookingId, scoped, (client) =>
        client.auditLog.create({
          data: {
            id: auditId,
            requestId: context.requestId,
            actorType: 'SYSTEM',
            action: 'test.exclusive-writer',
            entityType: 'booking',
            entityId: bookingId,
            metadata: {},
          },
        }),
      );
    });
    expect(await db.prisma.auditLog.count({ where: { id: auditId } })).toBe(1);
  });
});
