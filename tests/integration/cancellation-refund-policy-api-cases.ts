import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import type { StepSixApiHarness } from './commercial-step6-api-cases.js';
import { recordingResponseSchema } from '../../src/modules/payments-billing/http/billing-recording.schemas.js';
import {
  proposalResponseSchema,
  cancellationRequestResponseSchema,
} from '../../src/modules/booking-lifecycle/http/booking-lifecycle.responses.js';

export function registerCancellationRefundPolicyCases(h: StepSixApiHarness) {
  const recording = async (id: string) =>
    recordingResponseSchema.parse(
      (await h.get(`/management/bookings/${id}/billing-recording`)).body as unknown,
    ).data;
  const proposal = async (id: string) =>
    proposalResponseSchema.parse((await h.get(`/bookings/${id}/proposal`)).body as unknown).data;
  it('refund policy: restaurant cancellation retains 100 percent, prefills eligibility and caps replay and partial refunds', async () => {
    const { f } = await h.paidFixture();
    const before = await recording(f.id);
    expect(before.deposit).toMatchObject({ isSettled: true, settledAmountVnd: h.deposit });
    expect(before.refundablePayments).toHaveLength(1);
    expect(before.refundablePayments[0]!.maxRefundVnd).toBe(0);
    expect(before.cancellationRefund?.options.map((o) => o.percent)).toEqual([100, 50, 0]);
    expect(before.cancellationRefund?.requestedAt).toBeNull();
    const cancelled = await h.post(`/management/bookings/${f.id}/cancellation`, {
      expectedRevision: (await proposal(f.id)).revision,
      initiator: 'RESTAURANT',
      reason: 'Nhà hàng không thể phục vụ',
    });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    const after = await recording(f.id);
    expect(after.cancellationRefund).toMatchObject({
      initiator: 'RESTAURANT',
      ratePercent: 100,
      entitledVnd: h.deposit,
      canRecord: true,
    });
    expect(after.refundablePayments[0]!.maxRefundVnd).toBe(h.deposit);
    const body = {
      sourcePaymentId: after.refundablePayments[0]!.paymentId,
      expectedBillingRevision: after.billingRevision,
      amountVnd: Math.floor(h.deposit / 2),
    };
    const key = randomUUID();
    const first = await h.post('/management/billing/refunds', body, 'manager', key);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect((await h.post('/management/billing/refunds', body, 'manager', key)).body).toEqual(
      first.body,
    );
    const remaining = await recording(f.id);
    expect(remaining.cancellationRefund?.remainingVnd).toBe(h.deposit - body.amountVnd);
    expect(
      (
        await h.post('/management/billing/refunds', {
          ...body,
          expectedBillingRevision: remaining.billingRevision,
          amountVnd: remaining.cancellationRefund!.remainingVnd + 1,
        })
      ).status,
    ).toBe(409);
    await expect(
      h.database.prisma.booking.update({
        where: { id: f.id },
        data: { cancellationRefundPolicy: { forged: true } },
      }),
    ).rejects.toThrow('cancellation refund policy is immutable');
  }, 40_000);

  it.each([
    [30, 100],
    [7, 50],
    [6, 0],
  ] as const)(
    'refund policy: accepted customer request at %s days freezes %s percent using request time',
    async (days, percent) => {
      const { f } = await h.paidFixture();
      const state = await proposal(f.id);
      const req = await h.post(
        `/bookings/${f.id}/cancellation-requests`,
        { expectedRevision: state.revision, reason: 'Khách đổi kế hoạch' },
        'own',
      );
      expect(req.status).toBe(202);
      const request = cancellationRequestResponseSchema.parse(req.body as unknown).data;
      const start = (await recording(f.id)).cancellationRefund!.eventStartsAt;
      const requestedAt = new Date(new Date(start).getTime() - days * 86_400_000);
      await h.database.prisma.bookingCancellationRequest.update({
        where: { id: request.cancellationRequestId },
        data: { requestedAt },
      });
      const accepted = await h.post(
        `/management/bookings/${f.id}/cancellation-requests/${request.cancellationRequestId}/decision`,
        {
          expectedRevision: request.bookingRevision,
          decision: 'APPROVE',
          reason: 'Duyệt theo yêu cầu khách',
        },
      );
      expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
      const after = await recording(f.id);
      expect(after.cancellationRefund).toMatchObject({
        initiator: 'COUPLE',
        requestedAt: requestedAt.toISOString(),
        ratePercent: percent,
        entitledVnd: Math.floor((h.deposit * percent) / 100),
        canRecord: percent > 0,
      });
      expect(
        (
          await h.post('/management/billing/refunds', {
            sourcePaymentId: after.refundablePayments[0]!.paymentId,
            expectedBillingRevision: after.billingRevision,
            amountVnd: Math.floor((h.deposit * percent) / 100) + 1,
          })
        ).status,
      ).toBe(409);
    },
    40_000,
  );

  it('refund policy: missing cancellation origin needs review without inventing a request time', async () => {
    const { f } = await h.paidFixture();
    expect(
      (
        await h.post(`/management/bookings/${f.id}/cancellation`, {
          expectedRevision: (await proposal(f.id)).revision,
          reason: 'Legacy client without origin',
        })
      ).status,
    ).toBe(200);
    const after = await recording(f.id);
    expect(after.cancellationRefund).toMatchObject({
      initiator: null,
      requestedAt: null,
      ratePercent: null,
      entitledVnd: null,
      canRecord: false,
    });
    expect(
      (
        await h.post('/management/billing/refunds', {
          sourcePaymentId: after.refundablePayments[0]!.paymentId,
          expectedBillingRevision: after.billingRevision,
          amountVnd: 1,
        })
      ).status,
    ).toBe(409);
  }, 40_000);

  it('refund policy: restricted Couple can request stopping a draft before deposit without creating a refund', async () => {
    const f = await h.fixture();
    expect(
      proposalResponseSchema.parse(
        (await h.get(`/bookings/${f.id}/proposal`, 'own')).body as unknown,
      ).data.capabilities.canRequestCancellation,
    ).toBe(true);
    const requested = await h.post(
      `/bookings/${f.id}/cancellation-requests`,
      { expectedRevision: (await proposal(f.id)).revision, reason: 'Dừng hồ sơ chưa cọc' },
      'own',
    );
    expect(requested.status, JSON.stringify(requested.body)).toBe(202);
    const req = cancellationRequestResponseSchema.parse(requested.body as unknown).data;
    expect(
      (
        await h.post(
          `/management/bookings/${f.id}/cancellation-requests/${req.cancellationRequestId}/decision`,
          { expectedRevision: req.bookingRevision, decision: 'APPROVE', reason: 'Đóng hồ sơ' },
        )
      ).status,
    ).toBe(200);
    expect((await recording(f.id)).cancellationRefund).toMatchObject({
      depositReceivedVnd: 0,
      entitledVnd: 0,
      canRecord: false,
    });
  }, 30_000);
}
