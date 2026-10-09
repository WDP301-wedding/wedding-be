import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import { CATALOG_SEED_IDS } from '../../../scripts/catalog-seed.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';
import { createManualBillingFixture, seedBillingManager } from './operations-fixture.js';
import type { createPaymentsBillingProviders } from '../../../src/modules/payments-billing/payments-billing.providers.js';
import { createPaymentsBillingHttpServices } from '../../../src/modules/payments-billing/http/payments-billing.http-services.js';
import { createPaymentsBillingRouter } from '../../../src/modules/payments-billing/http/payments-billing.router.js';
import {
  billingResponseSchema,
  paymentResponseSchema,
  refundResponseSchema,
  refundApprovalResponseSchema,
} from '../../../src/modules/payments-billing/http/payments-billing.schemas.js';
import { errorResponseSchema } from '../../../src/core/http/common.schemas.js';

type Providers = ReturnType<typeof createPaymentsBillingProviders>;
(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'billing HTTP recovery and race boundaries',
  () => {
    const database = new CatalogTestDatabase('billing_http_recovery');
    beforeAll(async () => {
      await database.connect();
      await seedBillingManager(database.prisma);
    }, 60000);
    afterAll(() => database.disconnect());
    async function fixture(
      transform: (providers: Providers) => Providers = (providers) => providers,
    ) {
      const f = await createManualBillingFixture(database.prisma);
      const services = createPaymentsBillingHttpServices(database.prisma, transform(f.providers));
      const router = createPaymentsBillingRouter({
        services,
        resolveActor: {
          resolve() {
            return Promise.resolve({
              accountId: CATALOG_SEED_IDS.actor,
              sessionId: randomUUID(),
              displayEmail: 'private-manager@example.com',
              roles: ['MANAGER'],
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
      const manual = {
        bookingId: f.bookingId,
        purpose: 'DEPOSIT' as const,
        amountVnd: 15000000,
        settledAt: f.deposit.settledAt,
        reason: 'Receipt',
        evidenceReference: 'private-receipt',
      };
      return { ...f, app, manual };
    }
    function post(app: ReturnType<typeof createApp>, path: string, body: object, key: string) {
      return request(app)
        .post(`/api/v1${path}`)
        .auth('manager', { type: 'bearer' })
        .set('Idempotency-Key', key)
        .send(body);
    }

    it('recovers a committed manual deposit before re-resolving now-ineligible booking metadata', async () => {
      let fail = true;
      const f = await fixture((providers) => ({
        ...providers,
        operations: {
          ...providers.operations,
          async recordManualPayment(...args) {
            const result = await providers.operations.recordManualPayment(...args);
            if (fail) {
              fail = false;
              throw new Error('owner committed but response interrupted');
            }
            return result;
          },
        },
      }));
      await post(f.app, '/management/billing/payments/manual', f.manual, 'recovery-manual').expect(
        500,
      );
      expect(
        (await database.prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } })).phase,
      ).toBe('CONFIRMED');
      const result = paymentResponseSchema.parse(
        (
          await post(
            f.app,
            '/management/billing/payments/manual',
            f.manual,
            'recovery-manual',
          ).expect(201)
        ).body,
      ).data;
      expect(
        await database.prisma.billingLedgerEntry.count({
          where: { bookingId: f.bookingId, kind: 'PAYMENT' },
        }),
      ).toBe(1);
      expect(
        (
          await database.prisma.billingLedgerEntry.findUniqueOrThrow({
            where: { id: result.paymentId },
          })
        ).paymentAttemptId,
      ).toBe(result.paymentAttemptId);
      const other = await fixture();
      await post(
        f.app,
        '/management/billing/payments/manual',
        { ...f.manual, bookingId: other.bookingId },
        'recovery-manual',
      ).expect(422);
    });
    it('recovers a committed refund approval after a response failure and a newer ledger revision', async () => {
      let fail = true;
      const f = await fixture((providers) => ({
        ...providers,
        operations: {
          ...providers.operations,
          async approveRefund(...args) {
            const result = await providers.operations.approveRefund(...args);
            if (fail) {
              fail = false;
              throw new Error('approval committed but response interrupted');
            }
            return result;
          },
        },
      }));
      await f.operations.recordManualPayment(f.deposit, f.manager);
      const charge = await f.providers.charges.registerAcceptedCharge({
        bookingId: f.bookingId,
        sourceType: 'PRINT_ORDER',
        sourceRevisionId: randomUUID(),
        amountVnd: 1_000_000,
        acceptedAt: new Date('2026-10-08T16:01:00Z'),
      });
      const credit = await f.providers.charges.registerCredit(
        {
          bookingId: f.bookingId,
          receivableChargeId: charge.receivableChargeId,
          sourceAdjustmentId: randomUUID(),
          amountVnd: 1_000_000,
          reason: 'PRINT_CANCELLED',
          acceptedAt: '2026-10-08T16:02:00Z',
        },
        f.system,
      );
      const body = {
        bookingId: f.bookingId,
        expectedBillingRevision: 4,
        basis: { kind: 'CREDIT', sourceEntryId: credit.adjustmentId },
        approvedRefundableVnd: 1_000_000,
        reason: 'Approved refund',
        evidenceReference: 'private-decision',
      };
      await post(f.app, '/management/billing/refund-approvals', body, 'recovery-approval').expect(
        500,
      );
      const decision = await database.prisma.billingRefundApproval.findFirstOrThrow({
        where: { bookingId: f.bookingId },
      });
      await f.operations.recordManualPayment(
        {
          bookingId: f.bookingId,
          commandId: randomUUID(),
          purpose: 'BALANCE',
          expectedBillingRevision: 4,
          amountVnd: 1,
          settledAt: f.deposit.settledAt,
          reason: 'Receipt',
          evidenceReference: 'balance',
        },
        f.manager,
      );
      const result = refundApprovalResponseSchema.parse(
        (
          await post(
            f.app,
            '/management/billing/refund-approvals',
            body,
            'recovery-approval',
          ).expect(201)
        ).body,
      );
      expect(result.data.refundApprovalId).toBe(decision.id);
      expect(
        await database.prisma.billingRefundApproval.count({ where: { bookingId: f.bookingId } }),
      ).toBe(1);
    });
    it('recovers a committed refund after its approval consumption and billing revision change', async () => {
      let fail = true;
      const f = await fixture((providers) => ({
        ...providers,
        operations: {
          ...providers.operations,
          async recordRefund(...args) {
            const result = await providers.operations.recordRefund(...args);
            if (fail) {
              fail = false;
              throw new Error('refund committed but response interrupted');
            }
            return result;
          },
        },
      }));
      const payment = await f.operations.recordManualPayment(f.deposit, f.manager);
      const charge = await f.providers.charges.registerAcceptedCharge({
        bookingId: f.bookingId,
        sourceType: 'PRINT_ORDER',
        sourceRevisionId: randomUUID(),
        amountVnd: 1000000,
        acceptedAt: new Date('2026-10-08T16:01:00Z'),
      });
      const credit = await f.providers.charges.registerCredit(
        {
          bookingId: f.bookingId,
          receivableChargeId: charge.receivableChargeId,
          sourceAdjustmentId: randomUUID(),
          amountVnd: 1000000,
          reason: 'PRINT_CANCELLED',
          acceptedAt: '2026-10-08T16:02:00Z',
        },
        f.system,
      );
      await f.operations.approveRefund(
        {
          bookingId: f.bookingId,
          commandId: randomUUID(),
          basis: { kind: 'CREDIT', sourceEntryId: credit.adjustmentId },
          approvedRefundableVnd: 1000000,
          reason: 'Approved',
          evidenceReference: 'private-decision',
        },
        f.manager,
      );
      const body = {
        sourcePaymentId: payment.resourceId,
        amountVnd: 1000000,
        expectedBillingRevision: 4,
        reason: 'Refund',
        evidenceReference: 'private-refund',
      };
      await post(f.app, '/management/billing/refunds', body, 'recovery-refund').expect(500);
      const expected = await database.prisma.billingLedgerEntry.findFirstOrThrow({
        where: { bookingId: f.bookingId, kind: 'REFUND' },
      });
      await f.operations.recordManualPayment(
        {
          bookingId: f.bookingId,
          commandId: randomUUID(),
          purpose: 'BALANCE',
          expectedBillingRevision: 5,
          amountVnd: 1,
          settledAt: f.deposit.settledAt,
          reason: 'Receipt',
          evidenceReference: 'balance',
        },
        f.manager,
      );
      const result = refundResponseSchema.parse(
        (await post(f.app, '/management/billing/refunds', body, 'recovery-refund').expect(201))
          .body,
      ).data;
      expect(result.refundId).toBe(expected.id);
      expect(
        await database.prisma.billingLedgerEntry.count({
          where: { bookingId: f.bookingId, kind: 'REFUND' },
        }),
      ).toBe(1);
    });
    it('returns in-progress at HTTP and executes one money command under the same key', async () => {
      let release!: () => void;
      let start!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const entered = new Promise<void>((resolve) => {
        start = resolve;
      });
      const f = await fixture((providers) => ({
        ...providers,
        operations: {
          ...providers.operations,
          async recordManualPayment(...args) {
            start();
            await gate;
            return providers.operations.recordManualPayment(...args);
          },
        },
      }));
      const first = post(
        f.app,
        '/management/billing/payments/manual',
        f.manual,
        'http-concurrent',
      ).then((response) => response);
      await entered;
      const duplicate = await post(
        f.app,
        '/management/billing/payments/manual',
        f.manual,
        'http-concurrent',
      ).expect(409);
      expect(errorResponseSchema.parse(duplicate.body).error.code).toBe('REQUEST_IN_PROGRESS');
      expect(duplicate.headers['retry-after']).toBe('1');
      release();
      expect((await first).status).toBe(201);
      expect(
        await database.prisma.billingLedgerEntry.count({
          where: { bookingId: f.bookingId, kind: 'PAYMENT' },
        }),
      ).toBe(1);
    });
    it('keeps history and totals at the original fence while newer money is appended', async () => {
      const f = await fixture();
      await f.operations.recordManualPayment(f.deposit, f.manager);
      const url = `/api/v1/bookings/${f.bookingId}/billing`;
      const first = billingResponseSchema.parse(
        (await request(f.app).get(`${url}?limit=1`).auth('manager', { type: 'bearer' }).expect(200))
          .body,
      ).data;
      await f.operations.recordManualPayment(
        {
          bookingId: f.bookingId,
          commandId: randomUUID(),
          purpose: 'BALANCE',
          expectedBillingRevision: 2,
          amountVnd: 1,
          settledAt: f.deposit.settledAt,
          reason: 'Receipt',
          evidenceReference: 'balance',
        },
        f.manager,
      );
      const second = billingResponseSchema.parse(
        (
          await request(f.app)
            .get(url)
            .query({ limit: '1', cursor: first.nextCursor })
            .auth('manager', { type: 'bearer' })
            .expect(200)
        ).body,
      ).data;
      expect(second.billingRevision).toBe(first.billingRevision);
      expect(second.totals).toEqual(first.totals);
      expect(second.nextCursor).toBeNull();
      await request(f.app).get(`${url}?limit=101`).auth('manager', { type: 'bearer' }).expect(422);
      await request(f.app)
        .get(`${url}?cursor=invalid`)
        .auth('manager', { type: 'bearer' })
        .expect(422);
    });
    it('rechecks database Manager role before cached replay despite stale actor claims', async () => {
      const f = await fixture();
      await post(f.app, '/management/billing/payments/manual', f.manual, 'role-replay').expect(201);
      await database.prisma.accountRole.delete({
        where: { accountId_role: { accountId: CATALOG_SEED_IDS.actor, role: 'MANAGER' } },
      });
      try {
        await post(f.app, '/management/billing/payments/manual', f.manual, 'role-replay').expect(
          403,
        );
      } finally {
        await database.prisma.accountRole.create({
          data: { accountId: CATALOG_SEED_IDS.actor, role: 'MANAGER' },
        });
      }
      expect(
        await database.prisma.billingLedgerEntry.count({
          where: { bookingId: f.bookingId, kind: 'PAYMENT' },
        }),
      ).toBe(1);
    });
  },
);
