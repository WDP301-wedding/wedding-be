import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { StepSixApiHarness } from './commercial-step6-api-cases.js';
import { createAnalyticsServices } from '../../src/modules/analytics-dashboard/infrastructure/analytics.composition.js';
import { analyticsResultSchemas } from '../../src/modules/analytics-dashboard/http/analytics.schemas.js';
import { appendixResponseSchema } from '../../src/modules/booking-lifecycle/domain/commercial-appendix.js';
import { billingResponseSchema } from '../../src/modules/payments-billing/http/payments-billing.schemas.js';
import { finalInvoiceResponseSchema } from '../../src/modules/payments-billing/domain/final-invoice.js';
export function registerAnalyticsCommercialCases(h: StepSixApiHarness) {
  it('ANL-W1/W4 projects mutually approved services/appendices and finalized expenses exactly once from real owners', async () => {
    const { f, d } = await h.paidFixture(true),
      prisma = h.database.prisma,
      s = createAnalyticsServices(prisma);
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: f.id } }),
      date = b.eventDate.toISOString().slice(0, 10);
    const query = { dateFrom: date, dateTo: date, hallId: b.hallId };
    const c = {
      authority: 'AUTHENTICATED' as const,
      actorAccountId: h.accounts.manager!,
      requestId: randomUUID(),
      causationId: randomUUID(),
    };
    const report = async () =>
      analyticsResultSchemas.revenue.parse(await s.service.query('revenue', query, c));
    const before = await report();
    const path = `/bookings/${f.id}/contract-appendices`;
    const selections = h
      .getLines()
      .map((l) => (l.category === 'SERVICE' ? { ...l, quantity: l.quantity + 1 } : l));
    const draft = await h.post(
      path,
      {
        expectedRevision: (await prisma.booking.findUniqueOrThrow({ where: { id: f.id } }))
          .revision,
        predecessorRevisionId: d.contract.revisionId,
        reason: 'Analytics signed service delta',
        lines: selections,
      },
      'own',
    );
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    let a = appendixResponseSchema.parse(draft.body as unknown).data;
    const submit = await h.post(
      `${path}/${a.appendix.revisionId}/submissions`,
      { expectedRevision: a.bookingRevision },
      'own',
    );
    expect(submit.status).toBe(200);
    a = appendixResponseSchema.parse(submit.body as unknown).data;
    const delta = a.appendix.document.deltaVnd;
    expect((await report()).effectiveAgreedTotalVnd).toBe(before.effectiveAgreedTotalVnd);
    for (const who of ['manager', 'own']) {
      const approval = await h.post(
        `${path}/${a.appendix.revisionId}/approvals`,
        { expectedRevision: a.bookingRevision },
        who,
      );
      expect(approval.status, JSON.stringify(approval.body)).toBe(200);
      a = appendixResponseSchema.parse(approval.body as unknown).data;
    }
    const expense = await h.post(`/management/bookings/${f.id}/incidental-expenses`, {
      expectedRevision: 0,
      name: 'Nước phát sinh',
      unit: 'chai',
      quantity: 2,
      unitPriceVnd: 12345,
    });
    expect(expense.status).toBe(201);
    expect((await report()).finalizedIncidentalTotalVnd).toBe(before.finalizedIncidentalTotalVnd);
    const bill = billingResponseSchema.parse(
      (await h.get(`/bookings/${f.id}/billing`, 'own')).body as unknown,
    ).data;
    const body = {
      expectedDraftRevision: 1,
      expectedCommercialRevisionId: a.appendix.revisionId,
      expectedBillingRevision: bill.billingRevision,
    };
    const final = await h.post(`/management/bookings/${f.id}/final-invoices`, body);
    expect(final.status, JSON.stringify(final.body)).toBe(201);
    const invoice = finalInvoiceResponseSchema.parse(final.body as unknown).data;
    expect((await h.post(`/management/bookings/${f.id}/final-invoices`, body)).body).toEqual(
      final.body,
    );
    const after = await report();
    expect(after.originalContractTotalVnd).toBe(before.originalContractTotalVnd);
    expect(after.approvedAppendixDeltaVnd).toBe(before.approvedAppendixDeltaVnd! + delta);
    expect(after.effectiveAgreedTotalVnd).toBe(before.effectiveAgreedTotalVnd! + delta);
    expect(after.finalizedIncidentalTotalVnd).toBe(before.finalizedIncidentalTotalVnd! + 24690);
    expect(after.finalInvoiceTotalVnd).toBe(
      before.finalInvoiceTotalVnd! + invoice.document.totalVnd,
    );
    const currentBill = billingResponseSchema.parse(
      (await h.get(`/bookings/${f.id}/billing`, 'own')).body as unknown,
    ).data;
    expect(currentBill.totals.acceptedChargesVnd).toBe(invoice.document.totalVnd);
    expect(currentBill.history.filter((e) => e.sourceType === 'PRINT_ORDER')).toHaveLength(0);
    await s.projector.refresh(c.actorAccountId, c, true);
    expect(await report()).toMatchObject({
      originalContractTotalVnd: after.originalContractTotalVnd,
      finalInvoiceTotalVnd: after.finalInvoiceTotalVnd,
      receivablesVnd: after.receivablesVnd,
      creditBalanceVnd: after.creditBalanceVnd,
    });
    const popularity = analyticsResultSchemas.bookings.parse(
      await s.service.query('bookings', query, c),
    );
    expect(
      popularity.servicePopularity.some(
        (p) =>
          p.sourceRevisionId === selections.find((l) => l.category === 'SERVICE')!.sourceRevisionId,
      ),
    ).toBe(true);
  }, 30000);
}
