import type { ContractContext } from './deposit.service.js';
import type { ContractDocument } from '../domain/commercial-contract.js';
export type ApprovedCommercialContract = Readonly<{
  bookingId: string;
  contractRevisionId: string;
  timelineRevisionId: string;
  documentDigest: string;
  contractTotalVnd: number;
  depositAmountVnd: number;
  approvedAt: string;
  document: ContractDocument;
}>;
export interface CommercialContractReader {
  getModel(bookingId: string): Promise<'LEGACY_PROPOSAL_V1' | 'FULL_CONTRACT_V1'>;
  resolveApproved(
    bookingId: string,
    revisionId: string,
    context?: ContractContext,
  ): Promise<ApprovedCommercialContract>;
}
