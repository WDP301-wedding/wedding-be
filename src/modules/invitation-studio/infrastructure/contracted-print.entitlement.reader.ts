import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { z } from 'zod';
import type { contractLineSchema } from '../../booking-lifecycle/domain/commercial-contract.js';
import { commercialPrintSnapshotSchema } from '../domain/contracted-print.js';
import { printOrderConflict } from '../domain/print-policy.js';

/** Invitation owns active production allocations; Booking consumes only this policy. */
export function createContractedPrintEntitlementReader(client: PrismaClient) {
  return Object.freeze({
    async requirePreserved(
      bookingId: string,
      afterLines: readonly z.infer<typeof contractLineSchema>[],
    ) {
      const orders = await client.invitationPrintOrder.findMany({
        where: {
          bookingId,
          status: { in: ['APPROVED', 'IN_PRODUCTION', 'READY_FOR_HANDOVER', 'HANDED_OVER'] },
        },
        select: { id: true },
      });
      const lines = await client.invitationPrintLine.findMany({
        where: { bookingId, orderId: { in: orders.map((o) => o.id) } },
      });
      const quantities = new Map<string, number>();
      for (const line of lines) {
        if (!line.commercialSource) continue;
        const binding = commercialPrintSnapshotSchema.parse(line.commercialSource);
        const agreed = afterLines.find(
          (l) => l.category === 'PRINT' && l.sourceId === binding.offeringId,
        );
        if (!agreed) throw printOrderConflict('CONTRACT_PRINT_QUANTITY_ALLOCATED');
        if (
          agreed.sourceRevisionId !== binding.sourceRevisionId ||
          agreed.unitPriceVnd !== binding.unitPriceVnd
        )
          throw printOrderConflict('CONTRACT_PRINT_SOURCE_ALLOCATED');
        quantities.set(
          binding.offeringId,
          (quantities.get(binding.offeringId) ?? 0) + line.quantity,
        );
      }
      for (const [offeringId, quantity] of quantities) {
        const line = afterLines.find((l) => l.category === 'PRINT' && l.sourceId === offeringId);
        if (!line || line.quantity < quantity)
          throw printOrderConflict('CONTRACT_PRINT_QUANTITY_ALLOCATED');
      }
    },
  });
}
