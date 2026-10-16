import type { ContractContext } from '../../../core/database/booking-boundary.js';

export type LayoutEligibility = Readonly<{
  layoutTemplateVersionId: string;
  hallId: string;
  templateActive: boolean;
  hallActive: boolean;
  currentForNewSelection: boolean;
  hallMaxGuests: number;
  totalSeatCapacity: number;
}>;

export interface VenueSelectionEligibilityReader {
  getLayoutEligibility(
    layoutTemplateVersionId: string,
    context: ContractContext,
  ): Promise<LayoutEligibility>;
  getLayoutEligibilities?(
    layoutTemplateVersionIds: readonly string[],
    context: ContractContext,
  ): Promise<readonly LayoutEligibility[]>;
}
