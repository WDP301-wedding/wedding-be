import type { VenueCatalogReader } from '../../venue-catalog/application/venue-catalog.provider.js';
import { createProposalSnapshot } from '../domain/booking-policy.js';
import type { ProposalCatalogPort } from './consultation.service.js';

export function createProposalCatalogAdapter(catalog: VenueCatalogReader): ProposalCatalogPort {
  return Object.freeze({
    async resolveProposal(input: Parameters<ProposalCatalogPort['resolveProposal']>[0]) {
      const [hall, shift, menu] = await Promise.all([
        catalog.requireActiveHallSnapshot(input.hallId),
        catalog.requireActiveShiftSnapshot(input.shiftCode),
        catalog.resolveMenuPackageVersion(input.menuPackageVersionId),
      ]);

      return createProposalSnapshot({
        hall,
        shift,
        menu,
        eventDate: input.eventDate,
        tableCount: input.tableCount,
        planningHeadcount: input.planningHeadcount,
      });
    },
  });
}
