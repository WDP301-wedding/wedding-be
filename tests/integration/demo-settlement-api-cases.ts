import { expect, it, vi } from 'vitest';
import type { StepSixApiHarness } from './commercial-step6-api-cases.js';
import { selectionResponseSchema } from '../../src/modules/booking-lifecycle/domain/commercial-selections.js';
import { contractResponseSchema } from '../../src/modules/booking-lifecycle/domain/commercial-contract.js';
import { finalInvoiceResponseSchema } from '../../src/modules/payments-billing/domain/final-invoice.js';
import {
  billingResponseSchema,
  checkoutResponseSchema,
} from '../../src/modules/payments-billing/http/payments-billing.schemas.js';

export function registerDemoSettlementApiCases(h: StepSixApiHarness) {
  async function prepared() {
    const f = await h.fixture();
    const lines = h.getLines().filter((line) => line.category !== 'PRINT');
    const saved = await h.post(
      `/bookings/${f.id}/contract-selections/drafts`,
      {
        expectedRevision: f.revision,
        lines,
      },
      'own',
    );
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const selected = selectionResponseSchema.parse(saved.body as unknown).data;
    const submitted = await h.post(
      `/bookings/${f.id}/contract-selections/submissions`,
      {
        expectedRevision: selected.bookingRevision,
        selectionRevisionId: selected.selection.revisionId,
      },
      'own',
    );
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    const created = await h.post(f.path, {
      expectedRevision: selectionResponseSchema.parse(submitted.body as unknown).data
        .bookingRevision,
      predecessorRevisionId: null,
      timelineRevisionId: f.timelineId,
      lines,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    let d = contractResponseSchema.parse(created.body as unknown).data;
    for (const [action, who] of [
      ['submissions', 'manager'],
      ['approvals', 'manager'],
      ['approvals', 'own'],
    ] as const) {
      const response = await h.post(
        `${f.path}/${d.contract.revisionId}/${action}`,
        {
          expectedRevision: d.bookingRevision,
        },
        who,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      d = contractResponseSchema.parse(response.body as unknown).data;
    }
    const total = d.contract.document.contractTotalVnd;
    const deposit = Math.ceil((total * 30) / 100);
    const payment = await h.post('/management/billing/payments/manual', {
      bookingId: f.id,
      purpose: 'DEPOSIT',
      contractRevisionId: d.contract.revisionId,
      documentDigest: d.contract.documentDigest,
      amountVnd: deposit,
      settledAt: new Date().toISOString(),
      reason: 'Local demo settlement regression',
      evidenceReference: 'LOCAL-DEMO-SETTLEMENT',
    });
    expect(payment.status, JSON.stringify(payment.body)).toBe(201);
    return { f, d, total, deposit };
  }
  it.each([0, 100_000])(
    'demo finalizes a future event with %i VND expenses and enables the remaining balance',
    async (expenseVnd) => {
      vi.stubEnv('STRICT_SETTLEMENT_DATE_CHECK', undefined);
      try {
        const { f, d, total, deposit } = await prepared();
        // Direct SQL remains strict outside the authorized settlement transaction.
        await expect(
          h.database.prisma.$queryRaw`SELECT require_event_ended(${f.id}::uuid)`,
        ).rejects.toThrow('commercial invoice requires authoritative event end');
        if (expenseVnd > 0) {
          const expense = await h.post(`/management/bookings/${f.id}/incidental-expenses`, {
            expectedRevision: 0,
            name: 'Phát sinh demo',
            quantity: 1,
            unit: 'lần',
            unitPriceVnd: expenseVnd,
          });
          expect(expense.status, JSON.stringify(expense.body)).toBe(201);
        }
        const path = `/management/bookings/${f.id}/final-invoices`;
        const body = {
          expectedDraftRevision: expenseVnd > 0 ? 1 : 0,
          expectedCommercialRevisionId: d.contract.revisionId,
          expectedBillingRevision: 2,
        };
        expect((await h.post(path, body, 'own')).status).toBe(403);
        const response = await h.post(path, body);
        expect(response.status, JSON.stringify(response.body)).toBe(201);
        const invoice = finalInvoiceResponseSchema.parse(response.body as unknown).data;
        expect(invoice.document.totalVnd).toBe(total + expenseVnd);
        expect(invoice.document.incidentalTotalVnd).toBe(expenseVnd);
        expect((await h.post(path, body)).body).toEqual(response.body);
        expect(
          await h.database.prisma.finalInvoiceRevision.count({ where: { bookingId: f.id } }),
        ).toBe(1);
        expect(
          await h.database.prisma.billingLedgerEntry.count({ where: { bookingId: f.id } }),
        ).toBe(expenseVnd > 0 ? 3 : 2);
        // The pooled connection must not retain demo permission after commit/replay.
        await expect(
          h.database.prisma.$queryRaw`SELECT require_event_ended(${f.id}::uuid)`,
        ).rejects.toThrow('commercial invoice requires authoritative event end');
        const billing = billingResponseSchema.parse(
          (await h.get(`/bookings/${f.id}/billing`, 'own')).body as unknown,
        ).data;
        expect(billing.balancePaymentEligibility?.canPay).toBe(true);
        const checkout = await h.post(
          `/bookings/${f.id}/payments/balance`,
          { expectedBillingRevision: billing.billingRevision },
          'own',
        );
        expect(checkout.status, JSON.stringify(checkout.body)).toBe(201);
        const attempt = checkoutResponseSchema.parse(checkout.body as unknown).data;
        expect(new URL(attempt.checkoutUrl).searchParams.get('vnp_Amount')).toBe(
          String((total + expenseVnd - deposit) * 100),
        );
      } finally {
        vi.unstubAllEnvs();
      }
    },
    30_000,
  );

  it('strict mode refuses future finalization without creating invoice or ledger entries', async () => {
    vi.stubEnv('STRICT_SETTLEMENT_DATE_CHECK', 'true');
    try {
      const { f, d } = await prepared();
      const result = await h.post(`/management/bookings/${f.id}/final-invoices`, {
        expectedDraftRevision: 0,
        expectedCommercialRevisionId: d.contract.revisionId,
        expectedBillingRevision: 2,
      });
      expect(result.status, JSON.stringify(result.body)).toBe(409);
      expect(result.body).toMatchObject({ error: { code: 'EVENT_NOT_ENDED' } });
      expect(
        await h.database.prisma.finalInvoiceRevision.count({ where: { bookingId: f.id } }),
      ).toBe(0);
      expect(await h.database.prisma.billingLedgerEntry.count({ where: { bookingId: f.id } })).toBe(
        2,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  }, 30_000);

  it('demo settlement rejects an unconfirmed booking in both application and database guards', async () => {
    vi.stubEnv('STRICT_SETTLEMENT_DATE_CHECK', undefined);
    try {
      const f = await h.fixture();
      const result = await h.post(`/management/bookings/${f.id}/incidental-expenses`, {
        expectedRevision: 0,
        name: 'Phát sinh demo',
        quantity: 1,
        unit: 'lần',
        unitPriceVnd: 100_000,
      });
      expect(result.status, JSON.stringify(result.body)).toBe(409);
      expect(result.body).toMatchObject({ error: { code: 'INVOICE_NOT_ELIGIBLE' } });
      await expect(
        h.database.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT set_config('app.strict_settlement_date_check', 'false', true)`;
          await tx.$queryRaw`SELECT require_event_ended(${f.id}::uuid)`;
        }),
      ).rejects.toThrow('commercial invoice requires eligible booking');
    } finally {
      vi.unstubAllEnvs();
    }
  }, 30_000);
}
