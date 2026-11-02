import type { Prisma } from '../../../generated/prisma/client.js';
import type { z } from 'zod';
import type { contractLineSchema } from '../../booking-lifecycle/domain/commercial-contract.js';
import { commercialPrintSnapshotSchema } from '../domain/contracted-print.js';
import { printOrderConflict } from '../domain/print-policy.js';

/** Historical paid copies must be fulfilled before buying the same print specification. */
export async function requireUnusedContractCopies(
  tx: Prisma.TransactionClient,
  bookingId: string,
  lines: readonly z.infer<typeof contractLineSchema>[],
  facts: { templateVersionId: string; material: string; printType: string },
) {
  const contracted = lines.filter((line) => line.category === 'PRINT');
  if (!contracted.length) return;
  const offerings = await tx.printOfferingRevision.findMany({
    where: { id: { in: contracted.map((line) => line.sourceRevisionId) } },
  });
  const matching = new Set(
    offerings
      .filter(
        (old) =>
          old.templateVersionId === facts.templateVersionId &&
          old.material === facts.material &&
          old.printType === facts.printType,
      )
      .map((old) => old.offeringId),
  );
  if (!matching.size) return;
  const orders = await tx.invitationPrintOrder.findMany({
    where: {
      bookingId,
      status: { in: ['APPROVED', 'IN_PRODUCTION', 'READY_FOR_HANDOVER', 'HANDED_OVER'] },
    },
    select: { id: true },
  });
  const allocations = await tx.invitationPrintLine.findMany({
    where: { bookingId, orderId: { in: orders.map((order) => order.id) } },
    select: { quantity: true, commercialSource: true },
  });
  const used = new Map<string, number>();
  for (const allocation of allocations) {
    if (allocation.commercialSource === null) continue;
    const source = commercialPrintSnapshotSchema.parse(allocation.commercialSource);
    used.set(source.offeringId, (used.get(source.offeringId) ?? 0) + allocation.quantity);
  }
  if (
    contracted.some(
      (line) => matching.has(line.sourceId) && (used.get(line.sourceId) ?? 0) < line.quantity,
    )
  )
    throw printOrderConflict('PRINT_CONTRACT_COPIES_AVAILABLE');
}
