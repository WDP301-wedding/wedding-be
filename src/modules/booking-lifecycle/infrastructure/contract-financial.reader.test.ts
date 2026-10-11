import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import { commercialDocumentFixture } from '../../../../tests/fixtures/commercial-contract.js';
import { documentDigest } from '../domain/commercial-contract.js';
import { createContractFinancialReader } from './contract-financial.reader.js';
function fixture() {
  const document = commercialDocumentFixture(),
    digest = documentDigest(document);
  const row = {
    id: randomUUID(),
    bookingId: document.bookingId,
    timelineRevisionId: document.timelineRevisionId,
    document,
    documentDigest: digest,
    approvedAt: new Date('2026-10-11T00:00:00Z') as Date | null,
    contractTotalVnd: new Prisma.Decimal(document.contractTotalVnd),
    depositAmountVnd: new Prisma.Decimal(document.depositAmountVnd),
    approvals: [
      { party: 'MANAGER', actorAccountId: randomUUID(), documentDigest: digest },
      { party: 'COUPLE', actorAccountId: randomUUID(), documentDigest: digest },
    ],
    state: 'SUPERSEDED',
  };
  const revision = vi.fn().mockResolvedValue(row),
    head = vi.fn().mockResolvedValue(null);
  const prisma = {
    commercialContractRevision: { findFirst: revision },
    commercialContract: { findUnique: head },
  } as unknown as PrismaClient;
  return { row, revision, head, reader: createContractFinancialReader(prisma) };
}
describe('historical approved commercial financial facts', () => {
  it('returns explicit legacy/full model identity', async () => {
    const f = fixture();
    await expect(f.reader.getModel(f.row.bookingId)).resolves.toBe('LEGACY_PROPOSAL_V1');
    f.head.mockResolvedValue({ bookingId: f.row.bookingId });
    await expect(f.reader.getModel(f.row.bookingId)).resolves.toBe('FULL_CONTRACT_V1');
  });
  it('resolves a retained approved snapshot after supersession and freezes its facts', async () => {
    const f = fixture(),
      s = await f.reader.resolveApproved(f.row.bookingId, f.row.id);
    expect(s).toMatchObject({
      contractTotalVnd: 35000000,
      depositAmountVnd: 10500000,
      approvedAt: '2026-10-11T00:00:00.000Z',
    });
    expect(Object.isFrozen(s.document.lines[0])).toBe(true);
    expect(f.revision).toHaveBeenCalledWith({
      where: { id: f.row.id, bookingId: f.row.bookingId },
      include: { approvals: true },
    });
  });
  it('conceals a missing revision', async () => {
    const f = fixture();
    f.revision.mockResolvedValue(null);
    await expect(f.reader.resolveApproved(f.row.bookingId, f.row.id)).rejects.toMatchObject({
      status: 404,
    });
  });
  const mutations: readonly [string, (row: ReturnType<typeof fixture>['row']) => void][] = [
    [
      'not approved',
      (r) => {
        r.approvedAt = null;
      },
    ],
    [
      'one approval',
      (r) => {
        r.approvals.pop();
      },
    ],
    [
      'missing bride',
      (r) => {
        r.document.brideName = null;
      },
    ],
    [
      'missing groom',
      (r) => {
        r.document.groomName = null;
      },
    ],
    [
      'document digest mismatch',
      (r) => {
        r.documentDigest = 'b'.repeat(64);
      },
    ],
    [
      'approval digest mismatch',
      (r) => {
        r.approvals[0]!.documentDigest = 'b'.repeat(64);
      },
    ],
    [
      'duplicate party',
      (r) => {
        r.approvals[1]!.party = 'MANAGER';
      },
    ],
    [
      'same actor',
      (r) => {
        r.approvals[1]!.actorAccountId = r.approvals[0]!.actorAccountId;
      },
    ],
    [
      'persisted total mismatch',
      (r) => {
        r.contractTotalVnd = new Prisma.Decimal(1);
      },
    ],
    [
      'line total mismatch',
      (r) => {
        r.document.lines[0]!.lineTotalVnd = 1;
        r.documentDigest = documentDigest(r.document);
        for (const a of r.approvals) a.documentDigest = r.documentDigest;
      },
    ],
    [
      'deposit mismatch',
      (r) => {
        r.depositAmountVnd = new Prisma.Decimal(1);
      },
    ],
  ];
  it.each(mutations)('rejects %s', async (_label, mutate) => {
    const f = fixture();
    mutate(f.row);
    await expect(f.reader.resolveApproved(f.row.bookingId, f.row.id)).rejects.toMatchObject({
      status: 409,
      code: 'CONTRACT_APPROVAL_REQUIRED',
    });
  });
});
