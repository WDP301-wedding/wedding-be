import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import type { StepSixApiHarness } from './commercial-step6-api-cases.js';
import { contractResponseSchema } from '../../src/modules/booking-lifecycle/domain/commercial-contract.js';
import { printOfferingViewSchema } from '../../src/modules/venue-catalog/domain/commercial-offering.js';
import { designResponse } from '../../src/modules/invitation-studio/http/studio.schemas.js';
import { printOrderResponseSchema } from '../../src/modules/invitation-studio/http/print-orders.schemas.js';
import { billingResponseSchema } from '../../src/modules/payments-billing/http/payments-billing.schemas.js';

export function registerContractedPrintPriceApiCases(harness: StepSixApiHarness) {
  const { database, fixture, getLines, post, get, approved } = harness;
  it.each([0, 20_000_000_000])(
    'fulfills the frozen contract print price %i without a second charge',
    async (unitPriceVnd) => {
      const f = await fixture();
      const selected = getLines().find((l) => l.category === 'PRINT')!;
      const source = await database.prisma.printOfferingRevision.findUniqueOrThrow({
        where: { id: selected.sourceRevisionId },
      });
      const catalogResponse = await post('/management/print-offerings', {
        templateId: source.templateId,
        templateVersionId: source.templateVersionId,
        name: source.name,
        material: source.material,
        printType: source.printType,
        active: true,
        unitPriceVnd,
      });
      expect(catalogResponse.status, JSON.stringify(catalogResponse.body)).toBe(201);
      const offering = printOfferingViewSchema.parse(
        (catalogResponse.body as { data: unknown }).data,
      );
      const lines = getLines().map((l) =>
        l.category === 'PRINT'
          ? { ...l, sourceId: offering.offeringId, sourceRevisionId: offering.sourceRevisionId }
          : l,
      );
      const draft = await post(
        f.path,
        {
          expectedRevision: f.revision,
          predecessorRevisionId: null,
          timelineRevisionId: f.timelineId,
          lines,
        },
        'own',
      );
      expect(draft.status).toBe(201);
      const d = await approved(f, contractResponseSchema.parse(draft.body as unknown).data);
      const deposited = await post('/management/billing/payments/manual', {
        bookingId: f.id,
        purpose: 'DEPOSIT',
        contractRevisionId: d.contract.revisionId,
        documentDigest: d.contract.documentDigest,
        amountVnd: d.contract.document.depositAmountVnd,
        settledAt: new Date().toISOString(),
        reason: 'Cọc kiểm thử giá thiệp đã thỏa thuận',
        evidenceReference: 'LOCAL-CONTRACTED-PRINT-PRICE',
      });
      expect(deposited.status, JSON.stringify(deposited.body)).toBe(201);
      const created = await post(
        `/bookings/${f.id}/invitations`,
        { templateId: offering.templateId },
        'own',
      );
      expect(created.status).toBe(201);
      const design = designResponse.parse(created.body as unknown).data;
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
              quantity: 60,
              commercialSource: {
                agreementRevisionId: d.contract.revisionId,
                offeringId: offering.offeringId,
                sourceRevisionId: offering.sourceRevisionId,
              },
            },
          ],
        },
        'own',
      );
      expect(requested.status).toBe(201);
      let order = printOrderResponseSchema.parse(requested.body as unknown).data;
      // Bypassing HTTP cannot substitute a different price in the immutable quote.
      await expect(
        database.prisma.invitationCommercialRevision.create({
          data: {
            id: randomUUID(),
            bookingId: f.id,
            orderId: order.orderId,
            revisionNumber: 1,
            linesJson: [
              {
                lineId: order.lines[0]!.lineId,
                designId: design.designId,
                designRevisionId: design.revisionId,
                quantity: 60,
                unitPriceVnd: unitPriceVnd + 1,
                lineTotalVnd: 60 * (unitPriceVnd + 1),
              },
            ],
            orderTotalVnd: 60 * (unitPriceVnd + 1),
            estimatedHandoverAt: new Date(Date.now() + 86400000),
            expiresAt: new Date(Date.now() + 604800000),
          },
        }),
      ).rejects.toThrow('contracted print quotation must preserve frozen prices and quantities');
      expect(
        await database.prisma.invitationCommercialRevision.count({
          where: { orderId: order.orderId },
        }),
      ).toBe(0);
      const quoted = await post(`/management/print-orders/${order.orderId}/quotations`, {
        expectedRevision: order.revision,
        lines: [{ lineId: order.lines[0]!.lineId, unitPriceVnd }],
        estimatedHandoverAt: new Date(Date.now() + 86400000).toISOString(),
      });
      expect(quoted.status, JSON.stringify(quoted.body)).toBe(200);
      order = printOrderResponseSchema.parse(quoted.body as unknown).data;
      expect(order.currentCommercialRevision!.orderTotalVnd).toBe(60 * unitPriceVnd);
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
      if (unitPriceVnd !== 0) {
        expect(
          (
            await post(
              `/bookings/${f.id}/print-orders/${order.orderId}/cancellation-intents`,
              {
                expectedRevision: order.revision,
                reason: 'Replace accepted content before production',
              },
              'own',
            )
          ).status,
        ).toBe(200);
        expect(
          (
            await post(`/management/print-orders/${order.orderId}/cancellation`, {
              expectedRevision: order.revision,
            })
          ).status,
        ).toBe(200);
        const audit = await database.prisma.invitationPrintAudit.findFirstOrThrow({
          where: { orderId: order.orderId, action: 'invitation.print-order-cancelled' },
        });
        expect(audit.metadata).toMatchObject({ creditedAmountVnd: 0 });
        const replacement = await post(
          `/bookings/${f.id}/print-orders`,
          {
            lines: [
              {
                designId: design.designId,
                quantity: 60,
                commercialSource: {
                  agreementRevisionId: d.contract.revisionId,
                  offeringId: offering.offeringId,
                  sourceRevisionId: offering.sourceRevisionId,
                },
              },
            ],
          },
          'own',
        );
        expect(replacement.status).toBe(201);
        order = printOrderResponseSchema.parse(replacement.body as unknown).data;
        const quote = await post(`/management/print-orders/${order.orderId}/quotations`, {
          expectedRevision: order.revision,
          lines: [{ lineId: order.lines[0]!.lineId, unitPriceVnd }],
          estimatedHandoverAt: new Date(Date.now() + 86400000).toISOString(),
        });
        expect(quote.status).toBe(200);
        order = printOrderResponseSchema.parse(quote.body as unknown).data;
        const approval = await post(
          `/bookings/${f.id}/print-orders/${order.orderId}/approval`,
          {
            expectedRevision: order.revision,
            commercialRevisionId: order.currentCommercialRevisionId,
          },
          'own',
        );
        expect(approval.status).toBe(200);
        order = printOrderResponseSchema.parse(approval.body as unknown).data;
      }
      for (const transition of ['production', 'ready', 'handover']) {
        const response = await post(`/management/print-orders/${order.orderId}/${transition}`, {
          expectedRevision: order.revision,
          ...(transition === 'handover' ? { evidenceReference: 'LOCAL-PRICE-HANDOVER' } : {}),
        });
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        order = printOrderResponseSchema.parse(response.body as unknown).data;
      }
      expect(order.status).toBe('HANDED_OVER');
      const bill = billingResponseSchema.parse(
        (await get(`/bookings/${f.id}/billing`, 'own')).body as unknown,
      ).data;
      expect(bill.totals.acceptedChargesVnd).toBe(d.contract.document.contractTotalVnd);
      expect(bill.history).toHaveLength(2);
      expect(bill.history.some((l) => l.sourceType === 'PRINT_ORDER')).toBe(false);
      expect(order.receivableChargeId).toBe(
        bill.history.find((l) => l.sourceType === 'CONTRACT')!.ledgerEntryId,
      );
    },
    60_000,
  );
}
