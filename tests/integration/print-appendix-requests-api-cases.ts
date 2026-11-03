import { z } from 'zod';
import { selectionResponseSchema } from '../../src/modules/booking-lifecycle/domain/commercial-selections.js';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import type { StepSixApiHarness } from './commercial-step6-api-cases.js';
import { contractResponseSchema } from '../../src/modules/booking-lifecycle/domain/commercial-contract.js';
import {
  appendicesResponseSchema,
  appendixResponseSchema,
} from '../../src/modules/booking-lifecycle/domain/commercial-appendix.js';
import { designResponse } from '../../src/modules/invitation-studio/http/studio.schemas.js';
import {
  printRequestQuoteSchema,
  printRequestResponseSchema,
} from '../../src/modules/invitation-studio/domain/print-request.js';
import { printOrderListResponseSchema } from '../../src/modules/invitation-studio/http/print-orders.schemas.js';

export function registerPrintAppendixRequestCases(h: StepSixApiHarness) {
  const { post, get, database } = h;
  async function prepared() {
    const f = await h.fixture();
    const selections = h.getLines().filter((line) => line.category !== 'PRINT');
    const saved = await post(
      `/bookings/${f.id}/contract-selections/drafts`,
      { expectedRevision: f.revision, lines: selections },
      'own',
    );
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const selected = selectionResponseSchema.parse(saved.body as unknown).data;
    const submitted = await post(
      `/bookings/${f.id}/contract-selections/submissions`,
      {
        expectedRevision: selected.bookingRevision,
        selectionRevisionId: selected.selection.revisionId,
      },
      'own',
    );
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    const created = await post(
      f.path,
      {
        expectedRevision: selectionResponseSchema.parse(submitted.body as unknown).data
          .bookingRevision,
        predecessorRevisionId: null,
        timelineRevisionId: f.timelineId,
        lines: h.getLines().filter((line) => line.category !== 'PRINT'),
      },
      'manager',
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    let d = contractResponseSchema.parse(created.body).data;
    for (const [action, who] of [
      ['submissions', 'manager'],
      ['approvals', 'manager'],
      ['approvals', 'own'],
    ] as const) {
      const response = await post(
        `${f.path}/${d.contract.revisionId}/${action}`,
        { expectedRevision: d.bookingRevision },
        who,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      d = contractResponseSchema.parse(response.body).data;
    }
    const paid = await post('/management/billing/payments/manual', {
      bookingId: f.id,
      purpose: 'DEPOSIT',
      contractRevisionId: d.contract.revisionId,
      documentDigest: d.contract.documentDigest,
      amountVnd: Math.ceil((d.contract.document.contractTotalVnd * 30) / 100),
      settledAt: new Date().toISOString(),
      reason: 'Local print flow verification',
      evidenceReference: 'LOCAL-PRINT-REQUEST',
    });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    const designs = [];
    for (const title of ['Thiệp gia đình', 'Thiệp bạn bè']) {
      const design = await post(
        `/bookings/${f.id}/invitations`,
        {
          content: {
            title,
            textFields: { brideName: 'Ánh', groomName: 'Minh' },
            sections: [],
            derivedAssetIds: [],
            includesSeating: false,
          },
        },
        'own',
      );
      expect(design.status, JSON.stringify(design.body)).toBe(201);
      designs.push(designResponse.parse(design.body).data);
    }
    const body = {
      lines: designs.map((design, i) => ({
        designId: design.designId,
        designRevisionId: design.revisionId,
        quantity: i === 0 ? 100 : 40,
      })),
    };
    const path = `/bookings/${f.id}/print-requests`;
    const preview = await post(path + '/price-preview', body, 'own');
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    const quote = z.object({ data: printRequestQuoteSchema }).parse(preview.body as unknown).data;
    expect(quote.document.totalVnd).toBe(700000);
    expect(quote.document.lines.map((line) => line.line.unitPriceVnd)).toEqual([5000, 5000]);
    await mkdir('test-results', { recursive: true });
    for (const [index, line] of quote.document.lines.entries()) {
      const file = await get(
        `/bookings/${f.id}/printable-revisions/${line.printableRevisionId}/file`,
        'own',
      );
      expect(file.status, JSON.stringify(file.body)).toBe(200);
      expect(file.headers['content-type']).toContain('application/pdf');
      expect((file.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
      await writeFile(`test-results/print-appendix-preview-${index + 1}.pdf`, file.body as Buffer);
    }
    return { f, d, designs, body, path, quote };
  }
  async function consent(f: Awaited<ReturnType<typeof prepared>>) {
    const confirm = await post(
      f.path + '/confirm',
      { quoteId: f.quote.quoteId, digest: f.quote.digest, consent: true },
      'own',
    );
    expect(confirm.status, JSON.stringify(confirm.body)).toBe(201);
    return printRequestResponseSchema.parse(confirm.body).data;
  }
  async function appendices(bookingId: string) {
    return appendicesResponseSchema.parse(
      (await get(`/bookings/${bookingId}/contract-appendices`)).body,
    ).data;
  }
  async function approve(bookingId: string, who = 'manager') {
    const state = await appendices(bookingId);
    const response = await post(
      `/bookings/${bookingId}/contract-appendices/${state.currentRevisionId}/approvals`,
      { expectedRevision: state.bookingRevision },
      who,
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return appendixResponseSchema.parse(response.body).data;
  }
  async function adjust(bookingId: string, quantities: number[]) {
    const state = await appendices(bookingId);
    const effective = state.revisions.find((a) => a.revisionId === state.effectiveRevisionId)!;
    let index = 0;
    const lines = effective.document.afterLines.flatMap((line) => {
      const quantity = line.category === 'PRINT' ? quantities[index++]! : line.quantity;
      return quantity
        ? [
            {
              category: line.category,
              sourceId: line.sourceId,
              sourceRevisionId: line.sourceRevisionId,
              quantity,
            },
          ]
        : [];
    });
    const draft = await post(`/bookings/${bookingId}/contract-appendices`, {
      expectedRevision: state.bookingRevision,
      predecessorRevisionId: state.effectiveRevisionId,
      reason: 'Điều chỉnh số lượng in',
      lines,
    });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const data = appendixResponseSchema.parse(draft.body).data;
    const submitted = await post(
      `/bookings/${bookingId}/contract-appendices/${data.appendix.revisionId}/submissions`,
      { expectedRevision: data.bookingRevision },
    );
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    return appendixResponseSchema.parse(submitted.body).data;
  }
  async function orders(bookingId: string) {
    const response = await get(`/bookings/${bookingId}/print-orders`, 'own');
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return printOrderListResponseSchema.parse(response.body).data.items;
  }

  it('appendix print requests: multiple designs create no order/charge until the second approval; exact retry posts once', async () => {
    const f = await prepared();
    const initialCount = await database.prisma.billingLedgerEntry.count({
      where: { bookingId: f.f.id },
    });
    const request = await consent(f);
    expect(request.orderId).toBeNull();
    expect(request.state).toBe('AWAITING_APPROVAL');
    expect(await orders(f.f.id)).toEqual([]);
    expect(await database.prisma.billingLedgerEntry.count({ where: { bookingId: f.f.id } })).toBe(
      initialCount,
    );
    const state = await appendices(f.f.id);
    expect(state.revisions[0]?.approvals.map((a) => a.party)).toEqual(['COUPLE']);
    expect(state.revisions[0]?.printRequests?.[0]?.document.lines).toHaveLength(2);
    const key = randomUUID();
    const path = `/bookings/${f.f.id}/contract-appendices/${request.appendixRevisionId}/approvals`;
    const approved = await post(path, { expectedRevision: state.bookingRevision }, 'manager', key);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(
      (await post(path, { expectedRevision: state.bookingRevision }, 'manager', key)).status,
    ).toBe(200);
    const result = await orders(f.f.id);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      status: 'APPROVED',
      appendixSource: { requestId: request.requestId },
      currentCommercialRevision: { orderTotalVnd: 700000 },
    });
    expect(result[0]?.lines.map((l) => l.quantity).sort((a, b) => a - b)).toEqual([40, 100]);
    expect(
      (
        await post(
          `/management/print-orders/${result[0]!.orderId}/production`,
          { expectedRevision: result[0]!.revision },
          'outsider',
        )
      ).status,
    ).toBe(404);
    expect(
      await database.prisma.billingLedgerEntry.count({
        where: { bookingId: f.f.id, sourceType: 'CONTRACT_APPENDIX' },
      }),
    ).toBe(1);
    expect(
      await database.prisma.billingLedgerEntry.count({
        where: { bookingId: f.f.id, sourceType: 'PRINT_ORDER' },
      }),
    ).toBe(0);
  }, 45000);

  it('appendix print requests: successor quantity/removal changes sync only on mutual approval and block pending production', async () => {
    const f = await prepared();
    await consent(f);
    await approve(f.f.id);
    const original = (await orders(f.f.id))[0]!;
    await adjust(f.f.id, [125, 0]);
    expect((await orders(f.f.id))[0]?.lines).toHaveLength(2);
    const blocked = await post(`/management/print-orders/${original.orderId}/production`, {
      expectedRevision: original.revision,
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({ error: { code: 'PRINT_APPENDIX_PENDING' } });
    await approve(f.f.id);
    expect((await orders(f.f.id))[0]?.lines).toHaveLength(2);
    await approve(f.f.id, 'own');
    const changed = (await orders(f.f.id))[0]!;
    expect(changed.orderId).toBe(original.orderId);
    expect(changed.lines).toHaveLength(1);
    expect(changed.lines[0]?.quantity).toBe(125);
    expect(changed.currentCommercialRevision?.orderTotalVnd).toBe(625000);
    const production = await post(`/management/print-orders/${changed.orderId}/production`, {
      expectedRevision: changed.revision,
    });
    expect(production.status, JSON.stringify(production.body)).toBe(200);
    await adjust(f.f.id, [130]);
    await approve(f.f.id);
    const state = await appendices(f.f.id);
    const denied = await post(
      `/bookings/${f.f.id}/contract-appendices/${state.currentRevisionId}/approvals`,
      { expectedRevision: state.bookingRevision },
      'own',
    );
    expect(denied.status).toBe(409);
    expect((await orders(f.f.id))[0]?.lines[0]?.quantity).toBe(125);
  }, 45000);

  it('appendix print requests: unauthorized or altered consent is rejected; withdrawal leaves no production order', async () => {
    const f = await prepared();
    const body = { quoteId: f.quote.quoteId, digest: f.quote.digest, consent: true };
    expect((await post(f.path + '/confirm', body, 'outsider')).status).toBe(404);
    expect(
      (await post(f.path + '/confirm', { ...body, digest: '0'.repeat(64) }, 'own')).status,
    ).toBe(409);
    const request = await consent(f);
    const withdrawn = await post(
      `${f.path}/${request.requestId}/withdraw`,
      { expectedRevision: request.bookingRevision },
      'own',
    );
    expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200);
    expect(withdrawn.body).toMatchObject({ data: { state: 'SUPERSEDED', orderId: null } });
    expect(await orders(f.f.id)).toEqual([]);
  }, 45000);

  it('appendix print requests: concurrent confirmation and approval cannot duplicate orders or money; full removal cancels the order', async () => {
    const f = await prepared();
    const body = { quoteId: f.quote.quoteId, digest: f.quote.digest, consent: true };
    const confirmations = await Promise.all([
      post(f.path + '/confirm', body, 'own'),
      post(f.path + '/confirm', body, 'own'),
    ]);
    expect(confirmations.map((r) => r.status)).toEqual([201, 201]);
    expect(printRequestResponseSchema.parse(confirmations[0].body as unknown).data.requestId).toBe(
      printRequestResponseSchema.parse(confirmations[1].body as unknown).data.requestId,
    );
    const state = await appendices(f.f.id);
    const decisions = await Promise.all(
      [1, 2].map(() =>
        post(`/bookings/${f.f.id}/contract-appendices/${state.currentRevisionId}/approvals`, {
          expectedRevision: state.bookingRevision,
        }),
      ),
    );
    expect(decisions.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await orders(f.f.id)).toHaveLength(1);
    await adjust(f.f.id, [0, 0]);
    await approve(f.f.id);
    await approve(f.f.id, 'own');
    expect((await orders(f.f.id))[0]?.status).toBe('CANCELLED');
    const facts = await database.prisma.billingLedgerEntry.findMany({
      where: { bookingId: f.f.id, sourceType: 'CONTRACT_APPENDIX' },
    });
    expect(facts.map((entry) => [entry.kind, entry.amountVnd.toNumber()])).toEqual(
      expect.arrayContaining([
        ['CHARGE', 700000],
        ['CREDIT_ADJUSTMENT', 700000],
      ]),
    );
    const orderId = (await orders(f.f.id))[0]!.orderId;
    const order = await database.prisma.invitationPrintOrder.findUniqueOrThrow({
      where: { id: orderId },
    });
    await expect(
      database.prisma.invitationPrintOrder.update({
        where: { id: orderId },
        data: { status: 'IN_PRODUCTION', revision: order.revision + 1 },
      }),
    ).rejects.toThrow();
  }, 45000);
}
