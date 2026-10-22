import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../src/app.js';
import { CATALOG_SEED_IDS } from '../../../scripts/catalog-seed.js';
import { AuthenticationRequiredError } from '../../../src/modules/identity-access/authorization/authenticated-actor.middleware.js';
import { createPaymentsBillingHttpServices } from '../../../src/modules/payments-billing/http/payments-billing.http-services.js';
import { createPaymentsBillingRouter } from '../../../src/modules/payments-billing/http/payments-billing.router.js';
import { attemptResponseSchema } from '../../../src/modules/payments-billing/http/payments-billing.schemas.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';
import { createManualBillingFixture, seedBillingManager } from './operations-fixture.js';
import { queryFixture } from './vnpay-fixture.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)('VNPay signed query relay HTTP', () => {
  const database = new CatalogTestDatabase('billing_http_relay');
  beforeAll(async () => {
    await database.connect();
    await seedBillingManager(database.prisma);
  }, 60_000);
  afterAll(() => database.disconnect());

  async function fixture(purpose: 'DEPOSIT' | 'BALANCE' = 'DEPOSIT') {
    const query = vi.fn(() => Promise.reject(new Error('controlled outbound CONNECT_TIMEOUT')));
    const f = await createManualBillingFixture(database.prisma, { query });
    if (purpose === 'BALANCE') await f.operations.recordManualPayment(f.deposit, f.manager);
    const checkout =
      purpose === 'DEPOSIT'
        ? await f.vnpay.startCheckout(f.command, '127.0.0.1', f.context)
        : await f.vnpay.startBalanceCheckout(f.balance, '127.0.0.1', f.context);
    const actors = new Map([
      ['couple', f.accountId],
      ['manager', CATALOG_SEED_IDS.actor],
    ]);
    const app = () =>
      createApp({
        runtimeEnvironment: 'test',
        registerRoutes(app) {
          app.use(
            '/api/v1',
            createPaymentsBillingRouter({
              services: createPaymentsBillingHttpServices(database.prisma, f.providers),
              resolveActor: {
                resolve(token) {
                  const accountId = actors.get(token);
                  return accountId === undefined
                    ? Promise.reject(new AuthenticationRequiredError())
                    : Promise.resolve({
                        accountId,
                        sessionId: randomUUID(),
                        displayEmail: 'unused@example.com',
                        // Access decisions must come from stored roles/grants.
                        roles: ['MANAGER'],
                      });
                },
              },
            }),
          );
        },
      });
    const path = `/api/v1/bookings/${f.bookingId}/payments/${checkout.attempt.id}`;
    const firstApp = app();
    return {
      ...f,
      checkout,
      query,
      actors,
      app,
      firstApp,
      path,
      prepare: (token = 'couple', target = firstApp) =>
        request(target).get(`${path}/query`).auth(token, { type: 'bearer' }),
      relay: (response: Record<string, string>, token = 'couple') =>
        request(firstApp)
          .post(`${path}/evidence`)
          .auth(token, { type: 'bearer' })
          .send({ response }),
      reply: (changes: Record<string, string | undefined> = {}) =>
        queryFixture(checkout.attempt.id, {
          vnp_Amount: String(checkout.attempt.amountVnd * 100),
          ...changes,
        }),
    };
  }

  it('recovers a restricted deposit once from signed success after timeout and shares cooldown across HTTP instances', async () => {
    const f = await fixture();
    expect((await f.vnpay.reconcile(f.bookingId, f.checkout.attempt.id, f.system)).status).toBe(
      'UNKNOWN',
    );
    expect(f.query).toHaveBeenCalledOnce();

    const prepared = await f.prepare().expect(200);
    expect(prepared.body).toMatchObject({
      data: {
        request: {
          vnp_Command: 'querydr',
          vnp_TxnRef: f.checkout.attempt.id,
          vnp_TransactionDate: new URL(f.checkout.checkoutUrl).searchParams.get('vnp_CreateDate'),
          vnp_SecureHash: expect.stringMatching(/^[a-f0-9]{128}$/u) as unknown,
        },
      },
    });
    const cooldown = await f.prepare('couple', f.app()).expect(429);
    expect(cooldown.body).toMatchObject({ error: { code: 'PAYMENT_QUERY_COOLDOWN' } });
    await f.prepare('manager', f.app()).expect(429);

    for (let i = 0; i < 2; i++) {
      const result = await f.relay(f.reply()).expect(200);
      expect(attemptResponseSchema.parse(result.body).data).toMatchObject({
        paymentAttemptId: f.checkout.attempt.id,
        status: 'SUCCEEDED',
        applicationStatus: 'SUCCEEDED',
      });
    }
    expect((await f.prepare('couple', f.app()).expect(200)).body).toEqual({
      data: { request: null },
    });
    expect((await f.prepare('manager', f.app()).expect(200)).body).toEqual({
      data: { request: null },
    });
    expect(
      await database.prisma.billingLedgerEntry.count({
        where: { bookingId: f.bookingId, kind: 'PAYMENT', paymentAttemptId: f.checkout.attempt.id },
      }),
    ).toBe(1);
    expect(
      await database.prisma.billingDepositApplication.count({
        where: { payment: { paymentAttemptId: f.checkout.attempt.id } },
      }),
    ).toBe(1);
    expect(
      (await database.prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } })).phase,
    ).toBe('CONFIRMED');
    expect(f.query).toHaveBeenCalledOnce();
  });

  it('requires the actual FULL grant for balance query and evidence, then accepts verified failure without new payment', async () => {
    const f = await fixture('BALANCE');
    const grant = await database.prisma.consultationAccess.findUniqueOrThrow({
      where: {
        accountId_consultationId: { accountId: f.accountId, consultationId: f.consultationId },
      },
    });
    await database.prisma.consultationAccess.update({
      where: {
        accountId_consultationId: { accountId: f.accountId, consultationId: f.consultationId },
      },
      data: { level: 'RESTRICTED', bookingId: null, sourcePaymentId: null, promotedAt: null },
    });
    const failed = f.reply({ vnp_TransactionStatus: '02' });
    await f.prepare().expect(403);
    await f.relay(failed).expect(403);
    expect(
      await database.prisma.billingProviderEvidence.count({
        where: { paymentAttemptId: f.checkout.attempt.id },
      }),
    ).toBe(0);
    await database.prisma.consultationAccess.update({
      where: {
        accountId_consultationId: { accountId: f.accountId, consultationId: f.consultationId },
      },
      data: {
        level: grant.level,
        bookingId: grant.bookingId,
        sourcePaymentId: grant.sourcePaymentId,
        promotedAt: grant.promotedAt,
      },
    });
    await f.prepare().expect(200);
    expect(attemptResponseSchema.parse((await f.relay(failed).expect(200)).body).data.status).toBe(
      'FAILED',
    );
    expect((await f.prepare('manager').expect(200)).body).toEqual({ data: { request: null } });
    expect(
      await database.prisma.billingLedgerEntry.count({
        where: { bookingId: f.bookingId, kind: 'PAYMENT' },
      }),
    ).toBe(1); // Only the pre-existing manual deposit.
    expect(f.query).not.toHaveBeenCalled();
  });

  it('denies anonymous, foreign and Staff relay access before retaining proof or resolving an attempt', async () => {
    const f = await fixture();
    const foreign = await createManualBillingFixture(database.prisma);
    f.actors.set('foreign', foreign.accountId);
    await request(f.firstApp).get(`${f.path}/query`).expect(401);
    await request(f.firstApp).post(`${f.path}/evidence`).send({ response: f.reply() }).expect(401);
    await f.prepare('foreign').expect(404);
    await f.relay(f.reply(), 'foreign').expect(404);
    await database.prisma.accountRole.create({ data: { accountId: f.accountId, role: 'STAFF' } });
    await f.prepare().expect(403);
    await f.relay(f.reply()).expect(403);
    expect(
      await database.prisma.billingProviderEvidence.count({
        where: { paymentAttemptId: f.checkout.attempt.id },
      }),
    ).toBe(0);
    expect(
      (
        await database.prisma.billingPaymentAttempt.findUniqueOrThrow({
          where: { id: f.checkout.attempt.id },
        })
      ).state,
    ).toBe('PENDING');
    expect(f.query).not.toHaveBeenCalled();
  });

  it('releases an UNKNOWN deposit only after relayed signed failed evidence is retained', async () => {
    const f = await fixture();
    await f.vnpay.reconcile(f.bookingId, f.checkout.attempt.id, f.system);
    const response = await f.relay(f.reply({ vnp_TransactionStatus: '02' })).expect(200);
    expect(attemptResponseSchema.parse(response.body).data).toMatchObject({
      status: 'FAILED',
      applicationStatus: null,
    });
    expect(
      await database.prisma.bookingDepositIntent.findUniqueOrThrow({
        where: { id: f.checkout.attempt.id },
      }),
    ).toMatchObject({ status: 'RELEASED' });
    expect(
      await database.prisma.billingProviderEvidence.findFirstOrThrow({
        where: { paymentAttemptId: f.checkout.attempt.id, channel: 'QUERY' },
      }),
    ).toMatchObject({ decision: 'ACCEPTED', outcome: 'FAILED' });
    expect(
      await database.prisma.billingLedgerEntry.count({
        where: { paymentAttemptId: f.checkout.attempt.id },
      }),
    ).toBe(0);
    expect(f.query).toHaveBeenCalledOnce();
  });

  it('reads an unresolved checkout during the provider cooldown without query, evidence or state writes', async () => {
    const f = await fixture();
    await f.prepare().expect(200);
    const result = await request(f.firstApp)
      .get(`${f.path}?reconcile=false`)
      .auth('couple', { type: 'bearer' })
      .expect(200);
    expect(attemptResponseSchema.parse(result.body).data).toMatchObject({
      status: 'PENDING',
      checkoutUrl: f.checkout.checkoutUrl,
    });
    expect(f.query).not.toHaveBeenCalled();
    expect(
      await database.prisma.billingProviderEvidence.count({
        where: { paymentAttemptId: f.checkout.attempt.id },
      }),
    ).toBe(0);
    await database.prisma.billingVnpayQueryLease.update({
      where: { paymentAttemptId: f.checkout.attempt.id },
      data: { nextQueryAt: new Date(0) },
    });
    await f.prepare('couple', f.app()).expect(200);
  });
});
