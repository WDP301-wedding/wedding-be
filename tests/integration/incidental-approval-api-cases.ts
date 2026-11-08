import { expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import type { StepSixApiHarness } from './commercial-step6-api-cases.js';
import { completeSettlementFixture } from './completion-settlement-api-cases.js';
import { expenseDraftResponseSchema } from '../../src/modules/payments-billing/domain/final-invoice.js';

export function registerIncidentalApprovalCases(h: StepSixApiHarness) {
  it('incidental catalog: freezes prices, gates all expenses, retains successors and prevents adjustment bypass', async () => {
    const offering = {
      name: 'Bia kiểm thử',
      description: 'Thùng 24 lon, 330 ml',
      unit: 'thùng',
      unitPriceVnd: 300000,
      chargingRule: 'Chỉ tính thùng đã mở; hoàn trả thùng nguyên',
      active: true,
    };
    const created = await h.post('/management/incidental-offerings', offering);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const item = (created.body as { data: { offeringId: string } }).data;
    const { f, d } = await h.paidFixture(false, undefined, 'current');
    expect(
      (
        await h.expenseMutation('patch', `/management/incidental-offerings/${item.offeringId}`, {
          ...offering,
          expectedRevision: 1,
          unitPriceVnd: 350000,
        })
      ).status,
    ).toBe(200);
    const future = await h.fixture();
    expect(
      (await h.database.prisma.booking.findUniqueOrThrow({ where: { id: future.id } }))
        .incidentalPricing,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ offeringId: item.offeringId, unitPriceVnd: 350000 }),
      ]),
    );
    expect(
      (
        await h.expenseMutation('patch', `/management/incidental-offerings/${item.offeringId}`, {
          ...offering,
          expectedRevision: 2,
          unitPriceVnd: 350000,
          active: false,
        })
      ).status,
    ).toBe(200);
    const retained = await h.database.prisma.commercialContractRevision.findUniqueOrThrow({
      where: { id: d.contract.revisionId },
      include: { pdf: true },
    });
    expect(retained.document).toEqual(d.contract.document);
    expect(createHash('sha256').update(retained.pdf!.bytes).digest('hex')).toBe(
      d.contract.pdfSha256,
    );
    await expect(
      h.database.prisma.booking.update({
        where: { id: f.id },
        data: { incidentalPolicyVersion: null },
      }),
    ).rejects.toThrow();
    await completeSettlementFixture(h, f.id);
    const path = `/management/bookings/${f.id}/incidental-expenses`;
    const read = async () =>
      expenseDraftResponseSchema.parse((await h.get(path)).body as unknown).data;
    const invoice = {
      expectedDraftRevision: 0,
      expectedCommercialRevisionId: d.contract.revisionId,
      expectedBillingRevision: 2,
    };
    expect(d.contract.document.incidentalPricing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ offeringId: item.offeringId, unitPriceVnd: 300000 }),
      ]),
    );
    expect((await h.post(`/management/bookings/${f.id}/final-invoices`, invoice)).status).toBe(409);
    const line = await h.post(path, {
      expectedRevision: 0,
      name: 'Giá giả',
      quantity: 5,
      unit: 'giả',
      unitPriceVnd: 999999,
      sourceType: 'CATALOG',
      offeringId: item.offeringId,
    });
    expect(line.status, JSON.stringify(line.body)).toBe(201);
    let state = await read();
    expect(state.lines[0]).toMatchObject({
      name: offering.name,
      unitPriceVnd: 300000,
      totalVnd: 1500000,
    });
    expect(
      (await h.post(path + '/submit', { expectedRevision: state.revision }, 'own')).status,
    ).toBeGreaterThanOrEqual(400);
    expect((await h.post(path + '/submit', { expectedRevision: state.revision })).status).toBe(200);
    state = await read();
    const decision = {
      expectedRevision: state.revision,
      reviewId: state.currentReview!.id,
      documentDigest: state.currentReview!.documentDigest,
      decision: 'APPROVE',
    };
    expect(
      (await h.post(`/bookings/${f.id}/incidental-expenses/decisions`, decision, 'staff')).status,
    ).toBeGreaterThanOrEqual(400);
    expect(
      (await h.post(`/bookings/${f.id}/incidental-expenses/decisions`, decision, 'outsider'))
        .status,
    ).toBe(404);
    expect(
      (
        await h.post(`/management/bookings/${f.id}/final-invoices`, {
          ...invoice,
          expectedDraftRevision: state.revision,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await h.post(
          `/bookings/${f.id}/incidental-expenses/decisions`,
          { ...decision, decision: 'REQUEST_CHANGES', reason: 'Cần đối soát số lượng' },
          'own',
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await h.post(path + '/reopen', {
          expectedRevision: state.revision,
          reviewId: state.currentReview!.id,
          documentDigest: state.currentReview!.documentDigest,
          reason: 'Đã kiểm tra lại',
        })
      ).status,
    ).toBe(200);
    expect((await h.post(path + '/submit', { expectedRevision: state.revision })).status).toBe(200);
    state = await read();
    expect(
      (await h.post(`/bookings/${f.id}/incidental-expenses/decisions`, decision, 'own')).status,
    ).toBe(409);
    const approvalKey = randomUUID();
    const approvalBody = {
      ...decision,
      reviewId: state.currentReview!.id,
      documentDigest: state.currentReview!.documentDigest,
    };
    expect(
      (
        await h.post(
          `/bookings/${f.id}/incidental-expenses/decisions`,
          approvalBody,
          'own',
          approvalKey,
        )
      ).status,
    ).toBe(200);
    const grant = {
      accountId_consultationId: { accountId: h.accounts.own!, consultationId: f.consultationId },
    };
    const originalGrant = await h.database.prisma.consultationAccess.findUniqueOrThrow({
      where: grant,
    });
    await h.database.prisma.consultationAccess.delete({ where: grant });
    expect(
      (
        await h.post(
          `/bookings/${f.id}/incidental-expenses/decisions`,
          approvalBody,
          'own',
          approvalKey,
        )
      ).status,
    ).toBe(404);
    await h.database.prisma.consultationAccess.create({ data: originalGrant });
    expect(
      (
        await h.post(path + '/reopen', {
          ...decision,
          reason: 'Tab cũ không được mở lại bản kế tiếp',
          decision: undefined,
        })
      ).status,
    ).toBe(409);
    const finalized = await h.post(`/management/bookings/${f.id}/final-invoices`, {
      ...invoice,
      expectedDraftRevision: state.revision,
    });
    expect(finalized.status, JSON.stringify(finalized.body)).toBe(201);
    expect((await read()).reviewHistory).toHaveLength(2);
    const adjustment = {
      expectedInvoiceRevisionId: (finalized.body as { data: { invoiceRevisionId: string } }).data
        .invoiceRevisionId,
      expectedBillingRevision: 3,
      reason: 'Bổ sung sau đối soát',
      lines: [
        {
          kind: 'DEBIT',
          name: 'Khắc phục thiết bị',
          quantity: 1,
          unit: 'khoản',
          unitPriceVnd: 50000,
          sourceType: 'OTHER',
          reason: 'Chi phí sửa dây âm thanh bị hỏng',
        },
      ],
    };
    expect(
      (await h.post(`/management/bookings/${f.id}/invoice-adjustments`, adjustment)).status,
    ).toBe(409);
    expect((await h.post(path + '/adjustment-proposals', adjustment)).status).toBe(200);
    expect(
      (await h.post(`/bookings/${f.id}/payments/balance`, { expectedBillingRevision: 3 }, 'own'))
        .status,
    ).toBe(409);
    state = await read();
    expect(
      (
        await h.post(
          `/bookings/${f.id}/incidental-expenses/decisions`,
          {
            expectedRevision: state.revision,
            reviewId: state.currentReview!.id,
            documentDigest: state.currentReview!.documentDigest,
            decision: 'APPROVE',
          },
          'own',
        )
      ).status,
    ).toBe(200);
    const adjusted = await h.post(`/management/bookings/${f.id}/invoice-adjustments`, {
      ...adjustment,
      reviewId: state.currentReview!.id,
    });
    expect(adjusted.status, JSON.stringify(adjusted.body)).toBe(201);
    expect(
      (
        await h.post(path + '/reopen', {
          expectedRevision: state.revision,
          reviewId: state.currentReview!.id,
          documentDigest: state.currentReview!.documentDigest,
          reason: 'Không được sửa bản đã áp dụng',
        })
      ).status,
    ).toBe(409);
    await expect(
      h.database.prisma.incidentalExpenseReview.update({
        where: { id: state.currentReview!.id },
        data: { state: 'WITHDRAWN', decisionReason: 'Bản đã vào hóa đơn phải giữ nguyên' },
      }),
    ).rejects.toThrow();
    const events = await h.database.prisma.auditLog.findMany({
      where: { entityType: 'incidental-review', entityId: f.id },
      select: { id: true },
    });
    expect(
      await h.database.prisma.realtimeDelivery.count({
        where: { stream: 'audit', eventId: { in: events.map((e) => e.id) } },
      }),
    ).toBe(events.length);
  }, 60000);

  it('incidental catalog: explicit zero declaration, reasoned reopen and OTHER require no attachments', async () => {
    const { f, d } = await h.paidFixture(false, undefined, 'current');
    await completeSettlementFixture(h, f.id);
    const path = `/management/bookings/${f.id}/incidental-expenses`;
    expect((await h.post(path + '/no-expenses', { expectedRevision: 0 })).status).toBe(200);
    expect(
      (
        await h.post(path, {
          expectedRevision: 0,
          name: 'Sửa ghế',
          quantity: 1,
          unit: 'khoản',
          unitPriceVnd: 10000,
          sourceType: 'OTHER',
          reason: 'Gãy chân ghế',
        })
      ).status,
    ).toBe(409);
    const declared = expenseDraftResponseSchema.parse((await h.get(path)).body as unknown).data;
    expect(
      (
        await h.post(path + '/reopen', {
          expectedRevision: 0,
          reviewId: declared.currentReview!.id,
          documentDigest: declared.currentReview!.documentDigest,
          reason: 'Kiểm tra lại biên bản',
        })
      ).status,
    ).toBe(200);
    expect((await h.post(path + '/no-expenses', { expectedRevision: 0 })).status).toBe(200);
    const result = await h.post(`/management/bookings/${f.id}/final-invoices`, {
      expectedDraftRevision: 0,
      expectedCommercialRevisionId: d.contract.revisionId,
      expectedBillingRevision: 2,
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
  }, 60000);

  it('incidental catalog: serializes no-expense withdrawal against invoice finalization', async () => {
    const { f, d } = await h.paidFixture(false, undefined, 'current');
    await completeSettlementFixture(h, f.id);
    const path = `/management/bookings/${f.id}/incidental-expenses`;
    const declared = expenseDraftResponseSchema.parse(
      (await h.post(path + '/no-expenses', { expectedRevision: 0 })).body as unknown,
    ).data;
    const invoice = {
      expectedDraftRevision: 0,
      expectedCommercialRevisionId: d.contract.revisionId,
      expectedBillingRevision: 2,
    };
    const results = await h.race(f, [
      () => h.post(`/management/bookings/${f.id}/final-invoices`, invoice),
      () =>
        h.post(path + '/reopen', {
          expectedRevision: 0,
          reviewId: declared.currentReview!.id,
          documentDigest: declared.currentReview!.documentDigest,
          reason: 'Đối soát lại trước chốt',
        }),
    ]);
    expect(results.map((r) => r.status)).toEqual(expect.arrayContaining([409]));
    expect(results.every((r) => [200, 201, 409].includes(r.status))).toBe(true);
    if (results[0]!.status === 409) {
      expect(results[1]!.status).toBe(200);
      expect((await h.post(path + '/no-expenses', { expectedRevision: 0 })).status).toBe(200);
      expect((await h.post(`/management/bookings/${f.id}/final-invoices`, invoice)).status).toBe(
        201,
      );
    }
    expect(await h.database.prisma.finalInvoiceRevision.count({ where: { bookingId: f.id } })).toBe(
      1,
    );
  }, 60000);

  it('incidental catalog: approved adjustment cannot change an invoice pinned by an unresolved payment', async () => {
    const { f, d } = await h.paidFixture(false, undefined, 'current');
    await completeSettlementFixture(h, f.id);
    const path = `/management/bookings/${f.id}/incidental-expenses`;
    expect((await h.post(path + '/no-expenses', { expectedRevision: 0 })).status).toBe(200);
    const finalized = await h.post(`/management/bookings/${f.id}/final-invoices`, {
      expectedDraftRevision: 0,
      expectedCommercialRevisionId: d.contract.revisionId,
      expectedBillingRevision: 2,
    });
    expect(finalized.status).toBe(201);
    expect(
      (await h.post(`/bookings/${f.id}/payments/balance`, { expectedBillingRevision: 2 }, 'own'))
        .status,
    ).toBe(201);
    const adjustment = {
      expectedInvoiceRevisionId: (finalized.body as { data: { invoiceRevisionId: string } }).data
        .invoiceRevisionId,
      expectedBillingRevision: 2,
      reason: 'Sửa chi phí sau đối soát',
      lines: [
        {
          kind: 'DEBIT',
          sourceType: 'OTHER',
          name: 'Sửa ghế hư',
          quantity: 1,
          unit: 'khoản',
          unitPriceVnd: 50000,
          reason: 'Thay chân ghế bị gãy',
        },
      ],
    };
    const submitted = await h.post(path + '/adjustment-proposals', adjustment);
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    const review = expenseDraftResponseSchema.parse(submitted.body as unknown).data.currentReview!;
    expect(
      (
        await h.post(
          `/bookings/${f.id}/incidental-expenses/decisions`,
          {
            expectedRevision: 0,
            reviewId: review.id,
            documentDigest: review.documentDigest,
            decision: 'APPROVE',
          },
          'own',
        )
      ).status,
    ).toBe(200);
    const apply = await h.post(`/management/bookings/${f.id}/invoice-adjustments`, {
      ...adjustment,
      reviewId: review.id,
    });
    expect(apply.status, JSON.stringify(apply.body)).toBe(409);
    expect(apply.body).toMatchObject({ error: { code: 'PAYMENT_ATTEMPT_ACTIVE' } });
    expect(await h.database.prisma.finalInvoiceRevision.count({ where: { bookingId: f.id } })).toBe(
      1,
    );
  }, 60000);
}
