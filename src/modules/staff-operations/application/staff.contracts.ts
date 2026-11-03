import type { z } from 'zod';
import type { seatingRenderSchema } from '../../invitation-studio/domain/studio-policy.js';
import type { ContractContext } from '../../../core/database/booking-boundary.js';
import type { GuestRequestContext } from '../../guest-management/application/guest.contracts.js';
export type StaffRequestContext = GuestRequestContext;
export type { StaffAccountProvisioner } from '../../identity-access/account/staff-provisioner.contracts.js';
export interface StaffSeatingGuidance {
  getOperationalPlan?(
    bookingId: string,
    context: ContractContext,
  ): Promise<{
    status: 'ABSENT' | 'DRAFT' | 'CONFIRMED' | 'REQUIRES_REVIEW';
    renderSnapshot: z.infer<typeof seatingRenderSchema>;
  }>;
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
