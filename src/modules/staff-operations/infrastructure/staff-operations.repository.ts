import { NotFoundError } from '../../../core/errors/app-error.js';
import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import {
  AssignmentConflictError,
  AttendanceCorrectionConflictError,
  AttendanceCorrectionInvalidError,
  EventAssignmentRequiredError,
  type StaffAssignmentStatus,
} from '../domain/staff-operations.policy.js';

export interface StaffAssignmentRow {
  readonly id: string;
  readonly bookingId: string;
  readonly staffAccountId: string;
  readonly status: StaffAssignmentStatus;
  readonly revision: number;
  readonly revokedAt: Date | null;
  readonly revocationReason: string | null;
  readonly assignedByAccountId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AttendanceArrivalRow {
  readonly id: string;
  readonly ledgerId: string;
  readonly bookingId: string;
  readonly invitationHouseholdId: string;
  readonly attendeeCount: number;
  readonly guestGroupIdSnapshot: string;
  readonly eventTime: Date;
  readonly recordedByAccountId: string;
  readonly managerOverrideReason: string | null;
  readonly createdAt: Date;
}

export interface AttendanceCorrectionRow {
  readonly id: string;
  readonly ledgerId: string;
  readonly arrivalId: string;
  readonly bookingId: string;
  readonly invitationHouseholdId: string;
  readonly delta: number;
  readonly expectedLedgerRevision: number;
  readonly reason: string;
  readonly recordedByAccountId: string;
  readonly createdAt: Date;
}

export interface HouseholdAttendanceSummaryRow {
  readonly id: string;
  readonly bookingId: string;
  readonly invitationHouseholdId: string;
  readonly guestGroupIdSnapshot: string;
  readonly actualAttendees: number;
  readonly ledgerRevision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface RecordArrivalInput {
  readonly bookingId: string;
  readonly invitationHouseholdId: string;
  readonly attendeeCount: number;
  readonly currentGuestGroupId: string;
  readonly eventTime?: Date | undefined;
  readonly recordedByAccountId: string;
  readonly managerOverrideReason?: string | null | undefined;
}

export interface RecordCorrectionInput {
  readonly bookingId: string;
  readonly invitationHouseholdId: string;
  readonly arrivalId: string;
  readonly delta: number;
  readonly expectedLedgerRevision: number;
  readonly reason: string;
  readonly recordedByAccountId: string;
}

export interface StaffOperationsRepository {
  findAssignment(
    bookingId: string,
    staffAccountId: string,
  ): Promise<StaffAssignmentRow | null>;
  listAssignments(bookingId: string): Promise<readonly StaffAssignmentRow[]>;
  requireActiveAssignment(bookingId: string, staffAccountId: string): Promise<StaffAssignmentRow>;
  createAssignment(
    bookingId: string,
    staffAccountId: string,
    assignedByAccountId: string,
  ): Promise<StaffAssignmentRow>;
  revokeAssignment(
    bookingId: string,
    assignmentId: string,
    expectedRevision: number,
    reason: string,
  ): Promise<StaffAssignmentRow>;
  revokeAllActiveAssignmentsForStaff(
    staffAccountId: string,
    reason: string,
  ): Promise<number>;

  findLedger(
    bookingId: string,
    householdId: string,
  ): Promise<HouseholdAttendanceSummaryRow | null>;
  recordArrival(input: RecordArrivalInput): Promise<{
    readonly arrivalId: string;
    readonly ledgerRevision: number;
    readonly actualAttendees: number;
    readonly guestGroupIdSnapshot: string;
    readonly isFirstArrival: boolean;
  }>;
  recordCorrection(input: RecordCorrectionInput): Promise<{
    readonly correctionId: string;
    readonly ledgerRevision: number;
    readonly actualAttendees: number;
  }>;
  getHouseholdAttendance(
    bookingId: string,
    householdId: string,
  ): Promise<{
    readonly ledger: HouseholdAttendanceSummaryRow | null;
    readonly arrivals: readonly AttendanceArrivalRow[];
    readonly corrections: readonly AttendanceCorrectionRow[];
  }>;
  getBookingAttendance(bookingId: string): Promise<{
    readonly actualAttendees: number;
    readonly byGuestGroup: readonly { readonly guestGroupId: string; readonly actualAttendees: number }[];
  }>;
}

export function createStaffOperationsRepository(prisma: PrismaClient): StaffOperationsRepository {
  return Object.freeze({
    async findAssignment(bookingId: string, staffAccountId: string): Promise<StaffAssignmentRow | null> {
      const row = await prisma.staffEventAssignment.findUnique({
        where: { bookingId_staffAccountId: { bookingId, staffAccountId } },
      });
      return row ? mapAssignment(row) : null;
    },

    async listAssignments(bookingId: string): Promise<readonly StaffAssignmentRow[]> {
      const rows = await prisma.staffEventAssignment.findMany({
        where: { bookingId },
        orderBy: { createdAt: 'desc' },
      });
      return Object.freeze(rows.map(mapAssignment));
    },

    async requireActiveAssignment(bookingId: string, staffAccountId: string): Promise<StaffAssignmentRow> {
      const row = await prisma.staffEventAssignment.findUnique({
        where: { bookingId_staffAccountId: { bookingId, staffAccountId } },
      });
      if (row === null || row.status !== 'ACTIVE') {
        throw new EventAssignmentRequiredError();
      }
      return mapAssignment(row);
    },

    async createAssignment(
      bookingId: string,
      staffAccountId: string,
      assignedByAccountId: string,
    ): Promise<StaffAssignmentRow> {
      const existing = await prisma.staffEventAssignment.findUnique({
        where: { bookingId_staffAccountId: { bookingId, staffAccountId } },
      });
      if (existing !== null) {
        if (existing.status === 'ACTIVE') {
          throw new AssignmentConflictError();
        }
        const reactivated = await prisma.staffEventAssignment.update({
          where: { id: existing.id },
          data: {
            status: 'ACTIVE',
            revision: existing.revision + 1,
            revokedAt: null,
            revocationReason: null,
            assignedByAccountId,
          },
        });
        return mapAssignment(reactivated);
      }

      try {
        const row = await prisma.staffEventAssignment.create({
          data: {
            bookingId,
            staffAccountId,
            assignedByAccountId,
            status: 'ACTIVE',
            revision: 1,
          },
        });
        return mapAssignment(row);
      } catch (error: unknown) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code: string }).code === 'P2002'
        ) {
          throw new AssignmentConflictError();
        }
        throw error;
      }
    },

    async revokeAssignment(
      bookingId: string,
      assignmentId: string,
      expectedRevision: number,
      reason: string,
    ): Promise<StaffAssignmentRow> {
      return prisma.$transaction(async (tx) => {
        const existing = await tx.staffEventAssignment.findFirst({
          where: { id: assignmentId, bookingId },
        });
        if (existing === null) {
          throw new NotFoundError();
        }
        if (existing.revision !== expectedRevision) {
          throw new AssignmentConflictError(
            'Assignment revision conflict: state has changed.',
          );
        }
        const updated = await tx.staffEventAssignment.update({
          where: { id: assignmentId },
          data: {
            status: 'REVOKED',
            revokedAt: new Date(),
            revocationReason: reason,
            revision: existing.revision + 1,
          },
        });
        return mapAssignment(updated);
      });
    },

    async revokeAllActiveAssignmentsForStaff(staffAccountId: string, reason: string): Promise<number> {
      const result = await prisma.staffEventAssignment.updateMany({
        where: { staffAccountId, status: 'ACTIVE' },
        data: {
          status: 'REVOKED',
          revokedAt: new Date(),
          revocationReason: reason,
        },
      });
      return result.count;
    },

    async findLedger(bookingId: string, householdId: string): Promise<HouseholdAttendanceSummaryRow | null> {
      const row = await prisma.householdAttendanceLedger.findUnique({
        where: {
          bookingId_invitationHouseholdId: {
            bookingId,
            invitationHouseholdId: householdId,
          },
        },
      });
      return row ? mapLedger(row) : null;
    },

    async recordArrival(input: RecordArrivalInput): Promise<{
      readonly arrivalId: string;
      readonly ledgerRevision: number;
      readonly actualAttendees: number;
      readonly guestGroupIdSnapshot: string;
      readonly isFirstArrival: boolean;
    }> {
      return prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "HouseholdAttendanceLedger" (
            "id", "bookingId", "invitationHouseholdId", "guestGroupIdSnapshot", "actualAttendees", "ledgerRevision", "createdAt", "updatedAt"
          )
          VALUES (
            gen_random_uuid(),
            ${input.bookingId}::uuid,
            ${input.invitationHouseholdId}::uuid,
            ${input.currentGuestGroupId}::uuid,
            0,
            0,
            NOW(),
            NOW()
          )
          ON CONFLICT ("bookingId", "invitationHouseholdId") DO NOTHING
        `);

        const lockedRows = await tx.$queryRaw<
          Array<{
            id: string;
            guestGroupIdSnapshot: string;
            actualAttendees: number;
            ledgerRevision: number;
          }>
        >(Prisma.sql`
          SELECT "id", "guestGroupIdSnapshot", "actualAttendees", "ledgerRevision"
          FROM "HouseholdAttendanceLedger"
          WHERE "bookingId" = ${input.bookingId}::uuid
            AND "invitationHouseholdId" = ${input.invitationHouseholdId}::uuid
          FOR UPDATE
        `);

        const ledger = lockedRows[0];
        if (ledger === undefined) {
          throw new Error('Failed to lock household attendance ledger.');
        }

        const isFirstArrival = ledger.ledgerRevision === 0;
        const guestGroupIdSnapshot = isFirstArrival
          ? input.currentGuestGroupId
          : ledger.guestGroupIdSnapshot;
        const newActualAttendees = ledger.actualAttendees + input.attendeeCount;
        const newLedgerRevision = ledger.ledgerRevision + 1;

        await tx.householdAttendanceLedger.update({
          where: { id: ledger.id },
          data: {
            guestGroupIdSnapshot,
            actualAttendees: newActualAttendees,
            ledgerRevision: newLedgerRevision,
          },
        });

        const arrival = await tx.attendanceArrival.create({
          data: {
            ledgerId: ledger.id,
            bookingId: input.bookingId,
            invitationHouseholdId: input.invitationHouseholdId,
            attendeeCount: input.attendeeCount,
            guestGroupIdSnapshot,
            eventTime: input.eventTime ?? new Date(),
            recordedByAccountId: input.recordedByAccountId,
            managerOverrideReason: input.managerOverrideReason ?? null,
          },
        });

        return {
          arrivalId: arrival.id,
          ledgerRevision: newLedgerRevision,
          actualAttendees: newActualAttendees,
          guestGroupIdSnapshot,
          isFirstArrival,
        };
      });
    },

    async recordCorrection(input: RecordCorrectionInput): Promise<{
      readonly correctionId: string;
      readonly ledgerRevision: number;
      readonly actualAttendees: number;
    }> {
      return prisma.$transaction(async (tx) => {
        const lockedRows = await tx.$queryRaw<
          Array<{
            id: string;
            actualAttendees: number;
            ledgerRevision: number;
          }>
        >(Prisma.sql`
          SELECT "id", "actualAttendees", "ledgerRevision"
          FROM "HouseholdAttendanceLedger"
          WHERE "bookingId" = ${input.bookingId}::uuid
            AND "invitationHouseholdId" = ${input.invitationHouseholdId}::uuid
          FOR UPDATE
        `);

        const ledger = lockedRows[0];
        if (ledger === undefined) {
          throw new NotFoundError();
        }

        if (ledger.ledgerRevision !== input.expectedLedgerRevision) {
          throw new AttendanceCorrectionConflictError();
        }

        const newActual = ledger.actualAttendees + input.delta;
        if (newActual < 0) {
          throw new AttendanceCorrectionInvalidError();
        }

        const arrival = await tx.attendanceArrival.findFirst({
          where: {
            id: input.arrivalId,
            bookingId: input.bookingId,
            invitationHouseholdId: input.invitationHouseholdId,
          },
        });
        if (arrival === null) {
          throw new NotFoundError();
        }

        const priorCorrections = await tx.attendanceCorrection.findMany({
          where: { arrivalId: input.arrivalId },
        });
        const priorDeltaSum = priorCorrections.reduce((sum, c) => sum + c.delta, 0);
        const effectiveArrivalAttendees = arrival.attendeeCount + priorDeltaSum + input.delta;
        if (effectiveArrivalAttendees < 0) {
          throw new AttendanceCorrectionInvalidError(
            'Effective attendees for this arrival cannot fall below zero.',
          );
        }

        const newRevision = ledger.ledgerRevision + 1;
        await tx.householdAttendanceLedger.update({
          where: { id: ledger.id },
          data: {
            actualAttendees: newActual,
            ledgerRevision: newRevision,
          },
        });

        const correction = await tx.attendanceCorrection.create({
          data: {
            ledgerId: ledger.id,
            arrivalId: input.arrivalId,
            bookingId: input.bookingId,
            invitationHouseholdId: input.invitationHouseholdId,
            delta: input.delta,
            expectedLedgerRevision: input.expectedLedgerRevision,
            reason: input.reason,
            recordedByAccountId: input.recordedByAccountId,
          },
        });

        return {
          correctionId: correction.id,
          ledgerRevision: newRevision,
          actualAttendees: newActual,
        };
      });
    },

    async getHouseholdAttendance(
      bookingId: string,
      householdId: string,
    ): Promise<{
      readonly ledger: HouseholdAttendanceSummaryRow | null;
      readonly arrivals: readonly AttendanceArrivalRow[];
      readonly corrections: readonly AttendanceCorrectionRow[];
    }> {
      const [ledger, arrivals, corrections] = await Promise.all([
        prisma.householdAttendanceLedger.findUnique({
          where: {
            bookingId_invitationHouseholdId: {
              bookingId,
              invitationHouseholdId: householdId,
            },
          },
        }),
        prisma.attendanceArrival.findMany({
          where: { bookingId, invitationHouseholdId: householdId },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.attendanceCorrection.findMany({
          where: { bookingId, invitationHouseholdId: householdId },
          orderBy: { createdAt: 'asc' },
        }),
      ]);

      return {
        ledger: ledger ? mapLedger(ledger) : null,
        arrivals: Object.freeze(arrivals.map(mapArrival)),
        corrections: Object.freeze(corrections.map(mapCorrection)),
      };
    },

    async getBookingAttendance(bookingId: string): Promise<{
      readonly actualAttendees: number;
      readonly byGuestGroup: readonly { readonly guestGroupId: string; readonly actualAttendees: number }[];
    }> {
      const ledgers = await prisma.householdAttendanceLedger.findMany({
        where: { bookingId },
      });

      let total = 0;
      const groupMap = new Map<string, number>();

      for (const item of ledgers) {
        total += item.actualAttendees;
        const current = groupMap.get(item.guestGroupIdSnapshot) ?? 0;
        groupMap.set(item.guestGroupIdSnapshot, current + item.actualAttendees);
      }

      const byGuestGroup = Array.from(groupMap.entries()).map(([guestGroupId, actualAttendees]) => ({
        guestGroupId,
        actualAttendees,
      }));

      return {
        actualAttendees: total,
        byGuestGroup: Object.freeze(byGuestGroup),
      };
    },
  });
}

function mapAssignment(row: {
  id: string;
  bookingId: string;
  staffAccountId: string;
  status: string;
  revision: number;
  revokedAt: Date | null;
  revocationReason: string | null;
  assignedByAccountId: string;
  createdAt: Date;
  updatedAt: Date;
}): StaffAssignmentRow {
  return Object.freeze({
    id: row.id,
    bookingId: row.bookingId,
    staffAccountId: row.staffAccountId,
    status: row.status as StaffAssignmentStatus,
    revision: row.revision,
    revokedAt: row.revokedAt,
    revocationReason: row.revocationReason,
    assignedByAccountId: row.assignedByAccountId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function mapLedger(row: {
  id: string;
  bookingId: string;
  invitationHouseholdId: string;
  guestGroupIdSnapshot: string;
  actualAttendees: number;
  ledgerRevision: number;
  createdAt: Date;
  updatedAt: Date;
}): HouseholdAttendanceSummaryRow {
  return Object.freeze({
    id: row.id,
    bookingId: row.bookingId,
    invitationHouseholdId: row.invitationHouseholdId,
    guestGroupIdSnapshot: row.guestGroupIdSnapshot,
    actualAttendees: row.actualAttendees,
    ledgerRevision: row.ledgerRevision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function mapArrival(row: {
  id: string;
  ledgerId: string;
  bookingId: string;
  invitationHouseholdId: string;
  attendeeCount: number;
  guestGroupIdSnapshot: string;
  eventTime: Date;
  recordedByAccountId: string;
  managerOverrideReason: string | null;
  createdAt: Date;
}): AttendanceArrivalRow {
  return Object.freeze({
    id: row.id,
    ledgerId: row.ledgerId,
    bookingId: row.bookingId,
    invitationHouseholdId: row.invitationHouseholdId,
    attendeeCount: row.attendeeCount,
    guestGroupIdSnapshot: row.guestGroupIdSnapshot,
    eventTime: row.eventTime,
    recordedByAccountId: row.recordedByAccountId,
    managerOverrideReason: row.managerOverrideReason,
    createdAt: row.createdAt,
  });
}

function mapCorrection(row: {
  id: string;
  ledgerId: string;
  arrivalId: string;
  bookingId: string;
  invitationHouseholdId: string;
  delta: number;
  expectedLedgerRevision: number;
  reason: string;
  recordedByAccountId: string;
  createdAt: Date;
}): AttendanceCorrectionRow {
  return Object.freeze({
    id: row.id,
    ledgerId: row.ledgerId,
    arrivalId: row.arrivalId,
    bookingId: row.bookingId,
    invitationHouseholdId: row.invitationHouseholdId,
    delta: row.delta,
    expectedLedgerRevision: row.expectedLedgerRevision,
    reason: row.reason,
    recordedByAccountId: row.recordedByAccountId,
    createdAt: row.createdAt,
  });
}
