import type { ContractContext } from '../../../core/database/booking-boundary.js';

export interface VenueSelectionEligibilityReader {
  getLayoutEligibility(
    layoutTemplateVersionId: string,
    context: ContractContext,
  ): Promise<
    Readonly<{
      layoutTemplateVersionId: string;
      hallId: string;
      templateActive: boolean;
      hallActive: boolean;
      currentForNewSelection: boolean;
      hallMaxGuests: number;
      totalSeatCapacity: number;
    }>
  >;
}
