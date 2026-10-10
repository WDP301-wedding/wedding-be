import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../../../generated/prisma/client.js';
import {
  AttendanceCorrectionConflictError,
  AttendanceCorrectionInvalidError,
  EventAssignmentRequiredError,
} from '../domain/staff-operations.policy.js';
import { createStaffOperationsRepository } from './staff-operations.repository.js';

type MockStaffPrisma = {
  staffEventAssignment: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  householdAttendanceLedger: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  attendanceArrival: {
    create: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  attendanceCorrection: {
    create: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  $executeRaw: ReturnType<typeof vi.fn>;
  $queryRaw: ReturnType<typeof vi.fn>;
  $transaction: ReturnType<typeof vi.fn>;
};

describe('Staff Operations Repository', () => {
  let mockPrisma: MockStaffPrisma;
  let repo: ReturnType<typeof createStaffOperationsRepository>;

  const bookingId = randomUUID();
  const staffAccountId = randomUUID();
  const householdId = randomUUID();
  const guestGroupId = randomUUID();
  const ledgerId = randomUUID();

  beforeEach(() => {
    mockPrisma = {
      staffEventAssignment: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      householdAttendanceLedger: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
      attendanceArrival: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      attendanceCorrection: {
        create: vi.fn(),
        findMany: vi.fn(),
      },
      $executeRaw: vi.fn().mockResolvedValue(1),
      $queryRaw: vi.fn(),
      $transaction: vi.fn(<T>(callback: (tx: PrismaClient) => Promise<T>): Promise<T> => {
        return callback(mockPrisma as unknown as PrismaClient);
      }),
    };

    repo = createStaffOperationsRepository(mockPrisma as unknown as PrismaClient);
  });

  describe('requireActiveAssignment', () => {
    it('throws EventAssignmentRequiredError if assignment is missing', async () => {
      mockPrisma.staffEventAssignment.findUnique.mockResolvedValue(null);

      await expect(
        repo.requireActiveAssignment(bookingId, staffAccountId),
      ).rejects.toThrow(EventAssignmentRequiredError);
    });

    it('throws EventAssignmentRequiredError if assignment is REVOKED', async () => {
      mockPrisma.staffEventAssignment.findUnique.mockResolvedValue({
        id: randomUUID(),
        bookingId,
        staffAccountId,
        status: 'REVOKED',
        revision: 1,
        revocationReason: 'Left team',
        assignedByAccountId: randomUUID(),
        assignedAt: new Date(),
        revokedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await expect(
        repo.requireActiveAssignment(bookingId, staffAccountId),
      ).rejects.toThrow(EventAssignmentRequiredError);
    });

    it('returns assignment when ACTIVE', async () => {
      const assignmentRow = {
        id: randomUUID(),
        bookingId,
        staffAccountId,
        status: 'ACTIVE',
        revision: 1,
        revocationReason: null,
        assignedByAccountId: randomUUID(),
        assignedAt: new Date(),
        revokedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.staffEventAssignment.findUnique.mockResolvedValue(assignmentRow);

      const result = await repo.requireActiveAssignment(bookingId, staffAccountId);
      expect(result.id).toBe(assignmentRow.id);
      expect(result.status).toBe('ACTIVE');
    });
  });

  describe('recordArrival concurrency & locking', () => {
    it('executes atomic ledger insertion with row-level FOR UPDATE lock and increments attendees', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: ledgerId,
          guestGroupIdSnapshot: guestGroupId,
          actualAttendees: 2,
          ledgerRevision: 1,
        },
      ]);
      mockPrisma.householdAttendanceLedger.update.mockResolvedValue({
        id: ledgerId,
        guestGroupIdSnapshot: guestGroupId,
        actualAttendees: 5,
        ledgerRevision: 2,
      });
      mockPrisma.attendanceArrival.create.mockResolvedValue({
        id: randomUUID(),
      });

      const result = await repo.recordArrival({
        bookingId,
        invitationHouseholdId: householdId,
        attendeeCount: 3,
        currentGuestGroupId: guestGroupId,
        recordedByAccountId: staffAccountId,
      });

      expect(result.actualAttendees).toBe(5);
      expect(result.ledgerRevision).toBe(2);
      expect(result.isFirstArrival).toBe(false);
      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
      expect(mockPrisma.householdAttendanceLedger.update).toHaveBeenCalledWith({
        where: { id: ledgerId },
        data: {
          guestGroupIdSnapshot: guestGroupId,
          actualAttendees: 5,
          ledgerRevision: 2,
        },
      });
    });
  });

  describe('recordCorrection optimistic lock & CAS', () => {
    it('throws AttendanceCorrectionConflictError when expectedLedgerRevision does not match current', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: ledgerId,
          actualAttendees: 4,
          ledgerRevision: 3, // Current is 3
        },
      ]);

      await expect(
        repo.recordCorrection({
          bookingId,
          invitationHouseholdId: householdId,
          arrivalId: randomUUID(),
          delta: 1,
          reason: 'Correcting head count',
          expectedLedgerRevision: 2, // Client expects 2 (stale)
          recordedByAccountId: staffAccountId,
        }),
      ).rejects.toThrow(AttendanceCorrectionConflictError);
    });

    it('throws AttendanceCorrectionInvalidError when delta would reduce attendees below zero', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: ledgerId,
          actualAttendees: 1,
          ledgerRevision: 2,
        },
      ]);

      await expect(
        repo.recordCorrection({
          bookingId,
          invitationHouseholdId: householdId,
          arrivalId: randomUUID(),
          delta: -3, // Would result in -2
          reason: 'Removing attendees',
          expectedLedgerRevision: 2,
          recordedByAccountId: staffAccountId,
        }),
      ).rejects.toThrow(AttendanceCorrectionInvalidError);
    });

    it('successfully records correction when expectedLedgerRevision matches', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: ledgerId,
          actualAttendees: 4,
          ledgerRevision: 2,
        },
      ]);
      mockPrisma.householdAttendanceLedger.update.mockResolvedValue({});
      mockPrisma.attendanceArrival.findFirst.mockResolvedValue({
        id: randomUUID(),
        attendeeCount: 5,
      });
      mockPrisma.attendanceCorrection.findMany.mockResolvedValue([]);
      mockPrisma.attendanceCorrection.create.mockResolvedValue({
        id: randomUUID(),
      });

      const result = await repo.recordCorrection({
        bookingId,
        invitationHouseholdId: householdId,
        arrivalId: randomUUID(),
        delta: 1,
        reason: 'Adding 1 more attendee',
        expectedLedgerRevision: 2,
        recordedByAccountId: staffAccountId,
      });

      expect(result.actualAttendees).toBe(5);
      expect(result.ledgerRevision).toBe(3);
    });
  });
});
