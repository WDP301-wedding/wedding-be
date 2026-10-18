import type { VenueCatalogReader } from '../../venue-catalog/application/venue-catalog.provider.js';
import { createProposalSnapshot, proposalMenuSelections } from '../domain/booking-policy.js';
import type { ProposalCatalogPort } from './consultation.service.js';

export function createProposalCatalogAdapter(catalog: VenueCatalogReader): ProposalCatalogPort {
  return Object.freeze({
    async resolveProposal(input: Parameters<ProposalCatalogPort['resolveProposal']>[0]) {
      const selections = proposalMenuSelections(input);
      const [hall, shift, menus] = await Promise.all([
        catalog.requireActiveHallSnapshot(input.hallId),
        catalog.requireActiveShiftSnapshot(input.shiftCode),
        Promise.all(
          selections.map(async (line) => ({
            menu: await catalog.resolveMenuPackageVersion(line.menuPackageVersionId),
            tableCount: line.tableCount,
          })),
        ),
      ]);

      return createProposalSnapshot({
        hall,
        shift,
        menus,
        eventDate: input.eventDate,
        planningHeadcount: input.planningHeadcount,
      });
    },
  });
}
