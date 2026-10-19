import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import type { z } from 'zod';
import type { Response } from 'supertest';
import type { CatalogTestDatabase } from './venue-catalog/catalog-test-database.js';
import type {
  contractResponseSchema,
  CommercialSelection,
} from '../../src/modules/booking-lifecycle/domain/commercial-contract.js';
import { contractResponseSchema as parseContractResponse } from '../../src/modules/booking-lifecycle/domain/commercial-contract.js';
import { printOfferingViewSchema } from '../../src/modules/venue-catalog/domain/commercial-offering.js';
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
  attemptResponseSchema,
} from '../../src/modules/payments-billing/http/payments-billing.schemas.js';
import { designResponse } from '../../src/modules/invitation-studio/http/studio.schemas.js';
import { designContentSchema } from '../../src/modules/invitation-studio/domain/studio-policy.js';
import { printOrderResponseSchema } from '../../src/modules/invitation-studio/http/print-orders.schemas.js';
import { ipnFixture } from './payments-billing/vnpay-fixture.js';
import { registerContractedPrintPriceApiCases } from './contracted-print-price-api-cases.js';
import { registerCommercialSettlementJourney } from './commercial-settlement-journey.js';
export type CommercialApiFixture = {
  id: string;
  consultationId: string;
  revision: number;
  timelineId: string;
  path: string;
};
type Approved = z.infer<typeof contractResponseSchema>['data'];
export type StepSixApiHarness = {
  database: CatalogTestDatabase;
  post(
    this: void,
    path: string,
    body: object,
    who?: string,
    key?: string | null,
    label?: string,
  ): Promise<Response>;
  get(this: void, path: string, who?: string, label?: string): Promise<Response>;
  expenseMutation(
    this: void,
    method: 'patch' | 'delete',
    path: string,
    body: object,
    who?: string,
    key?: string,
  ): Promise<Response>;
  fixture(this: void, names?: boolean): Promise<CommercialApiFixture>;
  approved(this: void, f: CommercialApiFixture, initial?: Approved): Promise<Approved>;
  paidFixture(this: void, past?: boolean): Promise<{ f: CommercialApiFixture; d: Approved }>;
  race(
    this: void,
    f: CommercialApiFixture,
    commands: readonly (() => Promise<Response>)[],
  ): Promise<Response[]>;
  getLines(this: void): CommercialSelection[];
  accounts: Record<string, string>;
  total: number;
  deposit: number;
};
export function registerStepSixApiCases(harness: StepSixApiHarness) {
  registerContractedPrintPriceApiCases(harness);
  registerCommercialSettlementJourney(harness);
  const {
    database,
    post,
    get,
    expenseMutation,
    fixture,
    approved,
    paidFixture,
    race,
    getLines,
    accounts,
    total,
    deposit,
  } = harness;
  async function appendixDraft(
    f: CommercialApiFixture,
    predecessorRevisionId: string,
    selections = getLines(),
  ) {
    const path = `/bookings/${f.id}/contract-appendices`;
    const state = appendicesResponseSchema.parse((await get(path, 'own')).body as unknown).data;
    let result = await post(
      path,
      {
        expectedRevision: state.bookingRevision,
        predecessorRevisionId,
        reason: 'Điều chỉnh kiểm thử',
        lines: selections,
      },
      'own',
    );
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    let data = appendixResponseSchema.parse(result.body as unknown).data;
    result = await post(
      `${path}/${data.appendix.revisionId}/submissions`,
      { expectedRevision: data.bookingRevision },
      'own',
    );
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    data = appendixResponseSchema.parse(result.body as unknown).data;
    return { path, data };
  }
  it('conceals appendix resources and retains superseded drafts with exact submission state', async () => {
    const { f, d } = await paidFixture();
    const path = `/bookings/${f.id}/contract-appendices`;
    for (const who of ['staff', 'outsider']) expect((await get(path, who)).status).toBe(404);
    expect((await get(`${path}?cursor=${randomUUID()}`, 'own')).status).toBe(404);
    const first = await appendixDraft(f, d.contract.revisionId);
    expect(
      (
        await post(
          `${path}/${randomUUID()}/approvals`,
          { expectedRevision: first.data.bookingRevision },
          'own',
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await post(
          `${path}/${first.data.appendix.revisionId}/submissions`,
          { expectedRevision: first.data.bookingRevision },
          'own',
        )
      ).status,
    ).toBe(409);
    const second = await appendixDraft(f, d.contract.revisionId);
    expect(
      await database.prisma.commercialAppendixRevision.findUniqueOrThrow({
        where: { id: first.data.appendix.revisionId },
      }),
    ).toMatchObject({ state: 'SUPERSEDED' });
    expect(
      (
        await post(
          `${path}/${first.data.appendix.revisionId}/approvals`,
          { expectedRevision: second.data.bookingRevision },
          'own',
        )
      ).status,
    ).toBe(409);
    const page = await get(`${path}?cursor=${second.data.appendix.revisionId}`, 'own');
    expect(page.status).toBe(200);
    expect(appendicesResponseSchema.parse(page.body as unknown).data.revisions).toHaveLength(1);
  }, 45_000);
  it('rechecks Manager authority on cached writes and conceals private financial reads', async () => {
    const { f, d } = await paidFixture(true),
      path = `/management/bookings/${f.id}/incidental-expenses`,
      body = { expectedRevision: 0, name: 'Nước', quantity: 1, unit: 'chai', unitPriceVnd: 10000 },
      key = randomUUID();
    expect((await post(path, body, 'anonymous')).status).toBe(401);
    expect((await post(path, body, 'manager', null)).status).toBe(400);
    const saved = await post(path, body, 'manager', key);
    expect(saved.status).toBe(201);
    for (const who of ['staff', 'outsider']) {
      expect((await get(`/bookings/${f.id}/incidental-expenses`, who)).status).toBe(404);
      expect((await get(`/bookings/${f.id}/final-invoices`, who)).status).toBe(404);
    }
    expect(
      (await get(`/bookings/${f.id}/final-invoices?cursor=${randomUUID()}`, 'own')).status,
    ).toBe(404);
    expect((await get(`/bookings/${f.id}/final-invoices/${randomUUID()}`, 'own')).status).toBe(404);
    await database.prisma.accountRole.delete({
      where: { accountId_role: { accountId: accounts.manager!, role: 'MANAGER' } },
    });
    try {
      expect((await post(path, body, 'manager', key)).status).toBe(403);
    } finally {
      await database.prisma.accountRole.create({
        data: { accountId: accounts.manager!, role: 'MANAGER' },
      });
    }
    expect((await post(path, { ...body, expectedRevision: 1, unitPriceVnd: 0.5 })).status).toBe(
      422,
    );
    const finalize = {
        expectedDraftRevision: 1,
        expectedCommercialRevisionId: d.contract.revisionId,
        expectedBillingRevision: 2,
      },
      invoicePath = `/management/bookings/${f.id}/final-invoices`;
    for (const invalid of [
      { ...finalize, expectedDraftRevision: 0 },
      { ...finalize, expectedCommercialRevisionId: randomUUID() },
      { ...finalize, expectedBillingRevision: 1 },
    ])
      expect((await post(invoicePath, invalid)).status).toBe(409);
    const finalized = await post(invoicePath, finalize);
    expect(finalized.status).toBe(201);
    expect((await post(invoicePath, { ...finalize, expectedDraftRevision: 2 })).status).toBe(409);
    expect((await get(`/bookings/${f.id}/final-invoices`, 'own')).body).toMatchObject({
      data: { revisions: [expect.objectContaining({ sourceBillingRevision: 3 })] },
    });
  }, 45_000);
  it('posts debit and zero-net successors and rejects over-credit or forged invoice payment pins', async () => {
    const { f, d } = await paidFixture(true),
      result = await post(`/management/bookings/${f.id}/final-invoices`, {
        expectedDraftRevision: 0,
        expectedCommercialRevisionId: d.contract.revisionId,
        expectedBillingRevision: 2,
      });
    expect(result.status).toBe(201);
    const root = finalInvoiceResponseSchema.parse(result.body as unknown).data,
      path = `/management/bookings/${f.id}/invoice-adjustments`,
      body = {
        expectedInvoiceRevisionId: root.invoiceRevisionId,
        expectedBillingRevision: 2,
        reason: 'Điều chỉnh đã xác minh',
        lines: [{ name: 'Phụ phí', quantity: 1, unit: 'lần', unitPriceVnd: 10000, kind: 'DEBIT' }],
      };
    expect(
      (
        await post(path, {
          ...body,
          lines: [{ ...body.lines[0], kind: 'CREDIT', unitPriceVnd: total + 1 }],
        })
      ).status,
    ).toBe(409);
    const positive = await post(path, body);
    expect(positive.status, JSON.stringify(positive.body)).toBe(201);
    const debit = finalInvoiceResponseSchema.parse(positive.body as unknown).data;
    expect(debit.document.totalVnd).toBe(total + 10000);
    const zero = await post(path, {
      ...body,
      expectedInvoiceRevisionId: debit.invoiceRevisionId,
      expectedBillingRevision: 3,
      lines: [
        { ...body.lines[0], kind: 'DEBIT' },
        { ...body.lines[0], kind: 'CREDIT' },
      ],
    });
    expect(zero.status, JSON.stringify(zero.body)).toBe(201);
    const current = finalInvoiceResponseSchema.parse(zero.body as unknown).data;
    expect(current.document.totalVnd).toBe(debit.document.totalVnd);
    expect(await database.prisma.billingLedgerEntry.count({ where: { bookingId: f.id } })).toBe(3);
    const now = new Date(),
      attempt = {
        id: randomUUID(),
        commandId: randomUUID(),
        bookingId: f.id,
        purpose: 'BALANCE' as const,
        provider: 'MANUAL' as const,
        amountVnd: 1,
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + 900000),
        invoiceRevisionId: debit.invoiceRevisionId,
        invoiceDigest: debit.documentDigest,
        sourceBillingRevision: 3,
      };
    await expect(database.prisma.billingPaymentAttempt.create({ data: attempt })).rejects.toThrow();
    await expect(
      database.prisma.billingPaymentAttempt.create({
        data: {
          ...attempt,
          id: randomUUID(),
          commandId: randomUUID(),
          invoiceRevisionId: current.invoiceRevisionId,
          invoiceDigest: '0'.repeat(64),
        },
      }),
    ).rejects.toThrow();
    const checkout = await post(
      `/bookings/${f.id}/payments/balance`,
      { expectedBillingRevision: 3 },
      'own',
    );
    expect(checkout.status).toBe(201);
    const attemptId = checkoutResponseSchema.parse(checkout.body as unknown).data.paymentAttemptId;
    expect(
      await database.prisma.billingPaymentAttempt.findUniqueOrThrow({ where: { id: attemptId } }),
    ).toMatchObject({
      invoiceRevisionId: current.invoiceRevisionId,
      invoiceDigest: current.documentDigest,
      sourceBillingRevision: 3,
    });
    const failed = await get(
      '/billing/callbacks/vnpay?' +
        ipnFixture(attemptId, {
          vnp_Amount: String((total + 10000 - deposit) * 100),
          vnp_ResponseCode: '24',
          vnp_TransactionStatus: '02',
        }),
      'anonymous',
    );
    expect(failed.body).toMatchObject({ RspCode: '00' });
    const released = await post(path, {
      ...body,
      expectedInvoiceRevisionId: current.invoiceRevisionId,
      expectedBillingRevision: 3,
    });
    expect(released.status, JSON.stringify(released.body)).toBe(201);
  }, 45_000);
  it('serializes expense edits, same-source finalization and adjustment-versus-payment races', async () => {
    const { f, d } = await paidFixture(true),
      expensePath = `/management/bookings/${f.id}/incidental-expenses`;
    const created = await post(expensePath, {
      expectedRevision: 0,
      name: 'Nước thêm',
      quantity: 1,
      unit: 'chai',
      unitPriceVnd: 10000,
    });
    expect(created.status).toBe(201);
    const line = expenseDraftResponseSchema.parse(created.body as unknown).data.lines[0]!;
    const updates = await race(f, [
      () =>
        expenseMutation('patch', expensePath + '/' + line.id, { expectedRevision: 1, quantity: 2 }),
      () =>
        expenseMutation('patch', expensePath + '/' + line.id, { expectedRevision: 1, quantity: 3 }),
    ]);
    expect(updates.map((r) => r.status).sort()).toEqual([200, 409]);
    const draft = expenseDraftResponseSchema.parse(
      (await get(`/bookings/${f.id}/incidental-expenses`, 'own')).body as unknown,
    ).data;
    expect(draft.revision).toBe(2);
    const finalize = {
        expectedDraftRevision: draft.revision,
        expectedCommercialRevisionId: d.contract.revisionId,
        expectedBillingRevision: 2,
      },
      path = `/management/bookings/${f.id}/final-invoices`;
    const invoices = await race(f, [() => post(path, finalize), () => post(path, finalize)]);
    expect(invoices.map((r) => r.status)).toEqual([201, 201]);
    expect(invoices[0]!.body).toEqual(invoices[1]!.body);
    const invoice = finalInvoiceResponseSchema.parse(invoices[0]!.body as unknown).data;
    expect(await database.prisma.finalInvoiceRevision.count({ where: { bookingId: f.id } })).toBe(
      1,
    );
    expect(
      await database.prisma.billingLedgerEntry.count({
        where: { bookingId: f.id, sourceType: 'INCIDENTAL_FINALIZATION' },
      }),
    ).toBe(1);
    const concurrent = await race(f, [
      () =>
        post(`/management/bookings/${f.id}/invoice-adjustments`, {
          expectedInvoiceRevisionId: invoice.invoiceRevisionId,
          expectedBillingRevision: 3,
          reason: 'Phát sinh đã xác minh',
          lines: [{ name: 'Phụ phí', quantity: 1, unit: 'lần', unitPriceVnd: 5000, kind: 'DEBIT' }],
        }),
      () => post(`/bookings/${f.id}/payments/balance`, { expectedBillingRevision: 3 }, 'own'),
    ]);
    expect(concurrent.map((r) => r.status).sort()).toEqual([201, 409]);
    const history = await get(`/bookings/${f.id}/final-invoices`, 'own');
    expect(history.status).toBe(200);
    const current = await database.prisma.finalInvoiceHead.findUniqueOrThrow({
      where: { bookingId: f.id },
    });
    const attempts = await database.prisma.billingPaymentAttempt.findMany({
      where: { bookingId: f.id, purpose: 'BALANCE' },
    });
    expect(attempts.length).toBe(current.currentRevisionId === invoice.invoiceRevisionId ? 1 : 0);
    if (attempts[0])
      expect(attempts[0]).toMatchObject({
        invoiceRevisionId: invoice.invoiceRevisionId,
        sourceBillingRevision: 3,
      });
  }, 45_000);
  it('rolls back second appendix approval and finalization if ledger/outbox posting fails', async () => {
    const { f, d } = await paidFixture(true),
      selections = getLines().map((l, i) => (i === 0 ? { ...l, quantity: l.quantity + 1 } : l));
    const { path, data: initial } = await appendixDraft(f, d.contract.revisionId, selections);
    let data = initial;
    const first = await post(`${path}/${data.appendix.revisionId}/approvals`, {
      expectedRevision: data.bookingRevision,
    });
    expect(first.status).toBe(200);
    data = appendixResponseSchema.parse(first.body as unknown).data;
    async function inject(operation: () => Promise<Response>) {
      // Disposable-database fault after owner writes, never a production migration.
      await database.prisma.$executeRawUnsafe(
        `ALTER TABLE "BillingOutboxEvent" ADD CONSTRAINT step6_fault CHECK ("aggregateId" <> '${f.id}'::uuid) NOT VALID`,
      );
      try {
        expect((await operation()).status).toBe(500);
      } finally {
        await database.prisma.$executeRawUnsafe(
          'ALTER TABLE "BillingOutboxEvent" DROP CONSTRAINT step6_fault',
        );
      }
    }
    const approvalPath = `${path}/${data.appendix.revisionId}/approvals`,
      approval = { expectedRevision: data.bookingRevision };
    await inject(() => post(approvalPath, approval, 'own'));
    const rolledBack = await database.prisma.commercialAppendixRevision.findUniqueOrThrow({
      where: { id: data.appendix.revisionId },
      include: { approvals: true },
    });
    expect(rolledBack.state).toBe('AWAITING_APPROVAL');
    expect(rolledBack.approvals).toHaveLength(1);
    expect(await database.prisma.billingLedgerEntry.count({ where: { bookingId: f.id } })).toBe(2);
    const approved = await post(approvalPath, approval, 'own');
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    data = appendixResponseSchema.parse(approved.body as unknown).data;
    const expense = await post(`/management/bookings/${f.id}/incidental-expenses`, {
      expectedRevision: 0,
      name: 'Nước',
      quantity: 1,
      unit: 'chai',
      unitPriceVnd: 10000,
    });
    expect(expense.status).toBe(201);
    const finalize = {
        expectedDraftRevision: 1,
        expectedCommercialRevisionId: data.appendix.revisionId,
        expectedBillingRevision: 3,
      },
      invoicePath = `/management/bookings/${f.id}/final-invoices`;
    await inject(() => post(invoicePath, finalize));
    expect(await database.prisma.finalInvoiceRevision.count({ where: { bookingId: f.id } })).toBe(
      0,
    );
    expect(await database.prisma.finalInvoiceHead.count({ where: { bookingId: f.id } })).toBe(0);
    expect(await database.prisma.billingLedgerEntry.count({ where: { bookingId: f.id } })).toBe(3);
    const result = await post(invoicePath, finalize);
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    const invoice = finalInvoiceResponseSchema.parse(result.body as unknown).data;
    expect(invoice.document.appendices.map((a) => a.revisionId)).toEqual([
      data.appendix.revisionId,
    ]);
    expect(invoice.document.totalVnd).toBe(total + 3500000 + 10000);
    expect(invoice.document.contract.document).toEqual(d.contract.document);
  }, 45_000);
  it('serializes zero-delta appendix approval without adding a receivable or reusing an approval party', async () => {
    const { f, d } = await paidFixture();
    const { path, data } = await appendixDraft(f, d.contract.revisionId);
    const approvalPath = `${path}/${data.appendix.revisionId}/approvals`;
    const results = await race(f, [
      () => post(approvalPath, { expectedRevision: data.bookingRevision }),
      () => post(approvalPath, { expectedRevision: data.bookingRevision }, 'own'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const first = appendixResponseSchema.parse(
      results.find((r) => r.status === 200)!.body as unknown,
    ).data;
    const same = first.appendix.approvals[0]!.party === 'MANAGER' ? 'manager' : 'own',
      other = same === 'manager' ? 'own' : 'manager';
    expect(
      (await post(approvalPath, { expectedRevision: first.bookingRevision }, same)).status,
    ).toBe(409);
    expect(
      (await post(approvalPath, { expectedRevision: first.bookingRevision }, other)).status,
    ).toBe(200);
    expect(await database.prisma.billingLedgerEntry.count({ where: { bookingId: f.id } })).toBe(2);
    expect(
      appendicesResponseSchema.parse((await get(path, 'own')).body as unknown).data
        .effectiveRevisionId,
    ).toBe(data.appendix.revisionId);
  }, 45_000);
  it('enforces authoritative event end and Manager expense authority without accepting client totals', async () => {
    const { f } = await paidFixture(),
      path = `/management/bookings/${f.id}/incidental-expenses`;
    const body = {
      expectedRevision: 0,
      name: 'Bia thêm',
      quantity: 2,
      unit: 'thùng',
      unitPriceVnd: 350000,
    };
    expect((await post(path, body, 'own')).status).toBe(403);
    expect((await post(path, body, 'staff')).status).toBe(403);
    expect((await post(path, { ...body, totalVnd: 1 })).status).toBe(422);
    const result = await post(path, body);
    expect(result.status, JSON.stringify(result.body)).toBe(409);
    expect(result.body).toMatchObject({ error: { code: 'EVENT_NOT_ENDED' } });
    expect((await get(`/bookings/${f.id}/incidental-expenses`, 'own')).status).toBe(200);
    expect(await database.prisma.incidentalExpenseLine.count({ where: { bookingId: f.id } })).toBe(
      0,
    );
  }, 30_000);
  it('manages draft expenses, finalizes itemized sources once, freezes them and appends signed invoice successors', async () => {
    const { f, d } = await paidFixture(true),
      path = `/management/bookings/${f.id}/incidental-expenses`;
    const body = {
        expectedRevision: 0,
        name: 'Bia thêm',
        quantity: 2,
        unit: 'thùng',
        unitPriceVnd: 350000,
        note: 'Cuối tiệc',
      },
      key = randomUUID();
    const created = await post(path, body, 'manager', key);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect((await post(path, body, 'manager', key)).body).toEqual(created.body);
    expect((await post(path, { ...body, quantity: 3 }, 'manager', key)).status).toBe(422);
    let draft = expenseDraftResponseSchema.parse(created.body as unknown).data;
    expect(draft.totalVnd).toBe(700000);
    const lineId = draft.lines[0]!.id;
    const updated = await expenseMutation('patch', path + '/' + lineId, {
      expectedRevision: draft.revision,
      quantity: 3,
    });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    draft = expenseDraftResponseSchema.parse(updated.body as unknown).data;
    expect(draft.totalVnd).toBe(1050000);
    expect(
      (await expenseMutation('patch', path + '/' + lineId, { expectedRevision: 0, quantity: 4 }))
        .status,
    ).toBe(409);
    expect(
      (
        await expenseMutation('patch', path + '/' + randomUUID(), {
          expectedRevision: draft.revision,
          quantity: 4,
        })
      ).status,
    ).toBe(404);
    const extra = await post(path, { ...body, expectedRevision: draft.revision, unitPriceVnd: 0 });
    expect(extra.status).toBe(201);
    draft = expenseDraftResponseSchema.parse(extra.body as unknown).data;
    const removed = await expenseMutation(
      'delete',
      path + '/' + draft.lines.find((l) => l.id !== lineId)!.id,
      { expectedRevision: draft.revision },
    );
    expect(removed.status).toBe(200);
    draft = expenseDraftResponseSchema.parse(removed.body as unknown).data;
    expect(await database.prisma.billingLedgerEntry.count({ where: { bookingId: f.id } })).toBe(2);
    const finalizePath = `/management/bookings/${f.id}/final-invoices`,
      finalize = {
        expectedDraftRevision: draft.revision,
        expectedCommercialRevisionId: d.contract.revisionId,
        expectedBillingRevision: 2,
      };
    expect((await post(finalizePath, finalize, 'own')).status).toBe(403);
    const invoice = await post(finalizePath, finalize);
    expect(invoice.status, JSON.stringify(invoice.body)).toBe(201);
    const initial = finalInvoiceResponseSchema.parse(invoice.body as unknown).data;
    expect(initial.document.totalVnd).toBe(total + 1050000);
    expect((await post(finalizePath, finalize)).body).toEqual(invoice.body);
    expect(await database.prisma.billingLedgerEntry.count({ where: { bookingId: f.id } })).toBe(3);
    expect((await post(path, { ...body, expectedRevision: draft.revision })).status).toBe(409);
    expect(
      (await get(`/bookings/${f.id}/final-invoices/${initial.invoiceRevisionId}`, 'own')).body,
    ).toEqual(invoice.body);
    const correction = await post(`/management/bookings/${f.id}/invoice-adjustments`, {
      expectedInvoiceRevisionId: initial.invoiceRevisionId,
      expectedBillingRevision: 3,
      reason: 'Giảm chi phí bia',
      lines: [
        { name: 'Hoàn giá bia', quantity: 1, unit: 'thùng', unitPriceVnd: 350000, kind: 'CREDIT' },
      ],
    });
    expect(correction.status, JSON.stringify(correction.body)).toBe(201);
    const adjusted = finalInvoiceResponseSchema.parse(correction.body as unknown).data;
    expect(adjusted.document.totalVnd).toBe(total + 700000);
    expect(
      billingResponseSchema.parse((await get(`/bookings/${f.id}/billing`, 'own')).body as unknown)
        .data.totals.acceptedChargesVnd,
    ).toBe(total + 700000);
    expect(adjusted.predecessorRevisionId).toBe(initial.invoiceRevisionId);
    expect(
      (await get(`/bookings/${f.id}/final-invoices/${initial.invoiceRevisionId}`, 'own')).body,
    ).toEqual(invoice.body);
    expect((await database.prisma.booking.findUniqueOrThrow({ where: { id: f.id } })).phase).toBe(
      'CONFIRMED',
    );
    await expect(
      database.prisma.finalInvoiceRevision.update({
        where: { id: initial.invoiceRevisionId },
        data: { totalVnd: 1 },
      }),
    ).rejects.toThrow();
  }, 30_000);
  it('requires finalization before a full-contract balance payment', async () => {
    const { f } = await paidFixture(true);
    const billingPath = `/bookings/${f.id}/billing`;
    for (const who of ['own', 'manager']) {
      const read = await get(billingPath, who);
      expect(read.status, JSON.stringify(read.body)).toBe(200);
      expect(
        billingResponseSchema.parse(read.body as unknown).data.balancePaymentEligibility,
      ).toEqual({
        canPay: false,
        reasonCode: 'INVOICE_FINALIZATION_REQUIRED',
        nextAction: 'WAIT_FOR_FINAL_INVOICE',
        billingRevision: 2,
      });
    }
    for (const [who, status] of [
      ['staff', 404],
      ['outsider', 404],
      ['anonymous', 401],
    ] as const)
      expect((await get(billingPath, who)).status).toBe(status);
    expect(await database.prisma.finalInvoiceRevision.count({ where: { bookingId: f.id } })).toBe(
      0,
    );
    expect(await database.prisma.billingPaymentAttempt.count({ where: { bookingId: f.id } })).toBe(
      1,
    );
    const checkout = await post(
      `/bookings/${f.id}/payments/balance`,
      { expectedBillingRevision: 2 },
      'own',
    );
    expect(checkout.status).toBe(409);
    expect(checkout.body).toMatchObject({ error: { code: 'INVOICE_FINALIZATION_REQUIRED' } });
    const result = await post('/management/billing/payments/manual', {
      bookingId: f.id,
      purpose: 'BALANCE',
      amountVnd: 1,
      settledAt: new Date().toISOString(),
      reason: 'Thanh toán số dư',
      evidenceReference: 'LOCAL-BALANCE',
    });
    expect(result.status, JSON.stringify(result.body)).toBe(409);
    expect(result.body).toMatchObject({ error: { code: 'INVOICE_FINALIZATION_REQUIRED' } });
  }, 30_000);
  it('pins zero-expense final invoices, reconciles UNKNOWN balances and keeps credits separate from manual refunds', async () => {
    const { f, d } = await paidFixture(true);
    const finalized = await post(`/management/bookings/${f.id}/final-invoices`, {
      expectedDraftRevision: 0,
      expectedCommercialRevisionId: d.contract.revisionId,
      expectedBillingRevision: 2,
    });
    expect(finalized.status, JSON.stringify(finalized.body)).toBe(201);
    let invoice = finalInvoiceResponseSchema.parse(finalized.body as unknown).data;
    expect(invoice.document.incidentalLines).toEqual([]);
    expect(await database.prisma.billingLedgerEntry.count({ where: { bookingId: f.id } })).toBe(2);
    expect(
      billingResponseSchema.parse((await get(`/bookings/${f.id}/billing`, 'own')).body as unknown)
        .data.balancePaymentEligibility,
    ).toEqual({
      canPay: true,
      reasonCode: null,
      nextAction: 'PAY_BALANCE',
      billingRevision: 2,
    });
    expect(
      billingResponseSchema.parse(
        (await get(`/bookings/${f.id}/billing?throughBillingRevision=1`, 'own')).body as unknown,
      ).data.balancePaymentEligibility,
    ).toMatchObject({
      canPay: false,
      reasonCode: 'STALE_BILLING_REVISION',
      nextAction: 'REFRESH_BILLING',
      billingRevision: 2,
    });
    const manual = await post('/management/billing/payments/manual', {
      bookingId: f.id,
      purpose: 'BALANCE',
      amountVnd: 100000,
      settledAt: new Date().toISOString(),
      reason: 'Thanh toán một phần',
      evidenceReference: 'LOCAL-MANUAL',
    });
    expect(manual.status, JSON.stringify(manual.body)).toBe(201);
    const manualId = (manual.body as { data: { paymentAttemptId: string } }).data.paymentAttemptId;
    expect(
      await database.prisma.billingPaymentAttempt.findUniqueOrThrow({ where: { id: manualId } }),
    ).toMatchObject({
      invoiceRevisionId: invoice.invoiceRevisionId,
      invoiceDigest: invoice.documentDigest,
      sourceBillingRevision: 2,
    });
    const checkout = await post(
      `/bookings/${f.id}/payments/balance`,
      { expectedBillingRevision: 3 },
      'own',
    );
    expect(checkout.status, JSON.stringify(checkout.body)).toBe(201);
    const attempt = checkoutResponseSchema.parse(checkout.body as unknown).data;
    expect(
      billingResponseSchema.parse((await get(`/bookings/${f.id}/billing`, 'own')).body as unknown)
        .data.balancePaymentEligibility,
    ).toMatchObject({
      canPay: false,
      reasonCode: 'PAYMENT_ATTEMPT_ACTIVE',
      nextAction: 'CHECK_EXISTING_PAYMENT',
    });
    const due = total - deposit - 100000;
    expect(new URL(attempt.checkoutUrl).searchParams.get('vnp_Amount')).toBe(String(due * 100));
    expect(
      attemptResponseSchema.parse(
        (await get(`/bookings/${f.id}/payments/${attempt.paymentAttemptId}`, 'own'))
          .body as unknown,
      ).data,
    ).toMatchObject({
      status: 'UNKNOWN',
      invoiceRevisionId: invoice.invoiceRevisionId,
      invoiceDigest: invoice.documentDigest,
      sourceBillingRevision: 3,
    });
    const adjustmentPath = `/management/bookings/${f.id}/invoice-adjustments`,
      adjustment = {
        expectedInvoiceRevisionId: invoice.invoiceRevisionId,
        expectedBillingRevision: 3,
        reason: 'Giảm sau đối soát',
        lines: [
          { name: 'Giảm giá', quantity: 1, unit: 'lần', unitPriceVnd: 100000, kind: 'CREDIT' },
        ],
      };
    expect((await post(adjustmentPath, adjustment)).status).toBe(409);
    const callback =
      '/billing/callbacks/vnpay?' +
      ipnFixture(attempt.paymentAttemptId, {
        vnp_Amount: String(due * 100),
        vnp_PayDate: '20261011100000',
      });
    expect((await get(callback, 'anonymous')).body).toMatchObject({ RspCode: '00' });
    expect((await get(callback, 'anonymous')).body).toMatchObject({ RspCode: '02' });
    const credit = await post(adjustmentPath, { ...adjustment, expectedBillingRevision: 4 });
    expect(credit.status, JSON.stringify(credit.body)).toBe(201);
    invoice = finalInvoiceResponseSchema.parse(credit.body as unknown).data;
    expect(invoice.document.totalVnd).toBe(total - 100000);
    const bill = billingResponseSchema.parse(
      (await get(`/bookings/${f.id}/billing`, 'own')).body as unknown,
    ).data;
    expect(bill.totals).toMatchObject({
      paidVnd: total,
      refundedVnd: 0,
      outstandingVnd: 0,
      creditVnd: 100000,
    });
    expect(bill.balancePaymentEligibility).toMatchObject({
      canPay: false,
      reasonCode: 'BILLING_BALANCE_LIMIT_EXCEEDED',
      nextAction: 'NONE',
    });
    const basis = bill.history.find((e) => e.sourceType === 'INVOICE_ADJUSTMENT')!;
    const approval = await post('/management/billing/refund-approvals', {
      bookingId: f.id,
      expectedBillingRevision: 5,
      approvedRefundableVnd: 100000,
      basis: { kind: 'CREDIT', sourceEntryId: basis.ledgerEntryId },
      reason: 'Hoàn phần dư',
      evidenceReference: 'LOCAL-APPROVAL',
    });
    expect(approval.status, JSON.stringify(approval.body)).toBe(201);
    const refundBody = {
        sourcePaymentId: bill.history.find((e) => e.paymentAttemptId === attempt.paymentAttemptId)!
          .ledgerEntryId,
        amountVnd: 100000,
        expectedBillingRevision: 5,
        reason: 'Đã hoàn thủ công',
        evidenceReference: 'LOCAL-REFUND',
      },
      refundKey = randomUUID();
    const refund = await post('/management/billing/refunds', refundBody, 'manager', refundKey);
    expect(refund.status, JSON.stringify(refund.body)).toBe(201);
    expect(
      (await post('/management/billing/refunds', refundBody, 'manager', refundKey)).body,
    ).toEqual(refund.body);
    expect(
      billingResponseSchema.parse((await get(`/bookings/${f.id}/billing`, 'own')).body as unknown)
        .data.totals,
    ).toMatchObject({
      paidVnd: total,
      refundedVnd: 100000,
      netPaidVnd: total - 100000,
      outstandingVnd: 0,
      creditVnd: 0,
    });
  }, 45_000);
  it('fulfills contracted print without a second charge and refuses changed price or over-allocation', async () => {
    const f = await fixture();
    const sharedPrint = getLines().find((l) => l.category === 'PRINT')!;
    const sharedOffering = await database.prisma.printOfferingRevision.findUniqueOrThrow({
      where: { id: sharedPrint.sourceRevisionId },
    });
    const template = await database.prisma.invitationTemplateVersion.findUniqueOrThrow({
      where: { id: sharedOffering.templateVersionId },
    });
    const templateId = randomUUID(),
      templateVersionId = randomUUID();
    await database.prisma.$transaction(async (tx) => {
      await tx.invitationTemplateVersion.create({
        data: {
          id: templateVersionId,
          templateId,
          revision: 1,
          content: designContentSchema.parse(template.content),
        },
      });
      await tx.invitationTemplate.create({
        data: { id: templateId, revision: 1, currentVersionId: templateVersionId, active: true },
      });
    });
    const createdOffering = await post('/management/print-offerings', {
      templateId,
      templateVersionId,
      name: sharedOffering.name,
      printType: sharedOffering.printType,
      material: sharedOffering.material,
      unitPriceVnd: 5000,
      active: true,
    });
    expect(createdOffering.status).toBe(201);
    const selectedOffering = printOfferingViewSchema.parse(
      (createdOffering.body as { data: unknown }).data,
    );
    const lines = getLines().map((l) =>
      l.category === 'PRINT'
        ? {
            ...l,
            sourceId: selectedOffering.offeringId,
            sourceRevisionId: selectedOffering.sourceRevisionId,
          }
        : l,
    );
    const drafted = await post(
      f.path,
      {
        expectedRevision: f.revision,
        predecessorRevisionId: null,
        timelineRevisionId: f.timelineId,
        lines,
      },
      'own',
    );
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);
    const d = await approved(f, parseContractResponse.parse(drafted.body as unknown).data);
    expect(
      (
        await post('/management/billing/payments/manual', {
          bookingId: f.id,
          purpose: 'DEPOSIT',
          contractRevisionId: d.contract.revisionId,
          documentDigest: d.contract.documentDigest,
          amountVnd: deposit,
          settledAt: new Date().toISOString(),
          reason: 'Cọc kiểm thử in',
          evidenceReference: 'LOCAL-PRINT',
        })
      ).status,
    ).toBe(201);
    const print = lines.find((l) => l.category === 'PRINT')!;
    const offering = await database.prisma.printOfferingRevision.findUniqueOrThrow({
      where: { id: print.sourceRevisionId },
    });
    const designed = await post(
      `/bookings/${f.id}/invitations`,
      { templateId: offering.templateId },
      'own',
    );
    expect(designed.status, JSON.stringify(designed.body)).toBe(201);
    const design = designResponse.parse(designed.body as unknown).data;
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
    const body = {
      lines: [
        {
          designId: design.designId,
          quantity: 60,
          commercialSource: {
            agreementRevisionId: d.contract.revisionId,
            offeringId: print.sourceId,
            sourceRevisionId: print.sourceRevisionId,
          },
        },
      ],
    };
    const requested = await post(`/bookings/${f.id}/print-orders`, body, 'own');
    expect(requested.status, JSON.stringify(requested.body)).toBe(201);
    let order = printOrderResponseSchema.parse(requested.body as unknown).data;
    const quotePath = `/management/print-orders/${order.orderId}/quotations`;
    const quote = {
      expectedRevision: order.revision,
      lines: [{ lineId: order.lines[0]!.lineId, unitPriceVnd: 5000 }],
      estimatedHandoverAt: new Date(Date.now() + 86400000).toISOString(),
    };
    expect(
      (await post(quotePath, { ...quote, lines: [{ ...quote.lines[0]!, unitPriceVnd: 1 }] }))
        .status,
    ).toBe(409);
    const quoted = await post(quotePath, quote);
    expect(quoted.status, JSON.stringify(quoted.body)).toBe(200);
    order = printOrderResponseSchema.parse(quoted.body as unknown).data;
    const approvedOrder = await post(
      `/bookings/${f.id}/print-orders/${order.orderId}/approval`,
      { expectedRevision: order.revision, commercialRevisionId: order.currentCommercialRevisionId },
      'own',
    );
    expect(approvedOrder.status, JSON.stringify(approvedOrder.body)).toBe(200);
    order = printOrderResponseSchema.parse(approvedOrder.body as unknown).data;
    const replacement = await post(
      `/management/print-orders/${order.orderId}/replacement-proposals`,
      { ...quote, expectedRevision: order.revision },
    );
    expect(replacement.status).toBe(409);
    expect(replacement.body).toMatchObject({
      error: { code: 'CONTRACT_PRINT_REPLACEMENT_REQUIRES_NEW_ORDER' },
    });
    const batchRequested = await post(
      `/bookings/${f.id}/print-orders`,
      { lines: [{ ...body.lines[0]!, quantity: 10 }] },
      'own',
    );
    expect(batchRequested.status).toBe(201);
    let batch = printOrderResponseSchema.parse(batchRequested.body as unknown).data;
    const batchQuoted = await post(`/management/print-orders/${batch.orderId}/quotations`, {
      ...quote,
      expectedRevision: batch.revision,
      lines: [{ lineId: batch.lines[0]!.lineId, unitPriceVnd: 5000 }],
    });
    expect(batchQuoted.status).toBe(200);
    batch = printOrderResponseSchema.parse(batchQuoted.body as unknown).data;
    const batchApproved = await post(
      `/bookings/${f.id}/print-orders/${batch.orderId}/approval`,
      { expectedRevision: batch.revision, commercialRevisionId: batch.currentCommercialRevisionId },
      'own',
    );
    expect(batchApproved.status).toBe(200);
    batch = printOrderResponseSchema.parse(batchApproved.body as unknown).data;
    const cancelledBody = { expectedRevision: batch.revision, reason: 'Hủy lô chưa sản xuất' };
    expect(
      (
        await post(
          `/bookings/${f.id}/print-orders/${batch.orderId}/cancellation-intents`,
          cancelledBody,
          'own',
        )
      ).status,
    ).toBe(200);
    const cancelled = await post(
      `/management/print-orders/${batch.orderId}/cancellation`,
      cancelledBody,
    );
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(
      await database.prisma.billingLedgerEntry.count({
        where: { bookingId: f.id, kind: 'CREDIT_ADJUSTMENT' },
      }),
    ).toBe(0);
    expect(order.lines[0]!.commercialSource).toMatchObject({
      material: offering.material,
      templateVersionId: offering.templateVersionId,
    });
    expect(await database.prisma.billingLedgerEntry.count({ where: { bookingId: f.id } })).toBe(2);
    const excess = await post(
      `/bookings/${f.id}/print-orders`,
      { lines: [{ ...body.lines[0]!, quantity: 41 }] },
      'own',
    );
    expect(excess.status).toBe(201);
    const other = printOrderResponseSchema.parse(excess.body as unknown).data;
    expect(
      (
        await post(`/management/print-orders/${other.orderId}/quotations`, {
          ...quote,
          expectedRevision: other.revision,
          lines: [{ lineId: other.lines[0]!.lineId, unitPriceVnd: 5000 }],
        })
      ).status,
    ).toBe(409);
    const started = await post(`/management/print-orders/${order.orderId}/production`, {
      expectedRevision: order.revision,
    });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    const reduced = lines.map((l) => (l.category === 'PRINT' ? { ...l, quantity: 59 } : l));
    const proposed = await appendixDraft(f, d.contract.revisionId, reduced);
    const managerApproval = await post(
      `${proposed.path}/${proposed.data.appendix.revisionId}/approvals`,
      { expectedRevision: proposed.data.bookingRevision },
    );
    expect(managerApproval.status).toBe(200);
    const first = appendixResponseSchema.parse(managerApproval.body as unknown).data;
    const blocked = await post(
      `${proposed.path}/${first.appendix.revisionId}/approvals`,
      { expectedRevision: first.bookingRevision },
      'own',
    );
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(409);
    expect(blocked.body).toMatchObject({ error: { code: 'CONTRACT_PRINT_QUANTITY_ALLOCATED' } });
    const revisedOffering = await expenseMutation(
      'patch',
      `/management/print-offerings/${offering.offeringId}`,
      {
        expectedRevision: 1,
        templateId: offering.templateId,
        templateVersionId: offering.templateVersionId,
        name: offering.name,
        material: 'Giấy mới cho lô chưa được phân bổ',
        printType: offering.printType,
        unitPriceVnd: 6000,
        active: true,
      },
    );
    expect(revisedOffering.status, JSON.stringify(revisedOffering.body)).toBe(200);
    const successorOffering = printOfferingViewSchema.parse(
      (revisedOffering.body as { data: unknown }).data,
    );
    const changedSource = await appendixDraft(
      f,
      d.contract.revisionId,
      lines.map((l) =>
        l.category === 'PRINT' ? { ...l, sourceRevisionId: successorOffering.sourceRevisionId } : l,
      ),
    );
    const sourceFirstApproval = await post(
      `${changedSource.path}/${changedSource.data.appendix.revisionId}/approvals`,
      { expectedRevision: changedSource.data.bookingRevision },
    );
    expect(sourceFirstApproval.status).toBe(200);
    const sourceFirst = appendixResponseSchema.parse(sourceFirstApproval.body as unknown).data;
    async function rejectAllocatedSource() {
      const response = await post(
        `${changedSource.path}/${sourceFirst.appendix.revisionId}/approvals`,
        { expectedRevision: sourceFirst.bookingRevision },
        'own',
      );
      expect(response.status, JSON.stringify(response.body)).toBe(409);
      expect(response.body).toMatchObject({ error: { code: 'CONTRACT_PRINT_SOURCE_ALLOCATED' } });
      expect(
        await database.prisma.commercialAppendixRevision.findUniqueOrThrow({
          where: { id: sourceFirst.appendix.revisionId },
          include: { approvals: true },
        }),
      ).toMatchObject({ state: 'AWAITING_APPROVAL', approvals: [{ party: 'MANAGER' }] });
      expect(await database.prisma.billingLedgerEntry.count({ where: { bookingId: f.id } })).toBe(
        2,
      );
    }
    await rejectAllocatedSource();
    await expect(
      database.prisma
        .$executeRaw`UPDATE "CommercialAppendixRevision" SET "state"='APPROVED', "approvedAt"=CURRENT_TIMESTAMP WHERE "id"=${sourceFirst.appendix.revisionId}::uuid`,
    ).rejects.toThrow('appendix cannot replace allocated print commercial sources');
    let produced = printOrderResponseSchema.parse(started.body as unknown).data;
    const ready = await post(`/management/print-orders/${order.orderId}/ready`, {
      expectedRevision: produced.revision,
    });
    expect(ready.status, JSON.stringify(ready.body)).toBe(200);
    produced = printOrderResponseSchema.parse(ready.body as unknown).data;
    await rejectAllocatedSource();
    const handedOver = await post(`/management/print-orders/${order.orderId}/handover`, {
      expectedRevision: produced.revision,
      evidenceReference: 'LOCAL-ALLOCATED-PRINT-HANDOVER',
    });
    expect(handedOver.status, JSON.stringify(handedOver.body)).toBe(200);
    await rejectAllocatedSource();
    expect(
      printOrderResponseSchema.parse(handedOver.body as unknown).data.lines[0]!.commercialSource,
    ).toEqual(order.lines[0]!.commercialSource);
    // Archive through a new catalog version; the contracted version stays immutable.
    const retainedTemplate = await database.prisma.invitationTemplateVersion.findUniqueOrThrow({
      where: { id: offering.templateVersionId },
    });
    async function advanceTemplate(active: boolean) {
      await database.prisma.$transaction(async (tx) => {
        const head = await tx.invitationTemplate.findUniqueOrThrow({
          where: { id: offering.templateId },
        });
        const id = randomUUID();
        await tx.invitationTemplateVersion.create({
          data: {
            id,
            templateId: head.id,
            revision: head.revision + 1,
            content: designContentSchema.parse(retainedTemplate.content),
          },
        });
        await tx.invitationTemplate.update({
          where: { id: head.id },
          data: { active, revision: head.revision + 1, currentVersionId: id },
        });
      });
    }
    await advanceTemplate(false);
    try {
      const retained = await post(
        `/bookings/${f.id}/invitations`,
        { templateId: offering.templateId, templateVersionId: offering.templateVersionId },
        'own',
      );
      expect(retained.status, JSON.stringify(retained.body)).toBe(201);
      const retainedDesign = designResponse.parse(retained.body as unknown).data;
      expect(
        await database.prisma.invitationDesignRevision.findUniqueOrThrow({
          where: { id: retainedDesign.revisionId },
        }),
      ).toMatchObject({ sourceTemplateVersionId: offering.templateVersionId });
    } finally {
      await advanceTemplate(true);
    }
    const bill = await get(`/bookings/${f.id}/billing`, 'own');
    expect(bill.status).toBe(200);
    expect(billingResponseSchema.parse(bill.body as unknown).data.totals.acceptedChargesVnd).toBe(
      total,
    );
  }, 45_000);
  it('applies an appendix only on the second distinct approval and retains the original deposit and history', async () => {
    const f = await fixture(),
      d = await approved(f);
    const paid = await post('/management/billing/payments/manual', {
      bookingId: f.id,
      purpose: 'DEPOSIT',
      contractRevisionId: d.contract.revisionId,
      documentDigest: d.contract.documentDigest,
      amountVnd: deposit,
      settledAt: new Date().toISOString(),
      reason: 'Cọc kiểm thử phụ lục',
      evidenceReference: 'LOCAL-STEP6',
    });
    expect(paid.status).toBe(201);
    const path = `/bookings/${f.id}/contract-appendices`;
    let state = appendicesResponseSchema.parse((await get(path, 'own')).body as unknown).data;
    const body = {
      expectedRevision: state.bookingRevision,
      predecessorRevisionId: d.contract.revisionId,
      reason: 'Giảm một bàn menu',
      lines: getLines().map((l, i) => (i === 0 ? { ...l, quantity: l.quantity - 1 } : l)),
    };
    expect((await post(path, body, 'staff')).status).toBe(404);
    expect((await post(path, { ...body, deltaVnd: -1 }, 'own')).status).toBe(422);
    const created = await post(path, body, 'own');
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    let a = appendixResponseSchema.parse(created.body as unknown).data;
    expect(a.appendix.document.deltaVnd).toBe(-3_500_000);
    for (const [action, who] of [
      ['submissions', 'own'],
      ['approvals', 'manager'],
    ] as const) {
      const r = await post(
        `${path}/${a.appendix.revisionId}/${action}`,
        { expectedRevision: a.bookingRevision },
        who,
      );
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      a = appendixResponseSchema.parse(r.body as unknown).data;
    }
    state = appendicesResponseSchema.parse((await get(path, 'own')).body as unknown).data;
    expect(state.effectiveTotalVnd).toBe(total);
    const route = `${path}/${a.appendix.revisionId}/approvals`,
      approval = { expectedRevision: a.bookingRevision },
      key = randomUUID();
    const applied = await post(route, approval, 'own', key);
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    expect((await post(route, approval, 'own', key)).body).toEqual(applied.body);
    state = appendicesResponseSchema.parse((await get(path, 'own')).body as unknown).data;
    expect(state.effectiveTotalVnd).toBe(total - 3_500_000);
    const entries = await database.prisma.billingLedgerEntry.findMany({
      where: { bookingId: f.id },
    });
    expect(entries).toHaveLength(3);
    expect(entries.find((e) => e.sourceType === 'CONTRACT_APPENDIX')).toMatchObject({
      kind: 'CREDIT_ADJUSTMENT',
    });
    expect(
      (
        await database.prisma.bookingDepositSettlement.findUniqueOrThrow({
          where: { bookingId: f.id },
        })
      ).amountVnd.toNumber(),
    ).toBe(deposit);
    expect(
      (await post(path, { ...body, expectedRevision: state.bookingRevision }, 'own')).status,
    ).toBe(409);
    await expect(
      database.prisma.commercialAppendixRevision.update({
        where: { id: state.effectiveRevisionId },
        data: { deltaVnd: 1 },
      }),
    ).rejects.toThrow();
  }, 30_000);
}
