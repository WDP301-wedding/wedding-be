import type { ContractContext } from '../../../core/database/booking-boundary.js';
import type { PrintOrderStatus } from '../domain/print-policy.js';

export type SourceQuery = Readonly<{
  afterSequence: number;
  throughSequence?: number;
  cursor?: string;
  limit: number;
}>;

export type SourceRow<T> = Readonly<{
  recordId: string;
  sequence: number;
  changedAt: string;
  value: T;
}>;

export type SourcePage<T> = Readonly<{
  throughSequence: number;
  nextCursor: string | null;
  rows: readonly SourceRow<T>[];
}>;

export type InvitationReportRow = Readonly<{
  bookingId: string;
  printOrderId: string;
  status: PrintOrderStatus;
  commercialRevisionId: string | null;
  receivableChargeId: string | null;
  acceptedAmountVnd: number;
  approvedAt: string | null;
  updatedAt: string;
}>;

export interface InvitationReportingReader {
  readPage(
    query: SourceQuery,
    context: ContractContext,
  ): Promise<SourcePage<InvitationReportRow>>;
}
