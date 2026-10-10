import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../../../generated/prisma/client.js';
import { LayoutRetiredError } from '../domain/seating-plan.policy.js';
import type {
  BookingContext,
  BookingPlanningReader,
  GuestPlanningReader,
  LayoutEligibility,
  PrintableSeatingContentRegistry,
  VenueSelectionEligibilityReader,
} from '../domain/seating-plan.providers.js';
import type {
  RevisionRow,
  SeatingPlanRepository,
  SeatingPlanRow,
} from '../infrastructure/seating-plan.repository.js';
import { createSeatingPlanService, type SeatingPlanService } from './seating-plan.service.js';

describe('Seating Plan Service', () => {
  let mockRepo: {
    findPlanById: ReturnType<typeof vi.fn>;
    requirePlanById: ReturnType<typeof vi.fn>;
    requirePlanByBookingAndPlanId: ReturnType<typeof vi.fn>;
    getCurrentRevisionWithLabels: ReturnType<typeof vi.fn>;
    findPlanByBookingId: ReturnType<typeof vi.fn>;
    createPlan: ReturnType<typeof vi.fn>;
    appendRevision: ReturnType<typeof vi.fn>;
    updatePlanStatus: ReturnType<typeof vi.fn>;
    invalidatePlan: ReturnType<typeof vi.fn>;
    createManagerException: ReturnType<typeof vi.fn>;
    getExceptionRecord: ReturnType<typeof vi.fn>;
  };

  let mockBookingReader: {
    requireConfirmedBookingContext: ReturnType<typeof vi.fn>;
    requireBookingOwnedByAccount: ReturnType<typeof vi.fn>;
  };

  let mockGuestReader: {
    listActiveGroups: ReturnType<typeof vi.fn>;
  };

  let mockVenueReader: {
    requireLayoutVersionEligible: ReturnType<typeof vi.fn>;
    listCompatibleVersionsForHall: ReturnType<typeof vi.fn>;
  };

  let mockRegistry: {
    registerConfirmed: ReturnType<typeof vi.fn>;
    markRequiresReview: ReturnType<typeof vi.fn>;
  };

  let mockPrisma: {
    $executeRaw: ReturnType<typeof vi.fn>;
    $queryRaw: ReturnType<typeof vi.fn>;
    seatingRevisionRegistration: {
      create: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };

  let service: SeatingPlanService;

  const bookingId = randomUUID();
  const planId = randomUUID();
  const revisionId = randomUUID();
  const layoutTemplateVersionId = randomUUID();
  const hallId = randomUUID();
  const tableId = randomUUID();
  const guestGroupId = randomUUID();
  const actorAccountId = randomUUID();

  const activePlanRow: SeatingPlanRow = {
    id: planId,
    bookingId,
    status: 'DRAFT',
    currentRevisionId: revisionId,
    confirmedRevisionId: null,
    planRevision: 1,
    createdByAccountId: actorAccountId,
    updatedByAccountId: actorAccountId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const activeRevisionRow: RevisionRow = {
    id: revisionId,
    seatingPlanId: planId,
    revisionNumber: 1,
    layoutTemplateVersionId,
    expectedAttendees: 10,
    revisionDigest: 'digest-1',
    createdByAccountId: actorAccountId,
    createdAt: new Date(),
    labels: [
      {
        layoutTableId: tableId,
        guestGroupId,
        colorSnapshot: '#FF0000',
        displayOrder: 1,
      },
    ],
  };

  const bookingContext: BookingContext = {
    bookingId,
    consultationId: randomUUID(),
    hallId,
    planningHeadcount: 100,
    bookingRevision: 1,
  };

  const eligibleLayout: LayoutEligibility = {
    layoutTemplateVersionId,
    layoutTemplateId: randomUUID(),
    hallId,
    minGuests: 50,
    maxGuests: 200,
    hallMaxGuests: 250,
    totalSeatCapacity: 150,
    tableIds: [tableId],
    tables: [{ tableId, label: 'Bàn 1' }],
    isRetired: false,
  };

  beforeEach(() => {
    mockRepo = {
      findPlanById: vi.fn().mockResolvedValue(activePlanRow),
      requirePlanById: vi.fn().mockResolvedValue(activePlanRow),
      requirePlanByBookingAndPlanId: vi.fn().mockResolvedValue(activePlanRow),
      getCurrentRevisionWithLabels: vi.fn().mockResolvedValue(activeRevisionRow),
      findPlanByBookingId: vi.fn().mockResolvedValue(activePlanRow),
      createPlan: vi.fn().mockResolvedValue(activePlanRow),
      appendRevision: vi.fn().mockResolvedValue(activeRevisionRow),
      updatePlanStatus: vi.fn().mockResolvedValue(undefined),
      invalidatePlan: vi.fn().mockResolvedValue(undefined),
      createManagerException: vi.fn().mockResolvedValue(undefined),
      getExceptionRecord: vi.fn().mockResolvedValue(null),
    };

    mockBookingReader = {
      requireConfirmedBookingContext: vi.fn().mockResolvedValue(bookingContext),
      requireBookingOwnedByAccount: vi.fn().mockResolvedValue(undefined),
    };

    mockGuestReader = {
      listActiveGroups: vi.fn().mockResolvedValue([{ guestGroupId, name: 'Nhà trai', color: '#FF0000' }]),
    };

    mockVenueReader = {
      requireLayoutVersionEligible: vi.fn().mockResolvedValue(eligibleLayout),
      listCompatibleVersionsForHall: vi.fn().mockResolvedValue([]),
    };

    mockRegistry = {
      registerConfirmed: vi.fn().mockResolvedValue(undefined),
      markRequiresReview: vi.fn().mockResolvedValue(undefined),
    };

    mockPrisma = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      $queryRaw: vi.fn().mockResolvedValue([{ planRevision: 2 }]),
      seatingRevisionRegistration: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      $transaction: vi.fn(<T>(callback: (tx: PrismaClient) => Promise<T>): Promise<T> => {
        return callback(mockPrisma as unknown as PrismaClient);
      }),
    };

    service = createSeatingPlanService({
      repository: mockRepo as unknown as SeatingPlanRepository,
      bookingReader: mockBookingReader as unknown as BookingPlanningReader,
      guestReader: mockGuestReader as unknown as GuestPlanningReader,
      venueReader: mockVenueReader as unknown as VenueSelectionEligibilityReader,
      registry: mockRegistry as unknown as PrintableSeatingContentRegistry,
      prisma: mockPrisma as unknown as PrismaClient,
    });
  });

  describe('P1 — Confirmation & Registry Atomicity', () => {
    it('rolls back transaction if printable registry fails', async () => {
      mockRegistry.registerConfirmed.mockRejectedValue(new Error('Registry connection failure'));

      await expect(
        service.confirmPlan({
          bookingId,
          planId,
          expectedRevision: 1,
          expectedBookingRevision: 1,
          accessToken: 'test-token',
          requestId: 'req-1',
          actorAccountId,
        }),
      ).rejects.toThrow('Registry connection failure');

      expect(mockRegistry.registerConfirmed).toHaveBeenCalled();
    });

    it('successfully commits plan confirmation when registry succeeds', async () => {
      mockRepo.requirePlanById.mockResolvedValue({
        ...activePlanRow,
        status: 'CONFIRMED',
      });

      const result = await service.confirmPlan({
        bookingId,
        planId,
        expectedRevision: 1,
        expectedBookingRevision: 1,
        accessToken: 'test-token',
        requestId: 'req-1',
        actorAccountId,
      });

      expect(result.status).toBe('CONFIRMED');
      expect(mockRegistry.registerConfirmed).toHaveBeenCalled();
    });
  });

  describe('P1 — Manager Exception Rejection for Retired Layout', () => {
    it('rejects manager exception when layout template is retired', async () => {
      mockVenueReader.requireLayoutVersionEligible.mockResolvedValue({
        ...eligibleLayout,
        isRetired: true,
      });

      await expect(
        service.recordManagerException({
          planId,
          expectedRevision: 1,
          expectedBookingRevision: 1,
          reason: 'Forcing retired layout',
          accessToken: 'test-token',
          requestId: 'req-1',
          actorAccountId,
        }),
      ).rejects.toThrow(LayoutRetiredError);

      expect(mockRepo.createManagerException).not.toHaveBeenCalled();
    });
  });

  describe('P1 — Seating Invalidation / Revalidation', () => {
    it('auto-transitions confirmed plan to REQUIRES_REVIEW when layout is retired', async () => {
      const confirmedPlan: SeatingPlanRow = {
        ...activePlanRow,
        status: 'CONFIRMED',
        confirmedRevisionId: revisionId,
      };
      mockRepo.requirePlanByBookingAndPlanId.mockResolvedValue(confirmedPlan);
      mockVenueReader.requireLayoutVersionEligible.mockResolvedValue({
        ...eligibleLayout,
        isRetired: true,
      });

      const plan = await service.getPlan({
        bookingId,
        planId,
        accessToken: 'test-token',
        actorAccountId,
      });

      expect(plan.status).toBe('REQUIRES_REVIEW');
      expect(mockRepo.invalidatePlan).toHaveBeenCalledWith(planId);
      expect(mockRegistry.markRequiresReview).toHaveBeenCalledWith(revisionId);
    });

    it('auto-transitions confirmed plan to REQUIRES_REVIEW when planning headcount exceeds max guests', async () => {
      const confirmedPlan: SeatingPlanRow = {
        ...activePlanRow,
        status: 'CONFIRMED',
        confirmedRevisionId: revisionId,
      };
      mockRepo.requirePlanByBookingAndPlanId.mockResolvedValue(confirmedPlan);
      mockBookingReader.requireConfirmedBookingContext.mockResolvedValue({
        ...bookingContext,
        planningHeadcount: 250, // exceeds maxGuests 200
      });

      const plan = await service.getPlan({
        bookingId,
        planId,
        accessToken: 'test-token',
        actorAccountId,
      });

      expect(plan.status).toBe('REQUIRES_REVIEW');
      expect(mockRepo.invalidatePlan).toHaveBeenCalledWith(planId);
    });
  });
});
