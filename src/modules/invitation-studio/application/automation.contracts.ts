import type { ContractContext } from '../../../core/database/booking-boundary.js';

export interface MediaCutoffItem {
  readonly bookingId: string;
  readonly cutoffAt: string;
  readonly policyRevision: number;
  readonly coupleAccountId: string;
}

export interface ListMediaCutoffsInput {
  readonly dueBefore: string;
  readonly cursor?: string;
  readonly limit: number;
}

export interface ListMediaCutoffsResult {
  readonly nextCursor: string | null;
  readonly items: readonly MediaCutoffItem[];
}

export interface InvitationAutomationReader {
  readMediaCutoff(
    bookingId: string,
    context: ContractContext,
  ): Promise<{
    bookingId: string;
    cutoffAt: string;
    policyRevision: number;
  } | null>;
  listMediaCutoffs(
    input: ListMediaCutoffsInput,
    context: ContractContext,
  ): Promise<ListMediaCutoffsResult>;
}
