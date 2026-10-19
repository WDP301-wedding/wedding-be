import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { issuedSessionResponseSchema } from '../../../src/modules/identity-access/identity.schemas.js';
import {
  billingResponseSchema,
  checkoutResponseSchema,
} from '../../../src/modules/payments-billing/http/payments-billing.schemas.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';
import { seedBillingManager } from './operations-fixture.js';
import { createAcceptanceFixture } from './acceptance-fixture.js';
import { ipnFixture } from './vnpay-fixture.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'W8 real-owner billing acceptance journey',
  () => {
    const database = new CatalogTestDatabase('billing_acceptance');
    let f: Awaited<ReturnType<typeof createAcceptanceFixture>>;
    let couple: { accessToken: string };
    let manager: { accessToken: string };
    beforeAll(async () => {
      await database.connect();
      await seedBillingManager(database.prisma);
      const url = new URL(catalogMigrationDatabaseUrl!);
      url.pathname = `/${database.databaseName}`;
      f = await createAcceptanceFixture(database.prisma, url.toString());
      async function login(email: string) {
        return issuedSessionResponseSchema.parse(
          (
            await request(f.app)
              .post('/api/v1/auth/web-sessions')
              .send({ email, password: f.password })
              .expect(201)
          ).body,
        ).data;
      }
      couple = await login(f.coupleEmail);
      manager = await login(f.managerEmail);
    }, 60000);
    afterAll(async () => {
      await f?.close();
      await database.disconnect();
    });

    it('settles a signed deposit, includes one accepted print source, collects balance, refunds a credit and freezes an invoice', async () => {
      const path = `/api/v1/bookings/${f.bookingId}`;
      await request(f.app)
        .get(`${path}/billing`)
        .auth(couple.accessToken, { type: 'bearer' })
        .expect(403);
      const key = randomUUID();
      const deposit = { timelineRevisionId: f.timelineRevisionId };
      const checkout = checkoutResponseSchema.parse(
        (
          await request(f.app)
            .post(`${path}/payments/deposit`)
            .auth(couple.accessToken, { type: 'bearer' })
            .set('Idempotency-Key', key)
            .send(deposit)
            .expect(201)
        ).body,
      ).data;
      expect(new URL(checkout.checkoutUrl).searchParams.get('vnp_Amount')).toBe('1500000000');
      const callback = ipnFixture(checkout.paymentAttemptId);
      for (const code of ['00', '02']) {
        const response = await request(f.app)
          .get(`/api/v1/billing/callbacks/vnpay?${callback}`)
          .expect(200);
        expect(response.body).toMatchObject({ RspCode: code });
      }
      expect(
        checkoutResponseSchema.parse(
          (
            await request(f.app)
              .post(`${path}/payments/deposit`)
              .auth(couple.accessToken, { type: 'bearer' })
              .set('Idempotency-Key', key)
              .send(deposit)
              .expect(201)
          ).body,
        ).data,
      ).toEqual(checkout);
      expect(
        await database.prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } }),
      ).toMatchObject({ phase: 'CONFIRMED' });
      expect(
        await database.prisma.consultationAccess.findUniqueOrThrow({
          where: {
            accountId_consultationId: {
              accountId: f.accountId,
              consultationId: f.consultationId,
            },
          },
        }),
      ).toMatchObject({ level: 'FULL' });
      expect(
        await database.prisma.billingDepositApplication.count({
          where: { payment: { bookingId: f.bookingId } },
        }),
      ).toBe(1);

      const print = {
        bookingId: f.bookingId,
        sourceType: 'PRINT_ORDER' as const,
        sourceRevisionId: randomUUID(),
        amountVnd: 4_000_000,
        acceptedAt: new Date(),
      };
      const registrations = await Promise.all([
        f.providers.charges.registerAcceptedCharge(print),
        f.providers.charges.registerAcceptedCharge(print),
      ]);
      expect(registrations.map((r) => r.replayed).sort()).toEqual([false, true]);
      expect(registrations[0].receivableChargeId).toBe(registrations[1].receivableChargeId);
      async function read() {
        return billingResponseSchema.parse(
          (
            await request(f.app)
              .get(`${path}/billing`)
              .auth(couple.accessToken, { type: 'bearer' })
              .expect(200)
          ).body,
        ).data;
      }
      const receivables = await read();
      expect(receivables.totals).toMatchObject({
        acceptedChargesVnd: 54_000_000,
        paidVnd: 15_000_000,
        outstandingVnd: 39_000_000,
      });
      expect(
        receivables.history.filter((e) => e.sourceRevisionId === print.sourceRevisionId),
      ).toHaveLength(1);
      const balance = checkoutResponseSchema.parse(
        (
          await request(f.app)
            .post(`${path}/payments/balance`)
            .auth(couple.accessToken, { type: 'bearer' })
            .set('Idempotency-Key', randomUUID())
            .send({ expectedBillingRevision: receivables.billingRevision })
            .expect(201)
        ).body,
      ).data;
      expect(new URL(balance.checkoutUrl).searchParams.get('vnp_Amount')).toBe('3900000000');
      await request(f.app)
        .get(
          `/api/v1/billing/callbacks/vnpay?${ipnFixture(balance.paymentAttemptId, { vnp_Amount: '3900000000' })}`,
        )
        .expect(200)
        .expect(({ body }) => expect(body as unknown).toMatchObject({ RspCode: '00' }));
      const paid = await read();
      expect(paid.totals).toMatchObject({ paidVnd: 54_000_000, outstandingVnd: 0, creditVnd: 0 });
      const invoiceCommand = {
        bookingId: f.bookingId,
        commandId: randomUUID(),
        expectedBillingRevision: paid.billingRevision,
      };
      const issued = await f.providers.operations.issueInvoice(invoiceCommand, f.manager);
      const invoice = await f.providers.views.getInvoice(f.bookingId, issued.resourceId, f.context);
      expect(invoice.totals).toEqual(paid.totals);
      expect(
        invoice.history.filter((e) => e.sourceRevisionId === print.sourceRevisionId),
      ).toHaveLength(1);

      const credit = await f.providers.charges.registerCredit(
        {
          bookingId: f.bookingId,
          receivableChargeId: registrations[0].receivableChargeId,
          sourceAdjustmentId: randomUUID(),
          amountVnd: 1_000_000,
          reason: 'PRINT_REPLACED',
          acceptedAt: new Date().toISOString(),
        },
        f.system,
      );
      await f.providers.operations.approveRefund(
        {
          bookingId: f.bookingId,
          commandId: randomUUID(),
          basis: { kind: 'CREDIT', sourceEntryId: credit.adjustmentId },
          approvedRefundableVnd: 1_000_000,
          reason: 'PRIVATE-W8-approval',
          evidenceReference: 'PRIVATE-W8-approval-reference',
        },
        f.manager,
      );
      const source = paid.history.find((e) => e.paymentAttemptId === balance.paymentAttemptId)!;
      const refundBody = {
        sourcePaymentId: source.ledgerEntryId,
        amountVnd: 1_000_000,
        expectedBillingRevision: (await read()).billingRevision,
        reason: 'PRIVATE-W8-refund',
        evidenceReference: 'PRIVATE-W8-refund-reference',
      };
      const refundKey = randomUUID();
      const refund = await request(f.app)
        .post('/api/v1/management/billing/refunds')
        .auth(manager.accessToken, { type: 'bearer' })
        .set('Idempotency-Key', refundKey)
        .send(refundBody)
        .expect(201);
      expect(
        (
          await request(f.app)
            .post('/api/v1/management/billing/refunds')
            .auth(manager.accessToken, { type: 'bearer' })
            .set('Idempotency-Key', refundKey)
            .send(refundBody)
            .expect(201)
        ).body,
      ).toEqual(refund.body);
      const final = await read();
      expect(final.totals).toEqual({
        acceptedChargesVnd: 53_000_000,
        paidVnd: 54_000_000,
        refundedVnd: 1_000_000,
        netPaidVnd: 53_000_000,
        outstandingVnd: 0,
        creditVnd: 0,
      });
      expect(await f.providers.views.getInvoice(f.bookingId, issued.resourceId, f.context)).toEqual(
        invoice,
      );
      expect(await f.providers.operations.issueInvoice(invoiceCommand, f.manager)).toMatchObject({
        ...issued,
        replayed: true,
      });
      expect(
        await f.providers.views.reader(f.context).requireDepositSettlement(f.bookingId),
      ).toMatchObject({ amountVnd: 15_000_000 });
      expect(final.balancePaymentEligibility).toMatchObject({
        canPay: false,
        reasonCode: 'BILLING_BALANCE_LIMIT_EXCEEDED',
      });
      expect(JSON.stringify(final)).not.toMatch(/PRIVATE-W8|evidenceReference|"reason"\s*:|vnp_/u);
      expect(
        JSON.stringify(
          await database.prisma.auditLog.findMany({ where: { entityType: 'billing' } }),
        ),
      ).not.toContain('PRIVATE-W8');
      await request(f.app)
        .post('/api/v1/management/billing/refunds')
        .auth(couple.accessToken, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send(refundBody)
        .expect(403);
      await request(f.app)
        .delete('/api/v1/auth/sessions/current')
        .auth(manager.accessToken, { type: 'bearer' })
        .send({})
        .expect(204);
      await request(f.app)
        .post('/api/v1/management/billing/refunds')
        .auth(manager.accessToken, { type: 'bearer' })
        .set('Idempotency-Key', refundKey)
        .send(refundBody)
        .expect(401);
    });
  },
);
