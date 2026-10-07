import { describe, expect, it, vi } from 'vitest';

import type { ProposalSnapshot } from '../domain/booking-policy.js';
import {
  createConsultationWorkspaceService,
  type ConsultationWorkspaceRepository,
  type ProposalCatalogPort,
} from './consultation-workspace.service.js';

describe('ConsultationWorkspaceService', () => {
  it('creates the consultation before any proposal or invitation exists', async () => {
    const repository = repositoryFixture();
    const service = createConsultationWorkspaceService({
      repository,
      catalog: catalogFixture(),
      createId: () => '00000000-0000-4000-8000-000000000001',
    });
    await service.createConsultation({
      intendedEmail: 'couple@example.com',
      displayName: 'Minh and An',
      note: null,
      managerAccountId: 'manager',
      requestId: 'request',
    });
    expect(repository.createConsultation).toHaveBeenCalledWith(
      expect.objectContaining({ consultationId: '00000000-0000-4000-8000-000000000001' }),
    );
  });

  it('creates a booking from exact venue snapshots under an existing consultation', async () => {
    const repository = repositoryFixture();
    const service = createConsultationWorkspaceService({
      repository,
      catalog: catalogFixture(),
      createId: () => '00000000-0000-4000-8000-000000000002',
    });
    await service.createBooking({
      consultationId: 'consultation',
      hallId: 'hall',
      eventDate: '2026-12-20',
      shiftCode: 'DINNER',
      menuPackageVersionId: 'menu-version',
      tableCount: 10,
      planningHeadcount: 100,
      expectedRevision: 1,
      managerAccountId: 'manager',
      requestId: 'request',
    });
    expect(repository.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: '00000000-0000-4000-8000-000000000002',
        consultationId: 'consultation',
      }),
    );
  });
});

function repositoryFixture(): ConsultationWorkspaceRepository {
  return {
    createConsultation: vi.fn().mockImplementation((value) => Promise.resolve(value)),
    createBooking: vi
      .fn()
      .mockImplementation((value) => Promise.resolve({ ...value, bookingRevision: 1 })),
  };
}

function catalogFixture(): ProposalCatalogPort {
  return {
    resolveProposal: vi.fn().mockResolvedValue({
      hall: { id: 'hall', name: 'Hall', description: 'Hall', maxGuests: 500 },
      shift: { code: 'DINNER', startTime: '17:30', endTime: '22:00' },
      menu: {
        versionId: 'menu-version',
        packageId: 'menu',
        versionNumber: 1,
        name: 'Menu',
        description: 'Menu',
        priceVndPerTable: 5_000_000,
      },
      eventDate: '2026-12-20',
      tableCount: 10,
      planningHeadcount: 100,
      baseChargeVnd: 50_000_000,
      depositAmountVnd: 15_000_000,
    } satisfies ProposalSnapshot),
  };
}
