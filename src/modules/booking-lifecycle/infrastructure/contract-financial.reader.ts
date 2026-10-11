import type { PrismaClient, Prisma } from '../../../generated/prisma/client.js';
import { NotFoundError } from '../../../core/errors/app-error.js';
import type { CommercialContractReader } from '../application/commercial-contract.port.js';
import {
  contractDocumentSchema,
  documentDigest,
  contractDeposit,
  checkedSum,
  commercialConflict,
  deepFreeze,
} from '../domain/commercial-contract.js';
export function createContractFinancialReader(
  prisma: Pick<
    PrismaClient | Prisma.TransactionClient,
    'commercialContractRevision' | 'commercialContract'
  >,
): CommercialContractReader {
  return Object.freeze({
    async getModel(bookingId: string) {
      return (await prisma.commercialContract.findUnique({ where: { bookingId } })) === null
        ? ('LEGACY_PROPOSAL_V1' as const)
        : ('FULL_CONTRACT_V1' as const);
    },
    async resolveApproved(bookingId: string, revisionId: string) {
      const row = await prisma.commercialContractRevision.findFirst({
        where: { id: revisionId, bookingId },
        include: { approvals: true },
      });
      if (row === null) throw new NotFoundError();
      const document = contractDocumentSchema.parse(row.document);
      if (
        row.approvedAt === null ||
        row.approvals.length !== 2 ||
        document.brideName === null ||
        document.groomName === null ||
        documentDigest(document) !== row.documentDigest ||
        row.approvals.some((approval) => approval.documentDigest !== row.documentDigest) ||
        new Set(row.approvals.map((approval) => approval.party)).size !== 2 ||
        new Set(row.approvals.map((approval) => approval.actorAccountId)).size !== 2 ||
        document.contractTotalVnd !== row.contractTotalVnd.toNumber() ||
        checkedSum(document.lines.map((line) => line.lineTotalVnd)) !== document.contractTotalVnd ||
        contractDeposit(document.contractTotalVnd) !== row.depositAmountVnd.toNumber()
      )
        throw commercialConflict('CONTRACT_APPROVAL_REQUIRED');
      return deepFreeze({
        bookingId,
        contractRevisionId: row.id,
        timelineRevisionId: row.timelineRevisionId,
        documentDigest: row.documentDigest,
        contractTotalVnd: document.contractTotalVnd,
        depositAmountVnd: document.depositAmountVnd,
        approvedAt: row.approvedAt.toISOString(),
        document,
      });
    },
  });
}
