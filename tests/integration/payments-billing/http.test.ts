import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';
import { createManualBillingFixture, seedBillingManager } from './operations-fixture.js';
import { createPaymentsBillingRouter } from '../../../src/modules/payments-billing/http/payments-billing.router.js';
import { createPaymentsBillingHttpServices } from '../../../src/modules/payments-billing/http/payments-billing.http-services.js';
import { CATALOG_SEED_IDS } from '../../../scripts/catalog-seed.js';
import { ipnFixture } from './vnpay-fixture.js';
import { AuthenticationRequiredError } from '../../../src/modules/identity-access/authorization/authenticated-actor.middleware.js';
import { errorResponseSchema } from '../../../src/core/http/common.schemas.js';
import { createPaymentsBillingProviders } from '../../../src/modules/payments-billing/payments-billing.providers.js';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';
import { createBookingLifecycleService } from '../../../src/modules/booking-lifecycle/application/lifecycle.service.js';
import { createPrismaBookingLifecycleRepository } from '../../../src/modules/booking-lifecycle/infrastructure/lifecycle.repository.js';
import {
  createConsultationAccessReader,
  createPrismaConsultationAccessRepository,
} from '../../../src/modules/identity-access/authorization/authorization.service.js';
import {
  attemptResponseSchema,
  billingResponseSchema,
  checkoutResponseSchema,
  ipnResponseSchema,
  refundApprovalResponseSchema,
} from '../../../src/modules/payments-billing/http/payments-billing.schemas.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)('W6 real billing HTTP', () => {
  const database = new CatalogTestDatabase('billing_http');
  beforeAll(async () => {
    await database.connect();
    await seedBillingManager(database.prisma);
  }, 60000);
  afterAll(() => database.disconnect());
  async function fixture(
    transform: (
      providers: ReturnType<typeof createPaymentsBillingProviders>,
    ) => ReturnType<typeof createPaymentsBillingProviders> = (providers) => providers,
    client: PrismaClient = database.prisma,
  ) {
    const f = await createManualBillingFixture(database.prisma);
    const actors = new Map<string, string>([
      ['manager', CATALOG_SEED_IDS.actor],
      ['prospect', f.accountId],
    ]);
    const services = createPaymentsBillingHttpServices(client, transform(f.providers));
    const router = createPaymentsBillingRouter({
      services,
      resolveActor: {
        resolve(token) {
          const accountId = actors.get(token);
          return accountId === undefined
            ? Promise.reject(new AuthenticationRequiredError())
            : Promise.resolve({
                accountId,
                sessionId: randomUUID(),
                displayEmail: 'unused@example.com',
                roles: accountId === CATALOG_SEED_IDS.actor ? ['MANAGER'] : [],
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
    return { ...f, app, actors, services };
  }
  it('creates an owned restricted deposit, verifies unauthenticated IPN and exposes safe full billing', async () => {
    const f = await fixture();
    const url = `/api/v1/bookings/${f.bookingId}/payments/deposit`;
    const body = { timelineRevisionId: f.timelineRevisionId };
    const first = await request(f.app)
      .post(url)
      .auth('prospect', { type: 'bearer' })
      .set('Idempotency-Key', 'http-deposit-1')
      .send(body)
      .expect(201);
    const data = checkoutResponseSchema.parse(first.body).data;
    expect(data.checkoutUrl).toContain('vnp_Amount=1500000000');
    expect(
      (
        await request(f.app)
          .post(url)
          .auth('prospect', { type: 'bearer' })
          .set('Idempotency-Key', 'http-deposit-1')
          .send(body)
          .expect(201)
      ).body,
    ).toEqual(first.body);
    await request(f.app)
      .get(`/api/v1/bookings/${f.bookingId}/billing`)
      .auth('prospect', { type: 'bearer' })
      .expect(403);
    const query = ipnFixture(data.paymentAttemptId);
    expect(
      ipnResponseSchema.parse(
        (await request(f.app).get(`/api/v1/billing/callbacks/vnpay?${query}`).expect(200)).body,
      ).RspCode,
    ).toBe('00');
    expect(
      ipnResponseSchema.parse(
        (await request(f.app).get(`/api/v1/billing/callbacks/vnpay?${query}`).expect(200)).body,
      ).RspCode,
    ).toBe('02');
    const attempt = await request(f.app)
      .get(`/api/v1/bookings/${f.bookingId}/payments/${data.paymentAttemptId}`)
      .auth('prospect', { type: 'bearer' })
      .expect(200);
    expect(attemptResponseSchema.parse(attempt.body).data).toMatchObject({
      status: 'SUCCEEDED',
      applicationStatus: 'SUCCEEDED',
      amountVnd: 15000000,
    });
    const read = await request(f.app)
      .get(`/api/v1/bookings/${f.bookingId}/billing?limit=1`)
      .auth('prospect', { type: 'bearer' })
      .expect(200);
    expect(billingResponseSchema.parse(read.body).data.totals).toMatchObject({
      acceptedChargesVnd: 50000000,
      paidVnd: 15000000,
      outstandingVnd: 35000000,
    });
    expect(billingResponseSchema.parse(read.body).data.history).toHaveLength(1);
    expect(JSON.stringify([attempt.body, read.body])).not.toMatch(
      /hashSecret|providerEvidenceId|evidenceReference|BankTranNo|SecureHash/,
    );
  });
  it('enforces current authority, conceals foreign bookings and validates keys and strict input', async () => {
    const f = await fixture();
    const url = `/api/v1/bookings/${f.bookingId}/payments/deposit`;
    const body = { timelineRevisionId: f.timelineRevisionId };
    await request(f.app).post(url).send(body).expect(401);
    await request(f.app).post(url).auth('invalid', { type: 'bearer' }).send(body).expect(401);
    const missing = await request(f.app)
      .post(url)
      .auth('prospect', { type: 'bearer' })
      .send(body)
      .expect(400);
    expect(errorResponseSchema.parse(missing.body).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    await request(f.app)
      .post(url)
      .auth('prospect', { type: 'bearer' })
      .set('Idempotency-Key', 'x'.repeat(129))
      .send(body)
      .expect(422);
    await request(f.app)
      .post(url)
      .auth('prospect', { type: 'bearer' })
      .set('Idempotency-Key', 'strict')
      .send({ ...body, amountVnd: 1 })
      .expect(422);
    await request(f.app)
      .get(`/api/v1/bookings/${randomUUID()}/billing`)
      .auth('manager', { type: 'bearer' })
      .expect(404);
    const other = await fixture();
    await request(f.app)
      .get(`/api/v1/bookings/${other.bookingId}/billing`)
      .auth('prospect', { type: 'bearer' })
      .expect(404);
    await request(f.app)
      .post(url)
      .auth('manager', { type: 'bearer' })
      .set('Idempotency-Key', 'foreign-deposit')
      .send(body)
      .expect(404);
    await request(f.app)
      .post('/api/v1/management/billing/payments/manual')
      .auth('prospect', { type: 'bearer' })
      .set('Idempotency-Key', 'denied')
      .send(receipt(f.bookingId))
      .expect(403);
    await database.prisma.account.update({
      where: { id: f.accountId },
      data: { status: 'DISABLED', disabledAt: new Date() },
    });
    await request(f.app)
      .post(url)
      .auth('prospect', { type: 'bearer' })
      .set('Idempotency-Key', 'disabled')
      .send(body)
      .expect(403);
    expect(
      await database.prisma.billingPaymentAttempt.count({ where: { bookingId: f.bookingId } }),
    ).toBe(0);
    const audits = await database.prisma.auditLog.findMany({
      where: { action: 'billing.access-denied' },
    });
    expect(audits.length).toBeGreaterThan(0);
    expect(JSON.stringify(audits)).not.toContain('unused@example.com');
  });
  it('records manual deposit and partial balance once and rejects changed intent or excessive balance', async () => {
    const f = await fixture();
    const url = '/api/v1/management/billing/payments/manual';
    const post = (body: object, key: string) =>
      request(f.app)
        .post(url)
        .auth('manager', { type: 'bearer' })
        .set('Idempotency-Key', key)
        .send(body);
    const deposit = await post(receipt(f.bookingId), 'manual-deposit').expect(201);
    expect((await post(receipt(f.bookingId), 'manual-deposit').expect(201)).body).toEqual(
      deposit.body,
    );
    expect(
      errorResponseSchema.parse(
        (await post({ ...receipt(f.bookingId), amountVnd: 1 }, 'manual-deposit').expect(422)).body,
      ).error.code,
    ).toBe('IDEMPOTENCY_KEY_REUSED');
    const partial = receipt(f.bookingId, 'BALANCE', 5000000);
    await post(partial, 'manual-partial').expect(201);
    await post(partial, 'manual-partial').expect(201);
    await post(receipt(f.bookingId, 'BALANCE', 30000001), 'too-large').expect(409);
    const state = billingResponseSchema.parse(
      (
        await request(f.app)
          .get(`/api/v1/bookings/${f.bookingId}/billing`)
          .auth('manager', { type: 'bearer' })
          .expect(200)
      ).body,
    ).data;
    expect(state.totals).toMatchObject({ paidVnd: 20000000, outstandingVnd: 30000000 });
    expect(state.history.filter((entry) => entry.kind === 'PAYMENT')).toHaveLength(2);
    const manualAttempt = (
      await database.prisma.billingPaymentAttempt.findFirstOrThrow({
        where: { bookingId: f.bookingId, purpose: 'DEPOSIT' },
      })
    ).id;
    expect(
      attemptResponseSchema.parse(
        (
          await request(f.app)
            .get(`/api/v1/bookings/${f.bookingId}/payments/${manualAttempt}`)
            .auth('prospect', { type: 'bearer' })
            .expect(200)
        ).body,
      ).data.applicationStatus,
    ).toBe('SUCCEEDED');
  });
  it('uses only stored refund approval and makes exact refund replay stable after later facts', async () => {
    const f = await fixture();
    const payment = await f.operations.recordManualPayment(f.deposit, f.manager);
    const charge = await f.providers.charges.registerAcceptedCharge({
      bookingId: f.bookingId,
      sourceType: 'PRINT_ORDER',
      sourceRevisionId: randomUUID(),
      amountVnd: 2000000,
      acceptedAt: new Date('2026-10-08T16:01:00Z'),
    });
    const credit = await f.providers.charges.registerCredit(
      {
        bookingId: f.bookingId,
        receivableChargeId: charge.receivableChargeId,
        sourceAdjustmentId: randomUUID(),
        amountVnd: 2000000,
        reason: 'PRINT_CANCELLED',
        acceptedAt: '2026-10-08T16:02:00Z',
      },
      f.system,
    );
    const body = {
      sourcePaymentId: payment.resourceId,
      amountVnd: 1000000,
      expectedBillingRevision: 4,
      reason: 'Refund',
      evidenceReference: 'private-refund',
    };
    const post = (input: object, key: string) =>
      request(f.app)
        .post('/api/v1/management/billing/refunds')
        .auth('manager', { type: 'bearer' })
        .set('Idempotency-Key', key)
        .send(input);
    expect(
      errorResponseSchema.parse((await post(body, 'no-approval').expect(409)).body).error.code,
    ).toBe('BILLING_REFUND_APPROVAL_REQUIRED');
    await f.operations.approveRefund(
      {
        bookingId: f.bookingId,
        commandId: randomUUID(),
        basis: { kind: 'CREDIT', sourceEntryId: credit.adjustmentId },
        approvedRefundableVnd: 2000000,
        reason: 'Approved',
        evidenceReference: 'private-decision',
      },
      f.manager,
    );
    await post({ ...body, expectedBillingRevision: 3 }, 'stale-refund').expect(409);
    const first = await post(body, 'refund-1').expect(201);
    await f.operations.recordManualPayment(
      {
        ...receipt(f.bookingId, 'BALANCE', 1),
        purpose: 'BALANCE',
        commandId: randomUUID(),
        expectedBillingRevision: 5,
      },
      f.manager,
    );
    expect((await post(body, 'refund-1').expect(201)).body).toEqual(first.body);
    await post(
      { ...body, amountVnd: 1000001, expectedBillingRevision: 6 },
      'refund-over-approval',
    ).expect(409);
    await request(f.app)
      .post('/api/v1/management/billing/refunds')
      .auth('prospect', { type: 'bearer' })
      .set('Idempotency-Key', 'denied-refund')
      .send(body)
      .expect(403);
    await post({ ...body, sourcePaymentId: randomUUID() }, 'missing-payment').expect(404);
    expect(
      await database.prisma.billingLedgerEntry.count({
        where: { bookingId: f.bookingId, kind: 'REFUND' },
      }),
    ).toBe(1);
    const read = await request(f.app)
      .get(`/api/v1/bookings/${f.bookingId}/billing`)
      .auth('prospect', { type: 'bearer' })
      .expect(200);
    expect(JSON.stringify(read.body)).not.toMatch(
      /private-refund|private-decision|approvedRefundableVnd|reason|evidenceReference/,
    );
  });
  it('lets a Manager approve a credit refund over HTTP, then refund with replay and budget protection', async () => {
    const f = await fixture();
    const payment = await f.operations.recordManualPayment(f.deposit, f.manager);
    const charge = await f.providers.charges.registerAcceptedCharge({
      bookingId: f.bookingId,
      sourceType: 'PRINT_ORDER',
      sourceRevisionId: randomUUID(),
      amountVnd: 1_000_000,
      acceptedAt: new Date(),
    });
    const credit = await f.providers.charges.registerCredit(
      {
        bookingId: f.bookingId,
        receivableChargeId: charge.receivableChargeId,
        sourceAdjustmentId: randomUUID(),
        amountVnd: 1_000_000,
        reason: 'PRINT_CANCELLED',
        acceptedAt: new Date().toISOString(),
      },
      f.system,
    );
    const body = {
      bookingId: f.bookingId,
      expectedBillingRevision: 4,
      approvedRefundableVnd: 1_000_000,
      basis: { kind: 'CREDIT', sourceEntryId: credit.adjustmentId },
      reason: 'Approved credit refund',
      evidenceReference: 'approval-evidence',
    };
    const approve = (value: object, key: string, actor = 'manager') =>
      request(f.app)
        .post('/api/v1/management/billing/refund-approvals')
        .auth(actor, { type: 'bearer' })
        .set('Idempotency-Key', key)
        .send(value);
    await approve(body, 'approval-denied', 'prospect').expect(403);
    await approve({ ...body, expectedBillingRevision: 3 }, 'approval-stale').expect(409);
    const first = await approve(body, 'approval-1').expect(201);
    expect(refundApprovalResponseSchema.parse(first.body).data.refundApprovalId).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    expect((await f.providers.ledger.getLedger(f.bookingId)).revision).toBe(4);
    await request(f.app)
      .post('/api/v1/management/billing/refunds')
      .auth('manager', { type: 'bearer' })
      .set('Idempotency-Key', 'approved-http-refund')
      .send({
        sourcePaymentId: payment.resourceId,
        amountVnd: 1_000_000,
        expectedBillingRevision: 4,
        reason: 'Completed refund',
        evidenceReference: 'refund-evidence',
      })
      .expect(201);
    expect((await approve(body, 'approval-1').expect(201)).body).toEqual(first.body);
    await approve({ ...body, approvedRefundableVnd: 1 }, 'approval-1').expect(422);
    await approve({ ...body, expectedBillingRevision: 5 }, 'approval-over-budget').expect(409);
    expect(
      await database.prisma.billingRefundApproval.count({ where: { bookingId: f.bookingId } }),
    ).toBe(1);
    expect((await f.providers.ledger.getLedger(f.bookingId)).totals.refundedVnd).toBe(1_000_000);
  });
  it('resolves cancellation approval evidence from Booking instead of accepting a client sequence', async () => {
    const f = await fixture();
    await f.operations.recordManualPayment(f.deposit, f.manager);
    const body = {
      bookingId: f.bookingId,
      expectedBillingRevision: 2,
      approvedRefundableVnd: 15_000_000,
      basis: { kind: 'CANCELLATION' },
      reason: 'Cancelled booking',
      evidenceReference: 'cancellation-evidence',
    };
    const approve = (value: object, key: string) =>
      request(f.app)
        .post('/api/v1/management/billing/refund-approvals')
        .auth('manager', { type: 'bearer' })
        .set('Idempotency-Key', key)
        .send(value);
    await approve(body, 'not-cancelled').expect(409);
    const lifecycle = createBookingLifecycleService({
      repository: createPrismaBookingLifecycleRepository(database.prisma),
      access: createConsultationAccessReader(
        createPrismaConsultationAccessRepository(database.prisma),
      ),
    });
    const booking = await database.prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
    await lifecycle.cancel({
      bookingId: f.bookingId,
      expectedBookingRevision: booking.revision,
      reason: 'Recorded cancellation',
      actor: { accountId: f.manager.actorAccountId, roles: ['MANAGER'] },
      requestId: randomUUID(),
    });
    await approve(
      { ...body, basis: { kind: 'CANCELLATION', sequence: 1 } },
      'client-sequence',
    ).expect(422);
    const result = await approve(body, 'cancelled-approval').expect(201);
    const decision = await database.prisma.billingRefundApproval.findUniqueOrThrow({
      where: { id: (result.body as { data: { refundApprovalId: string } }).data.refundApprovalId },
    });
    expect(decision.basisKind).toBe('CANCELLATION');
    expect(decision.cancellationSequence).toBeGreaterThan(0);
  });
  it('authorizes balance, rejects stale heads and keeps UNKNOWN unavailable for a second collection', async () => {
    const f = await fixture();
    const url = `/api/v1/bookings/${f.bookingId}/payments/balance`;
    const post = (revision: number, key: string) =>
      request(f.app)
        .post(url)
        .auth('prospect', { type: 'bearer' })
        .set('Idempotency-Key', key)
        .send({ expectedBillingRevision: revision });
    await post(1, 'restricted-balance').expect(403);
    await f.operations.recordManualPayment(f.deposit, f.manager);
    await post(1, 'stale-balance').expect(409);
    const data = checkoutResponseSchema.parse((await post(2, 'balance').expect(201)).body).data;
    expect(data.checkoutUrl).toContain('vnp_Amount=3500000000');
    const attemptUrl = `/api/v1/bookings/${f.bookingId}/payments/${data.paymentAttemptId}`;
    const unknown = attemptResponseSchema.parse(
      (await request(f.app).get(attemptUrl).auth('prospect', { type: 'bearer' }).expect(200)).body,
    ).data;
    expect(unknown).toMatchObject({ status: 'UNKNOWN', applicationStatus: null });
    await post(2, 'second-balance').expect(409);
    await request(f.app)
      .get(`/api/v1/bookings/${f.bookingId}/payments/${randomUUID()}`)
      .auth('manager', { type: 'bearer' })
      .expect(404);
    const other = await fixture();
    await request(f.app)
      .get(`/api/v1/bookings/${other.bookingId}/payments/${data.paymentAttemptId}`)
      .auth('manager', { type: 'bearer' })
      .expect(404);
    const restricted = await database.prisma.account.create({
      data: {
        emailNormalized: `${randomUUID()}@example.com`,
        displayEmail: 'restricted@example.com',
        consultationAccesses: { create: { consultationId: f.consultationId, level: 'RESTRICTED' } },
      },
    });
    f.actors.set('restricted', restricted.id);
    await request(f.app).get(attemptUrl).auth('restricted', { type: 'bearer' }).expect(403);
  });
  it('acknowledges bad, unknown and mismatched IPN with provider bodies and preserves raw duplicates', async () => {
    const f = await fixture();
    const attempt = await f.vnpay.startCheckout(
      { bookingId: f.bookingId, timelineRevisionId: f.timelineRevisionId, commandId: randomUUID() },
      '127.0.0.1',
      f.context,
    );
    const ack = async (query: string) =>
      ipnResponseSchema.parse(
        (
          await request(f.app)
            .get(`/api/v1/billing/callbacks/vnpay${query === '' ? '' : `?${query}`}`)
            .expect(200)
        ).body,
      ).RspCode;
    expect(await ack(ipnFixture(randomUUID()))).toBe('01');
    const valid = ipnFixture(attempt.attempt.id);
    expect(await ack(valid.replace(/vnp_SecureHash=.*/, 'vnp_SecureHash=' + '0'.repeat(128)))).toBe(
      '97',
    );
    expect(await ack(ipnFixture(attempt.attempt.id, { vnp_Amount: '1' }))).toBe('99');
    expect(await ack(ipnFixture(attempt.attempt.id, { vnp_Amount: '100' }))).toBe('04');
    expect(await ack(valid + '&vnp_Amount=1500000000')).toBe('99');
    expect(await ack('')).toBe('99');
    expect(await ack(valid)).toBe('00');
    expect(await ack(valid)).toBe('02');
  });
  it('denies Staff-only authority even with an owned grant and permits legitimate Couple authority', async () => {
    const f = await fixture();
    await database.prisma.accountRole.create({ data: { accountId: f.accountId, role: 'STAFF' } });
    await request(f.app)
      .post(`/api/v1/bookings/${f.bookingId}/payments/deposit`)
      .auth('prospect', { type: 'bearer' })
      .set('Idempotency-Key', 'staff-deposit')
      .send({ timelineRevisionId: f.timelineRevisionId })
      .expect(403);
    expect(
      await database.prisma.billingPaymentAttempt.count({ where: { bookingId: f.bookingId } }),
    ).toBe(0);
    const payment = await f.operations.recordManualPayment(f.deposit, f.manager);
    // Billing recognizes the owned Couple role, even when the account also staffs events.
    await request(f.app)
      .get(`/api/v1/bookings/${f.bookingId}/billing`)
      .auth('prospect', { type: 'bearer' })
      .expect(200);
    await database.prisma.accountRole.delete({
      where: { accountId_role: { accountId: f.accountId, role: 'COUPLE' } },
    });
    await request(f.app)
      .get(`/api/v1/bookings/${f.bookingId}/billing`)
      .auth('prospect', { type: 'bearer' })
      .expect(403);
    await request(f.app)
      .get(`/api/v1/bookings/${f.bookingId}/payments/${payment.paymentAttemptId}`)
      .auth('prospect', { type: 'bearer' })
      .expect(403);
    await request(f.app)
      .post(`/api/v1/bookings/${f.bookingId}/payments/balance`)
      .auth('prospect', { type: 'bearer' })
      .set('Idempotency-Key', 'staff-balance')
      .send({ expectedBillingRevision: 2 })
      .expect(403);
    const foreign = await fixture();
    await request(f.app)
      .get(`/api/v1/bookings/${foreign.bookingId}/billing`)
      .auth('prospect', { type: 'bearer' })
      .expect(404);
  });
  it('fails disabled VNPay before claiming checkout while retaining historical manual status', async () => {
    const f = await fixture(() =>
      createPaymentsBillingProviders(database.prisma, { vnpay: { enabled: false } }),
    );
    const response = await request(f.app)
      .post(`/api/v1/bookings/${f.bookingId}/payments/deposit`)
      .auth('prospect', { type: 'bearer' })
      .set('Idempotency-Key', 'disabled-vnpay')
      .send({ timelineRevisionId: f.timelineRevisionId })
      .expect(503);
    expect(errorResponseSchema.parse(response.body).error.code).toBe(
      'PAYMENT_PROVIDER_UNAVAILABLE',
    );
    expect(
      await database.prisma.billingPaymentAttempt.count({ where: { bookingId: f.bookingId } }),
    ).toBe(0);
    expect(
      await database.prisma.idempotencyRecord.count({
        where: { idempotencyKey: 'disabled-vnpay' },
      }),
    ).toBe(0);
    expect(
      ipnResponseSchema.parse(
        (await request(f.app).get('/api/v1/billing/callbacks/vnpay').expect(200)).body,
      ).RspCode,
    ).toBe('99');
    const payment = await f.operations.recordManualPayment(f.deposit, f.manager);
    const attempt = attemptResponseSchema.parse(
      (
        await request(f.app)
          .get(`/api/v1/bookings/${f.bookingId}/payments/${payment.paymentAttemptId}`)
          .auth('prospect', { type: 'bearer' })
          .expect(200)
      ).body,
    ).data;
    expect(attempt.applicationStatus).toBe('SUCCEEDED');
  });
});

function receipt(
  bookingId: string,
  purpose: 'DEPOSIT' | 'BALANCE' = 'DEPOSIT',
  amountVnd = 15000000,
) {
  return {
    bookingId,
    purpose,
    amountVnd,
    settledAt: '2026-10-08T16:00:00Z',
    reason: 'Private receipt',
    evidenceReference: 'private-receipt',
  };
}
