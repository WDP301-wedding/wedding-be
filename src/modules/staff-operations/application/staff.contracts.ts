import type { ContractContext } from '../../../core/database/booking-boundary.js';
import type { GuestRequestContext } from '../../guest-management/application/guest.contracts.js';
export type StaffRequestContext = GuestRequestContext;
export interface StaffAccountProvisioner {
  provision(
    email: string,
    key: string,
    context: StaffRequestContext,
  ): Promise<{ accountId: string; credentialSetupRequired: boolean }>;
  setOperationalAccess(
    accountId: string,
    input: { enabled: boolean; reason: string },
    key: string,
    context: StaffRequestContext,
  ): Promise<{ accountId: string; enabled: boolean }>;
}
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
