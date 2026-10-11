import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { commercialDocumentFixture } from '../../../../tests/fixtures/commercial-contract.js';
import { createContractedPrintEntitlementReader } from './contracted-print.entitlement.reader.js';
it('preserves active quantities per offering and ignores unrelated legacy lines', async () => {
  const id = randomUUID(),
    document = commercialDocumentFixture(),
    line = { ...document.lines[0]!, category: 'PRINT' as const, quantity: 100 };
  const commercialSource = {
    agreementRevisionId: randomUUID(),
    offeringId: line.sourceId,
    sourceRevisionId: line.sourceRevisionId,
    templateVersionId: randomUUID(),
    material: 'Giấy mỹ thuật',
    printType: 'COLOR',
    unitPriceVnd: line.unitPriceVnd,
  };
  const rows = [
    { quantity: 40, commercialSource },
    { quantity: 60, commercialSource },
    { quantity: 1000, commercialSource: null },
  ];
  const findOrders = vi.fn().mockResolvedValue([{ id }]);
  const client = {
    invitationPrintOrder: { findMany: findOrders },
    invitationPrintLine: { findMany: vi.fn().mockResolvedValue(rows) },
  } as unknown as PrismaClient;
  const reader = createContractedPrintEntitlementReader(client);
  await expect(reader.requirePreserved(id, [line])).resolves.toBeUndefined();
  for (const lines of [[], [{ ...line, quantity: 99 }]])
    await expect(reader.requirePreserved(id, lines)).rejects.toMatchObject({
      code: 'CONTRACT_PRINT_QUANTITY_ALLOCATED',
    });
  expect(findOrders).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        bookingId: id,
        status: { in: ['APPROVED', 'IN_PRODUCTION', 'READY_FOR_HANDOVER', 'HANDED_OVER'] },
      },
    }),
  );
});
