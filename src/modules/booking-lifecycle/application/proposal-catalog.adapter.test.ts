/* eslint-disable @typescript-eslint/unbound-method -- Vitest intentionally inspects method spies. */
import { describe, expect, it, vi } from 'vitest';

import type { VenueCatalogReader } from '../../venue-catalog/application/venue-catalog.provider.js';
import { createProposalCatalogAdapter } from './proposal-catalog.adapter.js';

describe('ProposalCatalogAdapter', () => {
  it('resolves active venue facts and an exact immutable menu version', async () => {
    const catalog = {
      requireActiveHallSnapshot: vi.fn().mockResolvedValue({
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Garden Hall',
        description: 'Garden venue',
        maxGuests: 500,
      }),
      requireActiveShiftSnapshot: vi.fn().mockResolvedValue({
        code: 'DINNER',
        startTime: '17:30',
        endTime: '22:00',
      }),
      resolveMenuPackageVersion: vi.fn().mockResolvedValue({
        id: '00000000-0000-4000-8000-000000000002',
        menuPackageId: '00000000-0000-4000-8000-000000000003',
        versionNumber: 2,
        state: 'SUPERSEDED',
        revision: 4,
        name: 'Autumn menu',
        description: 'Published menu snapshot',
        priceVndPerTable: 5_000_001,
        items: [],
      }),
    } as unknown as VenueCatalogReader;

    const proposal = await createProposalCatalogAdapter(catalog).resolveProposal({
      hallId: '00000000-0000-4000-8000-000000000001',
      eventDate: '2026-12-20',
      shiftCode: 'DINNER',
      menuPackageVersionId: '00000000-0000-4000-8000-000000000002',
      tableCount: 3,
      planningHeadcount: 25,
    });

    expect(catalog.requireActiveHallSnapshot).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
    );
    expect(catalog.requireActiveShiftSnapshot).toHaveBeenCalledWith('DINNER');
    expect(catalog.resolveMenuPackageVersion).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000002',
    );
    expect(proposal).toMatchObject({
      baseChargeVnd: 15_000_003,
      depositAmountVnd: 4_500_001,
      eventDate: '2026-12-20',
    });
    expect(Object.isFrozen(proposal.menu)).toBe(true);
  });
});
