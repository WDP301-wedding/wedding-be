import type { ContractContext } from '../../../core/database/booking-boundary.js';
import type { GuestRequestContext } from '../../guest-management/application/guest.contracts.js';
export type StaffRequestContext = GuestRequestContext;
export type { StaffAccountProvisioner } from '../../identity-access/account/staff-provisioner.contracts.js';
export interface StaffSeatingGuidance {
  getGuidance(
    bookingId: string,
    context: ContractContext,
  ): Promise<{
    seatingPlanRevisionId: string | null;
    status: 'DRAFT' | 'CONFIRMED' | 'REQUIRES_REVIEW' | 'ABSENT';
    groups: readonly {
      guestGroupId: string;
      groupName: string;
      color: string;
      tableLabels: readonly string[];
    }[];
  }>;
}
