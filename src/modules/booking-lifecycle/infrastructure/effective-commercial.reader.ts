import type { PrismaClient, Prisma } from '../../../generated/prisma/client.js';
import { NotFoundError } from '../../../core/errors/app-error.js';
import { createContractFinancialReader } from './contract-financial.reader.js';
import {
  appendixDocumentSchema,
  appendixDigest,
  calculateAppendixChange,
} from '../domain/commercial-appendix.js';
import { commercialConflict, deepFreeze } from '../domain/commercial-contract.js';

export function createEffectiveCommercialReader(client: PrismaClient | Prisma.TransactionClient) {
  return Object.freeze({
    async resolveAppendix(bookingId: string, revisionId: string) {
      const row = await client.commercialAppendixRevision.findFirst({
        where: { id: revisionId, bookingId },
        include: { approvals: true },
      });
      if (row === null) throw new NotFoundError();
      const document = appendixDocumentSchema.parse(row.document);
      const change = calculateAppendixChange(document.beforeLines, document.afterLines);
      if (
        row.state !== 'APPROVED' ||
        row.approvedAt === null ||
        row.approvals.length !== 2 ||
        new Set(row.approvals.map((a) => a.party)).size !== 2 ||
        new Set(row.approvals.map((a) => a.actorAccountId)).size !== 2 ||
        row.approvals.some((a) => a.documentDigest !== row.documentDigest) ||
        appendixDigest(document) !== row.documentDigest ||
        change.deltaVnd !== row.deltaVnd.toNumber() ||
        change.afterTotalVnd !== row.effectiveTotalVnd.toNumber()
      )
        throw commercialConflict('APPENDIX_APPROVAL_REQUIRED');
      return deepFreeze({
        revisionId: row.id,
        documentDigest: row.documentDigest,
        approvedAt: row.approvedAt.toISOString(),
        document,
      });
    },
    async getEffective(bookingId: string) {
      const settlement = await client.bookingDepositSettlement.findUnique({ where: { bookingId } });
      if (!settlement?.contractRevisionId) throw commercialConflict('SETTLED_CONTRACT_REQUIRED');
      const contract = await createContractFinancialReader(client).resolveApproved(
        bookingId,
        settlement.contractRevisionId,
      );
      const head = await client.commercialAppendixHead.findUnique({ where: { bookingId } });
      const rows = await client.commercialAppendixRevision.findMany({
        where: { bookingId, state: 'APPROVED' },
        orderBy: { revisionNumber: 'asc' },
      });
      const appendices = [];
      let revisionId = contract.contractRevisionId,
        lines = contract.document.lines,
        totalVnd = contract.contractTotalVnd;
      for (const row of rows) {
        const appendix = await this.resolveAppendix(bookingId, row.id);
        if (
          appendix.document.predecessorRevisionId !== revisionId ||
          appendix.document.beforeTotalVnd !== totalVnd ||
          JSON.stringify(appendix.document.beforeLines) !== JSON.stringify(lines)
        )
          throw commercialConflict('FINANCIAL_SOURCE_CONFLICT');
        appendices.push(appendix);
        revisionId = row.id;
        lines = appendix.document.afterLines;
        totalVnd = appendix.document.afterTotalVnd;
      }
      if ((head?.effectiveRevisionId ?? null) !== (appendices.at(-1)?.revisionId ?? null))
        throw commercialConflict('FINANCIAL_SOURCE_CONFLICT');
      return deepFreeze({ bookingId, contract, appendices, revisionId, lines, totalVnd });
    },
  });
}
export type EffectiveCommercialReader = ReturnType<typeof createEffectiveCommercialReader>;
