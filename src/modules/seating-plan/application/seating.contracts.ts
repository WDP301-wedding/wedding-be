import type { ContractContext } from '../../../core/database/booking-boundary.js';
import type { GuestRequestContext } from '../../guest-management/application/guest.contracts.js';
export type SeatingRequestContext = GuestRequestContext;
export interface SeatingPlanReader {
  requireCurrentPlan(bookingId: string): Promise<
    Readonly<{
      seatingPlanId: string;
      revisionId: string;
      status: 'DRAFT' | 'CONFIRMED' | 'REQUIRES_REVIEW';
      layoutTemplateVersionId: string;
      expectedAttendees: number;
      labels: readonly Readonly<{
        layoutTableId: string;
        guestGroupId: string;
        colorSnapshot: string;
      }>[];
    }>
  >;
  resolveRevision(revisionId: string): Promise<
    Readonly<{
      bookingId: string;
      layoutTemplateVersionId: string;
      labels: readonly Readonly<{
        layoutTableId: string;
        guestGroupId: string;
        colorSnapshot: string;
      }>[];
    }>
  >;
}
export interface SeatingGuidanceReader {
  getGuidance(
    bookingId: string,
    context: ContractContext,
  ): Promise<
    Readonly<{
      seatingPlanRevisionId: string | null;
      status: 'DRAFT' | 'CONFIRMED' | 'REQUIRES_REVIEW' | 'ABSENT';
      groups: readonly Readonly<{
        guestGroupId: string;
        groupName: string;
        color: string;
        tableLabels: readonly string[];
      }>[];
    }>
  >;
}
/** The Staff owner must validate assignment/window/session before supplying scope. */
export interface SeatingStaffAccess {
  requireAssignedOperationsAccess(bookingId: string, context: ContractContext): Promise<void>;
}
