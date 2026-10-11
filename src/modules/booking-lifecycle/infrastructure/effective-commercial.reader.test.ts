import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import { commercialDocumentFixture } from '../../../../tests/fixtures/commercial-contract.js';
import { documentDigest } from '../domain/commercial-contract.js';
import { appendixDigest, appendixDocumentSchema } from '../domain/commercial-appendix.js';
import { createEffectiveCommercialReader } from './effective-commercial.reader.js';

function fixture() {
  const original = commercialDocumentFixture(),
    rootId = randomUUID(),
    id = randomUUID();
  const document = appendixDocumentSchema.parse({
    bookingId: original.bookingId,
    contractRevisionId: rootId,
    brideName: original.brideName,
    groomName: original.groomName,
    tableCount: 9,
    predecessorRevisionId: rootId,
    reason: 'Giảm bàn',
    beforeLines: original.lines,
    afterLines: [{ ...original.lines[0]!, quantity: 9, lineTotalVnd: 31500000 }],
    beforeTotalVnd: 35000000,
    afterTotalVnd: 31500000,
    deltaVnd: -3500000,
  });
  const digest = appendixDigest(document),
    approvals = [
      { party: 'MANAGER', actorAccountId: randomUUID(), documentDigest: digest },
      { party: 'COUPLE', actorAccountId: randomUUID(), documentDigest: digest },
    ];
  const row = {
    id,
    state: 'APPROVED',
    approvedAt: new Date(),
    document,
    documentDigest: digest,
    approvals,
    deltaVnd: new Prisma.Decimal(-3500000),
    effectiveTotalVnd: new Prisma.Decimal(31500000),
  };
  const findAppendix = vi.fn().mockResolvedValue(row),
    settlement = vi.fn().mockResolvedValue({ contractRevisionId: rootId });
  const head = vi.fn().mockResolvedValue({ effectiveRevisionId: id });
  const client = {
    commercialAppendixRevision: {
      findFirst: findAppendix,
      findMany: vi.fn().mockResolvedValue([row]),
    },
    bookingDepositSettlement: { findUnique: settlement },
    commercialAppendixHead: { findUnique: head },
    commercialContractRevision: {
      findFirst: vi.fn().mockResolvedValue({
        id: rootId,
        document: original,
        documentDigest: documentDigest(original),
        approvedAt: new Date(),
        contractTotalVnd: new Prisma.Decimal(35000000),
        depositAmountVnd: new Prisma.Decimal(10500000),
        approvals: approvals.map((a) => ({ ...a, documentDigest: documentDigest(original) })),
      }),
    },
  } as unknown as PrismaClient;
  return {
    reader: createEffectiveCommercialReader(client),
    row,
    findAppendix,
    settlement,
    head,
    bookingId: original.bookingId,
  };
}
it('rejects incomplete, duplicated or corrupted approvals before exposing an effective obligation', async () => {
  const f = fixture();
  await expect(f.reader.resolveAppendix(f.bookingId, f.row.id)).resolves.toMatchObject({
    revisionId: f.row.id,
  });
  for (const patch of [
    { state: 'DRAFT' },
    { approvedAt: null },
    { approvals: [] },
    { approvals: [f.row.approvals[0], f.row.approvals[0]] },
    {
      approvals: [
        { ...f.row.approvals[0], actorAccountId: f.row.approvals[1]!.actorAccountId },
        f.row.approvals[1],
      ],
    },
    { approvals: [{ ...f.row.approvals[0], documentDigest: '0'.repeat(64) }, f.row.approvals[1]] },
    { documentDigest: '0'.repeat(64) },
    { deltaVnd: new Prisma.Decimal(1) },
    { effectiveTotalVnd: new Prisma.Decimal(1) },
  ]) {
    f.findAppendix.mockResolvedValueOnce({ ...f.row, ...patch });
    await expect(f.reader.resolveAppendix(f.bookingId, f.row.id)).rejects.toMatchObject({
      code: 'APPENDIX_APPROVAL_REQUIRED',
    });
  }
  f.findAppendix.mockResolvedValueOnce(null);
  await expect(f.reader.resolveAppendix(f.bookingId, randomUUID())).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
});
it('requires a settled root, a contiguous approved chain and the exact effective head', async () => {
  const f = fixture();
  const result = await f.reader.getEffective(f.bookingId);
  expect(result.totalVnd).toBe(31500000);
  expect(Object.isFrozen(result.lines)).toBe(true);
  f.settlement.mockResolvedValueOnce(null);
  await expect(f.reader.getEffective(f.bookingId)).rejects.toMatchObject({
    code: 'SETTLED_CONTRACT_REQUIRED',
  });
  f.head.mockResolvedValueOnce({ effectiveRevisionId: randomUUID() });
  await expect(f.reader.getEffective(f.bookingId)).rejects.toMatchObject({
    code: 'FINANCIAL_SOURCE_CONFLICT',
  });
  const document = { ...f.row.document, predecessorRevisionId: randomUUID() },
    digest = appendixDigest(document);
  f.findAppendix.mockResolvedValueOnce({
    ...f.row,
    document,
    documentDigest: digest,
    approvals: f.row.approvals.map((a) => ({ ...a, documentDigest: digest })),
  });
  await expect(f.reader.getEffective(f.bookingId)).rejects.toMatchObject({
    code: 'FINANCIAL_SOURCE_CONFLICT',
  });
});
