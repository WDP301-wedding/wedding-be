import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../src/app.js';
import { CATALOG_SEED_IDS } from '../../../scripts/catalog-seed.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';
import { createManualBillingFixture, seedBillingManager } from './operations-fixture.js';
import { createPaymentsBillingHttpServices } from '../../../src/modules/payments-billing/http/payments-billing.http-services.js';
import { createPaymentsBillingRouter } from '../../../src/modules/payments-billing/http/payments-billing.router.js';
import { attemptResponseSchema } from '../../../src/modules/payments-billing/http/payments-billing.schemas.js';
import { AuthenticationRequiredError } from '../../../src/modules/identity-access/authorization/authenticated-actor.middleware.js';
import type { BillingAttemptState } from '../../../src/generated/prisma/client.js';
import { ipnFixture } from './vnpay-fixture.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)('active payment discovery HTTP', () => {
  const database = new CatalogTestDatabase('billing_active_attempts');
  beforeAll(async () => {
    await database.connect();
    await seedBillingManager(database.prisma);
  }, 60000);
  afterAll(() => database.disconnect());

  async function fixture() {
    const query = vi.fn(() => Promise.reject(new Error('Discovery must not contact VNPay.')));
    const f = await createManualBillingFixture(database.prisma, { query });
    const actors = new Map([
      ['couple', f.accountId],
      ['manager', CATALOG_SEED_IDS.actor],
    ]);
    const services = createPaymentsBillingHttpServices(database.prisma, f.providers);
    const router = createPaymentsBillingRouter({
      services,
      resolveActor: {
        resolve(token) {
          const accountId = actors.get(token);
          if (accountId === undefined) return Promise.reject(new AuthenticationRequiredError());
          return Promise.resolve({
            accountId,
            sessionId: randomUUID(),
            displayEmail: 'unused@example.com',
            // Claims deliberately overstate authority. Stored roles and access decide visibility.
            roles: ['MANAGER' as const],
          });
        },
      },
    });
    const app = createApp({
      runtimeEnvironment: 'test',
      registerRoutes: (app) => {
        app.use('/api/v1', router);
      },
    });
    const discover = (token = 'couple') =>
      request(app)
        .get(`/api/v1/bookings/${f.bookingId}/payments/active`)
        .auth(token, { type: 'bearer' });
    return { ...f, query, app, actors, discover };
  }

  function attempts(body: unknown) {
    const response = body as { data: { attempts: unknown[] } };
    expect(response.data.attempts).toBeInstanceOf(Array);
    expect(response.data.attempts.length).toBeLessThanOrEqual(2);
    return response.data.attempts.map((data) => attemptResponseSchema.parse({ data }).data);
  }

  async function seedAttempt(
    bookingId: string,
    purpose: 'DEPOSIT' | 'BALANCE',
    state: BillingAttemptState,
    createdAt = new Date(),
    expiresAt = new Date(Date.now() + 600_000),
  ) {
    const booking = await database.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    const attempt = await database.prisma.billingPaymentAttempt.create({
      data: {
        id: randomUUID(),
        commandId: randomUUID(),
        bookingId,
        purpose,
        provider: 'VNPAY',
        state: 'CREATED',
        timelineRevisionId: purpose === 'DEPOSIT' ? booking.currentTimelineRevisionId : null,
        amountVnd: purpose === 'DEPOSIT' ? 15_000_000 : 35_000_000,
        expiresAt,
        createdAt,
      },
    });
    if (state === 'CREATED') return attempt;
    await database.prisma.billingPaymentAttempt.update({
      where: { id: attempt.id },
      data: { state: 'PENDING' },
    });
    if (state === 'PENDING') return attempt;
    return database.prisma.billingPaymentAttempt.update({
      where: { id: attempt.id },
      data: {
        state,
        ...(state === 'FAILED' || state === 'SUCCEEDED'
          ? { terminalEvidenceId: randomUUID() }
          : {}),
      },
    });
  }

  it('rediscovers a restricted deposit from a new session without querying or modifying payment facts', async () => {
    const f = await fixture();
    const checkout = await f.vnpay.startCheckout(f.command, '127.0.0.1', f.context);
    const before = await database.prisma.billingPaymentAttempt.findUniqueOrThrow({
      where: { id: checkout.attempt.id },
    });
    const checkoutsBefore = await database.prisma.billingVnpayCheckout.findMany({
      where: { paymentAttemptId: checkout.attempt.id },
    });
    const body = (await f.discover().expect(200)).body as unknown;
    expect(attempts(body)).toEqual([
      {
        paymentAttemptId: checkout.attempt.id,
        purpose: 'DEPOSIT',
        status: 'PENDING',
        amountVnd: 15_000_000,
        expiresAt: checkout.attempt.expiresAt,
        applicationStatus: null,
      },
    ]);
    expect(f.query).not.toHaveBeenCalled();
    expect(
      await database.prisma.billingPaymentAttempt.findMany({ where: { bookingId: f.bookingId } }),
    ).toEqual([before]);
    expect(
      await database.prisma.billingVnpayCheckout.findMany({
        where: { paymentAttemptId: checkout.attempt.id },
      }),
    ).toEqual(checkoutsBefore);
    expect(
      await database.prisma.billingProviderEvidence.count({
        where: { paymentAttemptId: checkout.attempt.id },
      }),
    ).toBe(0);
    expect(JSON.stringify(body)).not.toMatch(
      /checkoutUrl|hashSecret|commandId|actorAccountId|providerEvidence|evidenceReference|SecureHash|vnp_/,
    );
  });

  it('discovers a balance for the FULL couple and Manager without including the settled deposit', async () => {
    const f = await fixture();
    await f.operations.recordManualPayment(f.deposit, f.manager);
    const checkout = await f.vnpay.startBalanceCheckout(f.balance, '127.0.0.1', f.context);
    for (const token of ['couple', 'manager']) {
      expect(attempts((await f.discover(token).expect(200)).body)).toEqual([
        {
          paymentAttemptId: checkout.attempt.id,
          purpose: 'BALANCE',
          status: 'PENDING',
          amountVnd: 35_000_000,
          expiresAt: checkout.attempt.expiresAt,
          applicationStatus: null,
        },
      ]);
    }
    expect(f.query).not.toHaveBeenCalled();
    expect(
      await database.prisma.billingLedgerEntry.count({
        where: { bookingId: f.bookingId, kind: 'PAYMENT' },
      }),
    ).toBe(1);
  });

  it('filters balance attempts using the actual RESTRICTED grant despite Manager token claims', async () => {
    const f = await fixture();
    const deposit = await seedAttempt(f.bookingId, 'DEPOSIT', 'CREATED');
    await seedAttempt(f.bookingId, 'BALANCE', 'UNKNOWN');
    expect(
      attempts((await f.discover().expect(200)).body).map((attempt) => attempt.paymentAttemptId),
    ).toEqual([deposit.id]);
    expect(f.query).not.toHaveBeenCalled();
  });

  it.each(['CREATED', 'PENDING', 'UNKNOWN'] as const)(
    'returns unresolved %s attempts newest first and excludes failed history',
    async (state) => {
      const f = await fixture();
      await seedAttempt(f.bookingId, 'DEPOSIT', 'FAILED');
      await seedAttempt(f.bookingId, 'BALANCE', 'FAILED');
      const deposit = await seedAttempt(
        f.bookingId,
        'DEPOSIT',
        state,
        new Date('2026-10-01T00:00:00Z'),
      );
      const balance = await seedAttempt(
        f.bookingId,
        'BALANCE',
        state,
        new Date('2026-10-02T00:00:00Z'),
      );
      const found = attempts((await f.discover('manager').expect(200)).body);
      expect(found.map((attempt) => attempt.paymentAttemptId)).toEqual([balance.id, deposit.id]);
      expect(found.map((attempt) => attempt.status)).toEqual([state, state]);
      expect(f.query).not.toHaveBeenCalled();
    },
  );

  it('returns an empty list when the booking has no unresolved attempts', async () => {
    const f = await fixture();
    await seedAttempt(f.bookingId, 'DEPOSIT', 'FAILED');
    expect((await f.discover().expect(200)).body).toEqual({ data: { attempts: [] } });
    expect(f.query).not.toHaveBeenCalled();
  });

  it('keeps an expired UNKNOWN attempt discoverable without releasing it or creating a replacement', async () => {
    const f = await fixture();
    const expired = await seedAttempt(
      f.bookingId,
      'DEPOSIT',
      'UNKNOWN',
      new Date(Date.now() - 120_000),
      new Date(Date.now() - 60_000),
    );
    expect(attempts((await f.discover().expect(200)).body)).toMatchObject([
      { paymentAttemptId: expired.id, status: 'UNKNOWN', applicationStatus: null },
    ]);
    expect(
      await database.prisma.billingPaymentAttempt.findMany({ where: { bookingId: f.bookingId } }),
    ).toEqual([expired]);
    expect(f.query).not.toHaveBeenCalled();
  });

  it('discovers an unapplied success in a fresh session and applies its proven payment once through status recovery', async () => {
    const f = await fixture();
    const checkout = await f.vnpay.startCheckout(f.command, '127.0.0.1', f.context);
    await database.prisma.$executeRawUnsafe(`
      CREATE FUNCTION active_payment_append_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW."paymentAttemptId" = '${checkout.attempt.id}'::uuid THEN
        RAISE EXCEPTION 'controlled payment append failure';
      END IF; RETURN NEW; END $$`);
    await database.prisma.$executeRawUnsafe(
      'CREATE TRIGGER active_payment_append_fault BEFORE INSERT ON "BillingLedgerEntry" FOR EACH ROW EXECUTE FUNCTION active_payment_append_fault()',
    );
    try {
      expect(await f.vnpay.processIpn(ipnFixture(checkout.attempt.id))).toMatchObject({
        RspCode: '00',
      });
    } finally {
      await database.prisma.$executeRawUnsafe(
        'DROP TRIGGER active_payment_append_fault ON "BillingLedgerEntry"',
      );
      await database.prisma.$executeRawUnsafe('DROP FUNCTION active_payment_append_fault()');
    }
    expect(attempts((await f.discover().expect(200)).body)).toMatchObject([
      {
        paymentAttemptId: checkout.attempt.id,
        purpose: 'DEPOSIT',
        status: 'SUCCEEDED',
        applicationStatus: 'PENDING',
      },
    ]);
    expect(
      await database.prisma.billingLedgerEntry.count({
        where: { bookingId: f.bookingId, kind: 'PAYMENT' },
      }),
    ).toBe(0);
    const recover = () =>
      request(f.app)
        .get(`/api/v1/bookings/${f.bookingId}/payments/${checkout.attempt.id}`)
        .auth('couple', { type: 'bearer' });
    for (let i = 0; i < 2; i++) {
      expect(attemptResponseSchema.parse((await recover().expect(200)).body).data).toMatchObject({
        status: 'SUCCEEDED',
        applicationStatus: 'SUCCEEDED',
      });
    }
    expect((await f.discover().expect(200)).body).toEqual({ data: { attempts: [] } });
    expect(
      await database.prisma.billingLedgerEntry.count({
        where: { bookingId: f.bookingId, kind: 'PAYMENT' },
      }),
    ).toBe(1);
    expect(
      (await database.prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } })).phase,
    ).toBe('CONFIRMED');
    expect(f.query).not.toHaveBeenCalled();
  });

  it('denies foreign accounts and Staff before accessing private payment attempts', async () => {
    const f = await fixture();
    await seedAttempt(f.bookingId, 'DEPOSIT', 'PENDING');
    const foreign = await createManualBillingFixture(database.prisma);
    f.actors.set('foreign', foreign.accountId);
    await database.prisma.accountRole.create({ data: { accountId: f.accountId, role: 'STAFF' } });
    const lookup = vi.spyOn(database.prisma.billingPaymentAttempt, 'findMany');
    try {
      await f.discover('foreign').expect(404);
      await f.discover('couple').expect(403);
      expect(lookup).not.toHaveBeenCalled();
      expect(f.query).not.toHaveBeenCalled();
    } finally {
      lookup.mockRestore();
    }
  });
});
