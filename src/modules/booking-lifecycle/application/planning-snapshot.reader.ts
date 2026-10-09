import type { ContractContext } from '../../../core/database/booking-boundary.js';
export interface BookingPlanningSnapshotReader {
  getCurrent(
    bookingId: string,
    context: ContractContext,
  ): Promise<
    Readonly<{
      bookingId: string;
      bookingRevision: number;
      planningHeadcount: number;
    }>
  >;
}
