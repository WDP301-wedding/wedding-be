import type { ContractContext } from './deposit.service.js';

export type TimelineSnapshot = Readonly<{
  bookingId: string;
  timelineRevisionId: string;
  revisionNumber: number;
  eventDate: string;
  hallName: string;
  shiftCode: 'LUNCH' | 'DINNER';
  shiftStartTime: string;
  shiftEndTime: string;
  items: readonly Readonly<{
    itemId: string;
    order: number;
    startTime: string;
    title: string;
    description: string | null;
  }>[];
  approvedByManagerAt: string;
  approvedByCoupleAt: string;
  isEffective: boolean;
}>;

export interface BookingTimelineSnapshotReader {
  resolveApprovedRevision(
    input: Readonly<{ bookingId: string; timelineRevisionId: string }>,
    context: ContractContext,
  ): Promise<TimelineSnapshot>;
}

export interface BookingCommercialSnapshotReader {
  getAccepted(
    input: Readonly<{ bookingId: string; timelineRevisionId: string }>,
    context: ContractContext,
  ): Promise<
    Readonly<{
      bookingId: string;
      commercialRevisionId: string;
      bookingRevision: number;
      baseChargeVnd: number;
      depositAmountVnd: number;
      menuPackageVersionId: string;
      tableCount: number;
      acceptedAt: string;
    }>
  >;
}

export interface BookingPlanningSnapshotReader {
  getCurrent(
    bookingId: string,
    context: ContractContext,
  ): Promise<Readonly<{ bookingId: string; bookingRevision: number; planningHeadcount: number }>>;
}

export type SourceQuery = Readonly<{
  afterSequence: number;
  throughSequence?: number;
  cursor?: string;
  limit: number;
}>;

export type SourcePage<T> = Readonly<{
  throughSequence: number;
  nextCursor: string | null;
  rows: readonly Readonly<{
    recordId: string;
    sequence: number;
    changedAt: string;
    value: T;
  }>[];
}>;

export type BookingReportRow = Readonly<{
  bookingId: string;
  phase: 'DRAFT' | 'AWAITING_DEPOSIT' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';
  eventDate: string;
  hallId: string;
  hallNameSnapshot: string;
  shiftCode: 'LUNCH' | 'DINNER';
  menuPackageId: string | null;
  menuNameSnapshot: string | null;
  tableCount: number;
  baseChargeVnd: number;
  confirmedAt: string | null;
  cancelledAt: string | null;
}>;

export interface BookingReportingReader {
  readPage(query: SourceQuery, context: ContractContext): Promise<SourcePage<BookingReportRow>>;
}
