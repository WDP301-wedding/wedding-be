import type { Prisma } from '../../../generated/prisma/client.js';
import { checkedSum, contractLineSchema } from '../domain/commercial-contract.js';

export const commercialSummarySelect = {
  commercialContract: {
    select: {
      currentRevision: {
        select: {
          id: true,
          state: true,
          document: true,
          documentDigest: true,
          contractTotalVnd: true,
          depositAmountVnd: true,
          approvals: { select: { party: true, actorAccountId: true, documentDigest: true } },
        },
      },
    },
  },
  commercialAppendices: {
    select: {
      effectiveRevision: {
        select: {
          id: true,
          state: true,
          document: true,
          documentDigest: true,
          approvals: { select: { party: true, actorAccountId: true, documentDigest: true } },
        },
      },
    },
  },
} satisfies Prisma.BookingSelect;

type Revision = {
  state: string;
  document: unknown;
  documentDigest: string;
  approvals: readonly { party: string; actorAccountId: string; documentDigest: string }[];
};
export function mutuallyApproved(row: Revision | null | undefined): row is Revision {
  return (
    row?.state === 'APPROVED' &&
    row.approvals.length === 2 &&
    new Set(row.approvals.map((a) => a.party)).size === 2 &&
    row.approvals.some((a) => a.party === 'MANAGER') &&
    row.approvals.some((a) => a.party === 'COUPLE') &&
    new Set(row.approvals.map((a) => a.actorAccountId)).size === 2 &&
    row.approvals.every((a) => a.documentDigest === row.documentDigest)
  );
}

/** Read-only projection. Never overwrites the proposal or any approved document. */
export function commercialSummary(row: {
  proposalSnapshot: { tableCount: number } | null;
  commercialContract?: { currentRevision: Revision | null } | null;
  commercialAppendices?: { effectiveRevision: Revision | null } | null;
}) {
  const appendix = row.commercialAppendices?.effectiveRevision;
  const contract = row.commercialContract?.currentRevision;
  const source = mutuallyApproved(appendix)
    ? 'APPENDIX'
    : mutuallyApproved(contract)
      ? 'CONTRACT'
      : 'PROPOSAL';
  const revision = source === 'APPENDIX' ? appendix : source === 'CONTRACT' ? contract : null;
  if (!revision)
    return {
      source,
      tableCount: row.proposalSnapshot?.tableCount ?? 0,
      lines: null,
      totalVnd: null,
    };
  const document = revision.document as { lines?: unknown; afterLines?: unknown };
  const lines = contractLineSchema
    .array()
    .parse(source === 'APPENDIX' ? document.afterLines : document.lines);
  return {
    source,
    lines,
    tableCount: checkedSum(lines.filter((l) => l.category === 'MENU').map((l) => l.quantity)),
    totalVnd: checkedSum(lines.map((l) => l.lineTotalVnd)),
  };
}
