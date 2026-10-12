import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import type { StepSixApiHarness } from './commercial-step6-api-cases.js';
import {
  appendixResponseSchema,
  appendicesResponseSchema,
} from '../../src/modules/booking-lifecycle/domain/commercial-appendix.js';
import {
  expenseDraftResponseSchema,
  finalInvoiceResponseSchema,
} from '../../src/modules/payments-billing/domain/final-invoice.js';
import {
  billingResponseSchema,
  checkoutResponseSchema,
} from '../../src/modules/payments-billing/http/payments-billing.schemas.js';
import { designResponse } from '../../src/modules/invitation-studio/http/studio.schemas.js';
import { printOrderResponseSchema } from '../../src/modules/invitation-studio/http/print-orders.schemas.js';
import { ipnFixture } from './payments-billing/vnpay-fixture.js';
import { NotificationFoundation } from '../../src/modules/notifications-automation/infrastructure/notification-foundation.js';
import { NotificationEventConsumer } from '../../src/modules/notifications-automation/infrastructure/event-consumer.js';
import { createNotificationBookingReader } from '../../src/modules/booking-lifecycle/infrastructure/notification-context.reader.js';
import { createNotificationIdentityReader } from '../../src/modules/identity-access/authorization/notification-recipient.reader.js';

export function registerCommercialSettlementJourney(harness: StepSixApiHarness) {
  const { database, paidFixture, getLines, post, get, total, deposit } = harness;
  it('settles the complete appendix, print, expense, invoice, balance and refund journey without rewriting history', async () => {
    const { f, d } = await paidFixture(true);
    const servicePrice = d.contract.document.lines.find(
      (l) => l.category === 'SERVICE',
    )!.unitPriceVnd;
    const appendixPath = `/bookings/${f.id}/contract-appendices`;
    let predecessor = d.contract.revisionId;
    for (const quantity of [3, 2]) {
      const state = appendicesResponseSchema.parse(
        (await get(appendixPath, 'own')).body as unknown,
      ).data;
      const created = await post(
        appendixPath,
        {
          expectedRevision: state.bookingRevision,
          predecessorRevisionId: predecessor,
          reason: 'Điều chỉnh dịch vụ hành trình quyết toán',
          lines: getLines().map((l) => (l.category === 'SERVICE' ? { ...l, quantity } : l)),
        },
        'own',
      );
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      let appendix = appendixResponseSchema.parse(created.body as unknown).data;
      expect(appendix.appendix.document.deltaVnd).toBe(
        quantity === 3 ? 2 * servicePrice : -servicePrice,
      );
      for (const [action, who] of [
        ['submissions', 'own'],
        ['approvals', 'manager'],
        ['approvals', 'own'],
      ] as const) {
        const result = await post(
          `${appendixPath}/${appendix.appendix.revisionId}/${action}`,
          { expectedRevision: appendix.bookingRevision },
          who,
        );
        expect(result.status, JSON.stringify(result.body)).toBe(200);
        appendix = appendixResponseSchema.parse(result.body as unknown).data;
      }
      predecessor = appendix.appendix.revisionId;
    }
    const selected = getLines().find((l) => l.category === 'PRINT')!;
    const offering = await database.prisma.printOfferingRevision.findUniqueOrThrow({
      where: { id: selected.sourceRevisionId },
    });
    const createdDesign = await post(
      `/bookings/${f.id}/invitations`,
      { templateId: offering.templateId },
      'own',
    );
    expect(createdDesign.status).toBe(201);
    const design = designResponse.parse(createdDesign.body as unknown).data;
    expect(
      (
        await post(
          `/bookings/${f.id}/invitations/${design.designId}/publication`,
          {
            expectedRevision: 1,
            designRevisionId: design.revisionId,
            expectedPublicationRevision: 0,
          },
          'own',
        )
      ).status,
    ).toBe(200);
    const requested = await post(
      `/bookings/${f.id}/print-orders`,
      {
        lines: [
          {
            designId: design.designId,
            quantity: selected.quantity,
            commercialSource: {
              agreementRevisionId: predecessor,
              offeringId: selected.sourceId,
              sourceRevisionId: selected.sourceRevisionId,
            },
          },
        ],
      },
      'own',
    );
    expect(requested.status, JSON.stringify(requested.body)).toBe(201);
    let order = printOrderResponseSchema.parse(requested.body as unknown).data;
    const quoted = await post(`/management/print-orders/${order.orderId}/quotations`, {
      expectedRevision: order.revision,
      lines: [{ lineId: order.lines[0]!.lineId, unitPriceVnd: offering.unitPriceVnd.toNumber() }],
      estimatedHandoverAt: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(quoted.status, JSON.stringify(quoted.body)).toBe(200);
    order = printOrderResponseSchema.parse(quoted.body as unknown).data;
    const accepted = await post(
      `/bookings/${f.id}/print-orders/${order.orderId}/approval`,
      {
        expectedRevision: order.revision,
        commercialRevisionId: order.currentCommercialRevisionId,
      },
      'own',
    );
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    order = printOrderResponseSchema.parse(accepted.body as unknown).data;
    for (const transition of ['production', 'ready', 'handover']) {
      const result = await post(`/management/print-orders/${order.orderId}/${transition}`, {
        expectedRevision: order.revision,
        ...(transition === 'handover' ? { evidenceReference: 'LOCAL-JOURNEY-HANDOVER' } : {}),
      });
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      order = printOrderResponseSchema.parse(result.body as unknown).data;
    }
    const expenses = await post(`/management/bookings/${f.id}/incidental-expenses`, {
      expectedRevision: 0,
      name: 'Chi phí cuối tiệc',
      quantity: 2,
      unit: 'lần',
      unitPriceVnd: 1_000_000,
    });
    expect(expenses.status).toBe(201);
    const draft = expenseDraftResponseSchema.parse(expenses.body as unknown).data;
    const finalized = await post(`/management/bookings/${f.id}/final-invoices`, {
      expectedDraftRevision: draft.revision,
      expectedCommercialRevisionId: predecessor,
      expectedBillingRevision: 4,
    });
    expect(finalized.status, JSON.stringify(finalized.body)).toBe(201);
    const original = finalInvoiceResponseSchema.parse(finalized.body as unknown).data;
    expect(original.document).toMatchObject({
      commercialTotalVnd: total + servicePrice,
      incidentalTotalVnd: 2_000_000,
      totalVnd: total + servicePrice + 2_000_000,
    });
    expect(original.document.appendices).toHaveLength(2);
    const checkout = await post(
      `/bookings/${f.id}/payments/balance`,
      { expectedBillingRevision: 5 },
      'own',
    );
    expect(checkout.status, JSON.stringify(checkout.body)).toBe(201);
    const attempt = checkoutResponseSchema.parse(checkout.body as unknown).data;
    const due = original.document.totalVnd - deposit;
    expect(new URL(attempt.checkoutUrl).searchParams.get('vnp_Amount')).toBe(String(due * 100));
    expect(
      await database.prisma.billingPaymentAttempt.findUniqueOrThrow({
        where: { id: attempt.paymentAttemptId },
      }),
    ).toMatchObject({
      invoiceRevisionId: original.invoiceRevisionId,
      invoiceDigest: original.documentDigest,
      sourceBillingRevision: 5,
    });
    const callback =
      '/billing/callbacks/vnpay?' +
      ipnFixture(attempt.paymentAttemptId, {
        vnp_Amount: String(due * 100),
        vnp_PayDate: '20261011100000',
      });
    expect((await get(callback, 'anonymous')).body).toMatchObject({ RspCode: '00' });
    expect((await get(callback, 'anonymous')).body).toMatchObject({ RspCode: '02' });
    const correction = await post(`/management/bookings/${f.id}/invoice-adjustments`, {
      expectedInvoiceRevisionId: original.invoiceRevisionId,
      expectedBillingRevision: 6,
      reason: 'Giảm giá sau quyết toán',
      lines: [
        { name: 'Giảm giá', quantity: 1, unit: 'lần', unitPriceVnd: 1_000_000, kind: 'CREDIT' },
      ],
    });
    expect(correction.status, JSON.stringify(correction.body)).toBe(201);
    const adjusted = finalInvoiceResponseSchema.parse(correction.body as unknown).data;
    const bill = billingResponseSchema.parse(
      (await get(`/bookings/${f.id}/billing`, 'own')).body as unknown,
    ).data;
    expect(bill.totals).toMatchObject({
      acceptedChargesVnd: total + servicePrice + 1_000_000,
      paidVnd: total + servicePrice + 2_000_000,
      refundedVnd: 0,
      creditVnd: 1_000_000,
      outstandingVnd: 0,
    });
    expect(bill.history.filter((e) => e.sourceType === 'CONTRACT')).toHaveLength(1);
    expect(bill.history.filter((e) => e.sourceType === 'CONTRACT_APPENDIX')).toHaveLength(2);
    expect(bill.history.some((e) => e.sourceType === 'PRINT_ORDER')).toBe(false);
    expect(order.receivableChargeId).toBe(
      bill.history.find((e) => e.sourceType === 'CONTRACT')!.ledgerEntryId,
    );
    expect(
      (
        await post('/management/billing/refund-approvals', {
          bookingId: f.id,
          expectedBillingRevision: 7,
          approvedRefundableVnd: 1_000_000,
          basis: {
            kind: 'CREDIT',
            sourceEntryId: bill.history.find((e) => e.sourceType === 'INVOICE_ADJUSTMENT')!
              .ledgerEntryId,
          },
          reason: 'Hoàn dư quyết toán',
          evidenceReference: 'LOCAL-JOURNEY-APPROVAL',
        })
      ).status,
    ).toBe(201);
    const key = randomUUID();
    const refundBody = {
      sourcePaymentId: bill.history.find((e) => e.paymentAttemptId === attempt.paymentAttemptId)!
        .ledgerEntryId,
      amountVnd: 1_000_000,
      expectedBillingRevision: 7,
      reason: 'Hoàn tiền thủ công',
      evidenceReference: 'LOCAL-JOURNEY-REFUND',
    };
    const refund = await post('/management/billing/refunds', refundBody, 'manager', key);
    expect(refund.status, JSON.stringify(refund.body)).toBe(201);
    expect((await post('/management/billing/refunds', refundBody, 'manager', key)).body).toEqual(
      refund.body,
    );
    expect(
      billingResponseSchema.parse((await get(`/bookings/${f.id}/billing`, 'own')).body as unknown)
        .data.totals,
    ).toMatchObject({
      netPaidVnd: adjusted.document.totalVnd,
      refundedVnd: 1_000_000,
      outstandingVnd: 0,
      creditVnd: 0,
    });
    expect(
      (await get(`/bookings/${f.id}/final-invoices/${original.invoiceRevisionId}`, 'own')).body,
    ).toEqual(finalized.body);
    expect(
      (
        await database.prisma.bookingDepositSettlement.findUniqueOrThrow({
          where: { bookingId: f.id },
        })
      ).amountVnd.toNumber(),
    ).toBe(deposit);
    const ledgerBefore = await database.prisma.billingLedgerEntry.findMany({
      where: { bookingId: f.id },
      orderBy: { id: 'asc' },
    });
    const consultation = await database.prisma.booking.findUniqueOrThrow({
      where: { id: f.id },
      select: { consultation: { select: { managerAccountId: true } } },
    });
    await database.prisma.notificationRecipient.create({
      data: {
        accountId: consultation.consultation.managerAccountId,
        operational: true,
        purposes: [
          'CONTRACT',
          'APPENDIX',
          'PAYMENT',
          'REFUND',
          'FINAL_INVOICE',
          'PRINT',
          'ACCESS_PROMOTED',
        ],
      },
    });
    const notifications = new NotificationEventConsumer(
      new NotificationFoundation(database.prisma),
      createNotificationBookingReader(database.prisma),
      createNotificationIdentityReader(database.prisma),
    );
    let remaining = 100;
    for (let run = 0; run < 10 && remaining > 0; run++) remaining = await notifications.poll(100);
    expect(remaining).toBe(0);
    const intents = await database.prisma.notificationIntent.findMany({
      where: { bookingId: f.id },
    });
    for (const purpose of [
      'CONTRACT',
      'APPENDIX',
      'PAYMENT',
      'REFUND',
      'FINAL_INVOICE',
      'PRINT',
      'ACCESS_PROMOTED',
    ]) {
      expect(
        intents.some((i) => i.purpose === purpose),
        purpose,
      ).toBe(true);
    }
    expect(intents.some((i) => i.recipientId !== intents[0]?.recipientId)).toBe(true);
    const delivered = intents.length;
    expect(await notifications.poll(100)).toBe(0);
    expect(await database.prisma.notificationIntent.count({ where: { bookingId: f.id } })).toBe(
      delivered,
    );
    expect(
      await database.prisma.billingLedgerEntry.findMany({
        where: { bookingId: f.id },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(ledgerBefore);
    expect(
      await database.prisma.billingOutboxEvent.count({
        where: { aggregateId: f.id, publishedAt: { not: null } },
      }),
    ).toBe(0);
    expect(JSON.stringify(intents.map((i) => i.data))).not.toMatch(
      /credential|email|phone|evidenceReference|reason|items/u,
    );
  }, 90_000);
}
