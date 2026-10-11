import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { commercialDocumentFixture } from '../../../../tests/fixtures/commercial-contract.js';
import { ContractedPrintFulfillment } from './contracted-print.fulfillment.js';
function fixture() {
  const document = commercialDocumentFixture(),
    bookingId = document.bookingId,
    designId = randomUUID(),
    orderId = randomUUID(),
    lineId = randomUUID(),
    revisionId = randomUUID(),
    templateVersionId = randomUUID();
  const line = {
    ...document.lines[0]!,
    category: 'PRINT' as const,
    quantity: 100,
    unitPriceVnd: 5000,
    lineTotalVnd: 500000,
  };
  const binding = {
    agreementRevisionId: revisionId,
    offeringId: line.sourceId,
    sourceRevisionId: line.sourceRevisionId,
  };
  const snapshot = {
    ...binding,
    templateVersionId,
    material: 'Giấy mỹ thuật',
    printType: 'COLOR',
    unitPriceVnd: 5000,
  };
  const effective = {
    getEffective: vi.fn().mockResolvedValue({ revisionId, lines: [line] }),
    resolveAppendix: vi.fn(),
  };
  const offerings = {
    resolveRevision: vi.fn().mockResolvedValue({
      offeringId: line.sourceId,
      templateVersionId,
      material: snapshot.material,
      printType: snapshot.printType,
      unitPriceVnd: 5000,
    }),
  };
  const client = {
    invitationDesign: { findFirst: vi.fn().mockResolvedValue({ currentRevisionId: randomUUID() }) },
    invitationDesignRevision: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ sourceTemplateVersionId: templateVersionId }),
    },
    invitationPrintLine: {
      findMany: vi
        .fn()
        .mockResolvedValue([
          { id: lineId, orderId, bookingId, designId, quantity: 60, commercialSource: snapshot },
        ]),
    },
    invitationPrintOrder: { findMany: vi.fn().mockResolvedValue([{ id: orderId }]) },
  };
  const owners = {
    commercial: () => effective,
    model: vi.fn().mockResolvedValue('FULL_CONTRACT_V1'),
    offerings: () => offerings,
    contractObligation: vi.fn().mockResolvedValue(randomUUID()),
  };
  const service = new ContractedPrintFulfillment(owners);
  return {
    client: client as unknown as PrismaClient,
    stubs: client,
    owners,
    effective,
    offerings,
    service,
    bookingId,
    designId,
    orderId,
    lineId,
    line,
    binding,
    snapshot,
    templateVersionId,
  };
}
it('distinguishes legacy fulfillment and validates exact frozen offering and template sources', async () => {
  const f = fixture();
  await expect(f.service.snapshot(f.client, f.bookingId, f.designId, 60)).rejects.toMatchObject({
    code: 'CONTRACT_FULFILLMENT_REQUIRED',
  });
  expect(await f.service.snapshot(f.client, f.bookingId, f.designId, 60, f.binding)).toEqual(
    f.snapshot,
  );
  await expect(
    f.service.requireTemplate(f.client, f.bookingId, f.templateVersionId),
  ).resolves.toBeUndefined();
  await expect(
    f.service.requireTemplate(f.client, f.bookingId, randomUUID()),
  ).rejects.toMatchObject({ code: 'CONTRACT_PRINT_TEMPLATE_CONFLICT' });
  f.stubs.invitationDesign.findFirst.mockResolvedValueOnce(null);
  await expect(
    f.service.snapshot(f.client, f.bookingId, f.designId, 60, f.binding),
  ).rejects.toMatchObject({ code: 'CONTRACT_PRINT_SOURCE_CONFLICT' });
  f.stubs.invitationDesignRevision.findUniqueOrThrow.mockResolvedValueOnce({
    sourceTemplateVersionId: randomUUID(),
  });
  await expect(
    f.service.snapshot(f.client, f.bookingId, f.designId, 60, f.binding),
  ).rejects.toMatchObject({ code: 'CONTRACT_PRINT_TEMPLATE_CONFLICT' });
  f.effective.getEffective.mockResolvedValueOnce({
    revisionId: f.binding.agreementRevisionId,
    lines: [],
  });
  await expect(
    f.service.snapshot(f.client, f.bookingId, f.designId, 60, f.binding),
  ).rejects.toMatchObject({ code: 'CONTRACT_PRINT_SOURCE_CONFLICT' });
  f.owners.model.mockResolvedValue('LEGACY_PROPOSAL_V1');
  expect(await f.service.snapshot(f.client, f.bookingId, f.designId, 60)).toBeNull();
  await expect(
    f.service.snapshot(f.client, f.bookingId, f.designId, 60, f.binding),
  ).rejects.toMatchObject({ code: 'CONTRACT_PRINT_SOURCE_CONFLICT' });
  expect(await f.service.validateOrder(f.client, f.bookingId, f.orderId)).toBeNull();
});
it('sums active allocations and preserves production on unchanged lines after an unrelated appendix', async () => {
  const f = fixture();
  expect(await f.service.validateOrder(f.client, f.bookingId, f.orderId)).toBe(
    await f.owners.contractObligation(),
  );
  await expect(
    f.service.validateOrder(f.client, f.bookingId, f.orderId, new Map([[f.lineId, 1]])),
  ).rejects.toMatchObject({ code: 'CONTRACT_PRINT_SOURCE_CONFLICT' });
  f.stubs.invitationPrintLine.findMany.mockResolvedValueOnce([
    {
      id: f.lineId,
      orderId: f.orderId,
      bookingId: f.bookingId,
      designId: f.designId,
      quantity: 60,
      commercialSource: null,
    },
  ]);
  await expect(f.service.validateOrder(f.client, f.bookingId, f.orderId)).rejects.toMatchObject({
    code: 'CONTRACT_FULFILLMENT_REQUIRED',
  });
  f.effective.getEffective.mockResolvedValueOnce({ revisionId: randomUUID(), lines: [f.line] });
  await expect(f.service.validateOrder(f.client, f.bookingId, f.orderId)).rejects.toMatchObject({
    code: 'CONTRACT_PRINT_SOURCE_CONFLICT',
  });
  f.effective.getEffective.mockResolvedValue({ revisionId: randomUUID(), lines: [f.line] });
  await expect(
    f.service.validateOrder(f.client, f.bookingId, f.orderId, undefined, false),
  ).resolves.toBeDefined();
});
