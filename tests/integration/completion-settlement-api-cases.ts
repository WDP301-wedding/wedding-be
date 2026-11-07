import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import type { StepSixApiHarness } from './commercial-step6-api-cases.js';
import { proposalResponseSchema } from '../../src/modules/booking-lifecycle/http/booking-lifecycle.responses.js';
import { appendixResponseSchema } from '../../src/modules/booking-lifecycle/domain/commercial-appendix.js';
import { createPrismaBookingAutomationRepository } from '../../src/modules/booking-lifecycle/infrastructure/automation.repository.js';

export async function completeSettlementFixture(h: StepSixApiHarness, bookingId: string) {
  const current = proposalResponseSchema.parse(
    (await h.get(`/bookings/${bookingId}/proposal`)).body as unknown,
  ).data;
  const result = await h.post(`/management/bookings/${bookingId}/completion`, {
    expectedRevision: current.revision,
  });
  expect(result.status, JSON.stringify(result.body)).toBe(200);
}

export function registerCompletionSettlementCases(h: StepSixApiHarness) {
  const state = async (id: string) =>
    proposalResponseSchema.parse((await h.get(`/bookings/${id}/proposal`)).body as unknown).data;
  const complete = async (id: string) =>
    h.post(`/management/bookings/${id}/completion`, {
      expectedRevision: (await state(id)).revision,
    });
  async function draft(id: string, predecessorRevisionId: string) {
    const response = await h.post(`/bookings/${id}/contract-appendices`, {
      expectedRevision: (await state(id)).revision,
      predecessorRevisionId,
      reason: 'Đề xuất kiểm thử điều kiện kết thúc tiệc',
      lines: h.getLines().filter((l) => l.category !== 'PRINT'),
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return appendixResponseSchema.parse(response.body as unknown).data;
  }
  it('denies final settlement and both payment methods before completion, then enables settlement', async () => {
    const { f, d } = await h.paidFixture();
    const body = {
      expectedDraftRevision: 0,
      expectedCommercialRevisionId: d.contract.revisionId,
      expectedBillingRevision: 2,
    };
    for (const [path, input, code] of [
      [
        `/management/bookings/${f.id}/incidental-expenses`,
        { expectedRevision: 0, name: 'Phát sinh', quantity: 1, unit: 'lần', unitPriceVnd: 1000 },
        'INVOICE_NOT_ELIGIBLE',
      ],
      [`/management/bookings/${f.id}/final-invoices`, body, 'INVOICE_NOT_ELIGIBLE'],
      [
        `/bookings/${f.id}/payments/balance`,
        { expectedBillingRevision: 2 },
        'BALANCE_NOT_ELIGIBLE',
      ],
      [
        '/management/billing/payments/manual',
        {
          bookingId: f.id,
          purpose: 'BALANCE',
          expectedBillingRevision: 2,
          amountVnd: 1000,
          settledAt: new Date().toISOString(),
          reason: 'Thử trước tiệc',
          evidenceReference: 'LOCAL-COMPLETION',
        },
        'BALANCE_NOT_ELIGIBLE',
      ],
    ] as const) {
      const response = await h.post(path, input);
      expect(response.status, JSON.stringify(response.body)).toBe(409);
      expect(response.body).toMatchObject({ error: { code } });
    }
    expect((await complete(f.id)).status).toBe(200);
    expect((await h.post(`/management/bookings/${f.id}/final-invoices`, body)).status).toBe(201);
    expect(
      (await h.post(`/bookings/${f.id}/payments/balance`, { expectedBillingRevision: 2 }, 'own'))
        .status,
    ).toBe(201);
  }, 30_000);

  it.each(['manager', 'own'])(
    'requires current dual approval with %s approving first',
    async (first) => {
      const { f, d } = await h.paidFixture();
      let pending = await draft(f.id, d.contract.revisionId);
      expect((await state(f.id)).completion).toMatchObject({ canComplete: false, pending: true });
      expect((await complete(f.id)).body).toMatchObject({
        error: { code: 'APPENDIX_APPROVAL_REQUIRED' },
      });
      await expect(
        h.database.prisma.booking.update({ where: { id: f.id }, data: { phase: 'COMPLETED' } }),
      ).rejects.toThrow('completion requires approved current appendix');
      const base = `/bookings/${f.id}/contract-appendices/${pending.appendix.revisionId}`;
      for (const [action, who] of [
        ['submissions', 'manager'],
        ['approvals', first],
        ['approvals', first === 'manager' ? 'own' : 'manager'],
      ] as const) {
        const response = await h.post(
          `${base}/${action}`,
          { expectedRevision: pending.bookingRevision },
          who,
        );
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        pending = appendixResponseSchema.parse(response.body as unknown).data;
        if (pending.appendix.state !== 'APPROVED')
          expect((await complete(f.id)).body).toMatchObject({
            error: { code: 'APPENDIX_APPROVAL_REQUIRED' },
          });
      }
      expect((await state(f.id)).completion?.canComplete).toBe(true);
      expect((await complete(f.id)).status).toBe(200);
      const after = await h.post(`/bookings/${f.id}/contract-appendices`, {
        expectedRevision: (await state(f.id)).revision,
        predecessorRevisionId: pending.appendix.revisionId,
        reason: 'Không được sửa sau hoàn thành',
        lines: h.getLines().filter((l) => l.category !== 'PRINT'),
      });
      expect(after.body).toMatchObject({ error: { code: 'APPENDIX_NOT_EDITABLE' } });
    },
    30_000,
  );

  it('retains a cancelled proposal and reason, leaves the agreement unchanged, then permits completion', async () => {
    const { f, d } = await h.paidFixture();
    const pending = await draft(f.id, d.contract.revisionId);
    const path = `/bookings/${f.id}/contract-appendices/${pending.appendix.revisionId}/cancellations`;
    const body = { expectedRevision: pending.bookingRevision, reason: 'Không tiếp tục thay đổi' };
    expect((await h.post(path, { ...body, reason: ' ' })).status).toBe(422);
    expect((await h.post(path, body, 'outsider')).status).toBe(404);
    expect((await h.post(path, { ...body, expectedRevision: 1 })).status).toBe(409);
    const key = randomUUID();
    const cancelled = await h.post(path, body, 'manager', key);
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect((await h.post(path, body, 'manager', key)).body).toEqual(cancelled.body);
    expect(appendixResponseSchema.parse(cancelled.body as unknown).data.appendix).toMatchObject({
      state: 'SUPERSEDED',
      documentDigest: pending.appendix.documentDigest,
    });
    expect(await h.database.prisma.billingLedgerEntry.count({ where: { bookingId: f.id } })).toBe(
      2,
    );
    expect(
      await h.database.prisma.auditLog.findFirst({
        where: { entityId: pending.appendix.revisionId, action: 'booking.appendix-cancelled' },
      }),
    ).toMatchObject({ metadata: { reason: body.reason } });
    expect((await complete(f.id)).status).toBe(200);
  }, 30_000);

  it('keeps automatic completion pending until the proposal is resolved', async () => {
    const { f, d } = await h.paidFixture();
    const pending = await draft(f.id, d.contract.revisionId);
    const repository = createPrismaBookingAutomationRepository(h.database.prisma);
    const run = async () =>
      repository.completeDue(
        {
          bookingId: f.id,
          commandId: randomUUID(),
          expectedBookingRevision: (await state(f.id)).revision,
          now: new Date().toISOString(),
        },
        {
          authority: 'SYSTEM',
          actorAccountId: null,
          requestId: randomUUID(),
          causationId: randomUUID(),
        },
      );
    expect(await run()).toEqual({ outcome: 'NOT_DUE' });
    await h.post(
      `/bookings/${f.id}/contract-appendices/${pending.appendix.revisionId}/cancellations`,
      { expectedRevision: pending.bookingRevision, reason: 'Hủy đề xuất thử nghiệm' },
    );
    expect(await run()).toEqual({ outcome: 'COMPLETED' });
  }, 30_000);

  it('serializes a new appendix against completion without leaving a completed event with a pending change', async () => {
    const { f, d } = await h.paidFixture();
    const revision = (await state(f.id)).revision;
    const responses = await Promise.all([
      h.post(`/management/bookings/${f.id}/completion`, { expectedRevision: revision }),
      h.post(`/bookings/${f.id}/contract-appendices`, {
        expectedRevision: revision,
        predecessorRevisionId: d.contract.revisionId,
        reason: 'Thay đổi đồng thời',
        lines: h.getLines().filter((l) => l.category !== 'PRINT'),
      }),
    ]);
    expect(responses.filter((r) => r.status < 300)).toHaveLength(1);
    expect(responses.filter((r) => r.status >= 300).map((r) => r.status)).toEqual([409]);
    const current = await state(f.id);
    expect(current.phase === 'COMPLETED' && current.completion?.pending).toBe(false);
  }, 30_000);
}
