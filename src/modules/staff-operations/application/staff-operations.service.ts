import { AppError, NotFoundError } from '../../../core/errors/app-error.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import {
  isWithinEventWindow,
  validateArrivalCount,
  validateCorrectionDelta,
  validateReason,
  CheckInWindowClosedError,
  EventAssignmentRequiredError,
} from '../domain/staff-operations.policy.js';
import type {
  BookingEventReader,
  GuestOperationsReader,
  HouseholdOperationsInfo,
  HouseholdSearchFilter,
  SeatingGuidanceProvider,
  StaffAccountProvisioner,
} from '../domain/staff-operations.providers.js';
import type {
  AttendanceArrivalRow,
  AttendanceCorrectionRow,
  HouseholdAttendanceSummaryRow,
  StaffAssignmentRow,
  StaffOperationsRepository,
} from '../infrastructure/staff-operations.repository.js';

export interface StaffActorContext {
  readonly accountId: string;
  readonly role: 'MANAGER' | 'STAFF';
}

export interface AttendanceWarning {
  readonly code: 'OVER_EXPECTED_ATTENDANCE' | 'GUEST_GROUP_CHANGED';
  readonly message: string;
  readonly expectedAttendees?: number | undefined;
  readonly actualAttendees?: number | undefined;
}

export interface HouseholdSearchResultItem {
  readonly invitationHouseholdId: string;
  readonly representativeName: string;
  readonly phoneLast4: string | null;
  readonly expectedAttendees: number;
  readonly actualAttendees: number;
  readonly hasOverExpectedWarning: boolean;
  readonly guestGroupId: string;
  readonly guestGroupName: string;
  readonly guestGroupColor: string;
  readonly tableLabels: readonly string[];
  readonly operationalNote: string | null;
}

export interface RecordArrivalServiceInput {
  readonly attendeeCount: number;
  readonly eventTime?: Date | undefined;
  readonly managerOverrideReason?: string | null | undefined;
}

export interface RecordCorrectionServiceInput {
  readonly arrivalId: string;
  readonly delta: number;
  readonly expectedLedgerRevision: number;
  readonly reason: string;
}

export interface StaffOperationsService {
  provisionStaffAccount(
    email: string,
    commandKey: string,
    actor: StaffActorContext,
  ): Promise<{ accountId: string; setupRequired: boolean }>;

  setStaffOperationalAccess(
    staffAccountId: string,
    enabled: boolean,
    reason: string,
    actor: StaffActorContext,
  ): Promise<void>;

  listAssignments(
    bookingId: string,
    actor: StaffActorContext,
  ): Promise<readonly StaffAssignmentRow[]>;

  assignStaff(
    bookingId: string,
    staffAccountId: string,
    actor: StaffActorContext,
  ): Promise<StaffAssignmentRow>;

  revokeAssignment(
    bookingId: string,
    assignmentId: string,
    expectedRevision: number,
    reason: string,
    actor: StaffActorContext,
  ): Promise<StaffAssignmentRow>;

  searchHouseholds(
    bookingId: string,
    filter: HouseholdSearchFilter,
    actor: StaffActorContext,
  ): Promise<{
    readonly items: readonly HouseholdSearchResultItem[];
    readonly nextCursor: string | null;
  }>;

  recordArrival(
    bookingId: string,
    householdId: string,
    input: RecordArrivalServiceInput,
    actor: StaffActorContext,
  ): Promise<{
    readonly arrivalId: string;
    readonly ledgerRevision: number;
    readonly actualAttendees: number;
    readonly warnings: readonly AttendanceWarning[];
  }>;

  recordCorrection(
    bookingId: string,
    householdId: string,
    input: RecordCorrectionServiceInput,
    actor: StaffActorContext,
  ): Promise<{
    readonly correctionId: string;
    readonly ledgerRevision: number;
    readonly actualAttendees: number;
    readonly warnings: readonly AttendanceWarning[];
  }>;

  getHouseholdAttendance(
    bookingId: string,
    householdId: string,
    actor: StaffActorContext,
  ): Promise<{
    readonly household: HouseholdOperationsInfo;
    readonly actualAttendees: number;
    readonly ledgerRevision: number;
    readonly hasOverExpectedWarning: boolean;
    readonly arrivals: readonly AttendanceArrivalRow[];
    readonly corrections: readonly AttendanceCorrectionRow[];
  }>;

  getBookingAttendance(bookingId: string): Promise<{
    readonly actualAttendees: number;
    readonly byGuestGroup: readonly { readonly guestGroupId: string; readonly actualAttendees: number }[];
  }>;
}

export interface AttendanceReader {
  getHouseholdAttendance(invitationHouseholdId: string): Promise<{
    readonly expectedAttendees: number;
    readonly actualAttendees: number;
    readonly hasOverExpectedWarning: boolean;
  }>;
  getBookingAttendance(bookingId: string): Promise<{
    readonly actualAttendees: number;
    readonly byGuestGroup: readonly { readonly guestGroupId: string; readonly actualAttendees: number }[];
  }>;
}

export interface CreateStaffOperationsServiceOptions {
  readonly repository: StaffOperationsRepository;
  readonly bookingReader: BookingEventReader;
  readonly guestReader: GuestOperationsReader;
  readonly seatingGuidance: SeatingGuidanceProvider;
  readonly staffProvisioner: StaffAccountProvisioner;
}

export function createStaffOperationsService(
  options: CreateStaffOperationsServiceOptions,
): StaffOperationsService {
  const { repository, bookingReader, guestReader, seatingGuidance, staffProvisioner } = options;

  async function checkEventWindowAndAssignment(
    bookingId: string,
    actor: StaffActorContext,
    managerOverrideReason?: string | null | undefined,
  ): Promise<void> {
    const eventContext = await bookingReader.requireConfirmedEventContext(bookingId);

    if (actor.role === 'STAFF') {
      await repository.requireActiveAssignment(bookingId, actor.accountId);
    }

    const inWindow = isWithinEventWindow(
      eventContext.eventStartTime,
      eventContext.eventEndTime,
    );

    if (!inWindow) {
      if (actor.role === 'MANAGER' && managerOverrideReason !== undefined && managerOverrideReason !== null) {
        validateReason(managerOverrideReason, 'managerOverrideReason');
      } else {
        throw new CheckInWindowClosedError();
      }
    }
  }

  const service: StaffOperationsService = {
    async provisionStaffAccount(email, commandKey, actor) {
      if (actor.role !== 'MANAGER') {
        throw new AppError({
          status: 403,
          code: 'FORBIDDEN',
          message: 'Only managers can provision staff accounts.',
        });
      }
      return staffProvisioner.provisionStaffAccount({ email, commandKey });
    },

    async setStaffOperationalAccess(staffAccountId, enabled, reason, actor) {
      if (actor.role !== 'MANAGER') {
        throw new AppError({
          status: 403,
          code: 'FORBIDDEN',
          message: 'Only managers can modify staff operational access.',
        });
      }
      validateReason(reason);
      await staffProvisioner.setStaffOperationalAccess({
        accountId: staffAccountId,
        enabled,
        reason,
      });

      if (!enabled) {
        await repository.revokeAllActiveAssignmentsForStaff(
          staffAccountId,
          `Operational access disabled by manager: ${reason}`,
        );
      }
    },

    async listAssignments(bookingId, actor) {
      if (actor.role === 'STAFF') {
        await repository.requireActiveAssignment(bookingId, actor.accountId);
      }
      return repository.listAssignments(bookingId);
    },

    async assignStaff(bookingId, staffAccountId, actor) {
      if (actor.role !== 'MANAGER') {
        throw new AppError({
          status: 403,
          code: 'FORBIDDEN',
          message: 'Only managers can assign staff to events.',
        });
      }
      await bookingReader.requireConfirmedEventContext(bookingId);
      return repository.createAssignment(bookingId, staffAccountId, actor.accountId);
    },

    async revokeAssignment(bookingId, assignmentId, expectedRevision, reason, actor) {
      if (actor.role !== 'MANAGER') {
        throw new AppError({
          status: 403,
          code: 'FORBIDDEN',
          message: 'Only managers can revoke staff assignments.',
        });
      }
      validateReason(reason);
      return repository.revokeAssignment(bookingId, assignmentId, expectedRevision, reason);
    },

    async searchHouseholds(bookingId, filter, actor) {
      if (actor.role === 'STAFF') {
        await repository.requireActiveAssignment(bookingId, actor.accountId);
      }

      const [searchResult, guidance] = await Promise.all([
        guestReader.searchHouseholds(bookingId, filter),
        seatingGuidance.getGuidance(bookingId),
      ]);

      const guidanceMap = new Map<string, readonly string[]>();
      for (const group of guidance.groups) {
        guidanceMap.set(group.guestGroupId, group.tableLabels);
      }

      const items: HouseholdSearchResultItem[] = await Promise.all(
        searchResult.items.map(async (household) => {
          const ledger = await repository.findLedger(
            bookingId,
            household.invitationHouseholdId,
          );
          const actualAttendees = ledger?.actualAttendees ?? 0;
          const tableLabels = guidanceMap.get(household.guestGroupId) ?? [];

          return {
            invitationHouseholdId: household.invitationHouseholdId,
            representativeName: household.representativeName,
            phoneLast4: household.phoneLast4,
            expectedAttendees: household.expectedAttendees,
            actualAttendees,
            hasOverExpectedWarning: actualAttendees > household.expectedAttendees,
            guestGroupId: household.guestGroupId,
            guestGroupName: household.guestGroupName,
            guestGroupColor: household.guestGroupColor,
            tableLabels,
            operationalNote: household.operationalNote,
          };
        }),
      );

      return {
        items: Object.freeze(items),
        nextCursor: searchResult.nextCursor,
      };
    },

    async recordArrival(bookingId, householdId, input, actor) {
      await checkEventWindowAndAssignment(
        bookingId,
        actor,
        input.managerOverrideReason,
      );

      const attendeeCount = validateArrivalCount(input.attendeeCount);
      const household = await guestReader.requireHouseholdForOperations(bookingId, householdId);

      const arrivalResult = await repository.recordArrival({
        bookingId,
        invitationHouseholdId: householdId,
        attendeeCount,
        currentGuestGroupId: household.guestGroupId,
        eventTime: input.eventTime,
        recordedByAccountId: actor.accountId,
        managerOverrideReason: input.managerOverrideReason,
      });

      const warnings: AttendanceWarning[] = [];

      if (arrivalResult.actualAttendees > household.expectedAttendees) {
        warnings.push({
          code: 'OVER_EXPECTED_ATTENDANCE',
          message: `Actual attendance (${String(arrivalResult.actualAttendees)}) exceeds expected attendance (${String(household.expectedAttendees)}).`,
          expectedAttendees: household.expectedAttendees,
          actualAttendees: arrivalResult.actualAttendees,
        });
      }

      if (
        !arrivalResult.isFirstArrival &&
        arrivalResult.guestGroupIdSnapshot !== household.guestGroupId
      ) {
        warnings.push({
          code: 'GUEST_GROUP_CHANGED',
          message: 'The current guest group differs from the snapshotted group of previous arrivals.',
        });
      }

      return {
        arrivalId: arrivalResult.arrivalId,
        ledgerRevision: arrivalResult.ledgerRevision,
        actualAttendees: arrivalResult.actualAttendees,
        warnings: Object.freeze(warnings),
      };
    },

    async recordCorrection(bookingId, householdId, input, actor) {
      await checkEventWindowAndAssignment(bookingId, actor);

      if (actor.role === 'STAFF') {
        const history = await repository.getHouseholdAttendance(bookingId, householdId);
        const arrival = history.arrivals.find((a) => a.id === input.arrivalId);
        if (arrival === undefined) {
          throw new NotFoundError();
        }
        if (arrival.recordedByAccountId !== actor.accountId) {
          throw new AppError({
            status: 403,
            code: 'FORBIDDEN',
            message: 'Staff may only correct arrivals they recorded.',
          });
        }
      }

      const delta = validateCorrectionDelta(input.delta);
      const reason = validateReason(input.reason);

      const household = await guestReader.requireHouseholdForOperations(bookingId, householdId);

      const correctionResult = await repository.recordCorrection({
        bookingId,
        invitationHouseholdId: householdId,
        arrivalId: input.arrivalId,
        delta,
        expectedLedgerRevision: input.expectedLedgerRevision,
        reason,
        recordedByAccountId: actor.accountId,
      });

      const warnings: AttendanceWarning[] = [];
      if (correctionResult.actualAttendees > household.expectedAttendees) {
        warnings.push({
          code: 'OVER_EXPECTED_ATTENDANCE',
          message: `Actual attendance (${String(correctionResult.actualAttendees)}) exceeds expected attendance (${String(household.expectedAttendees)}).`,
          expectedAttendees: household.expectedAttendees,
          actualAttendees: correctionResult.actualAttendees,
        });
      }

      return {
        correctionId: correctionResult.correctionId,
        ledgerRevision: correctionResult.ledgerRevision,
        actualAttendees: correctionResult.actualAttendees,
        warnings: Object.freeze(warnings),
      };
    },

    async getHouseholdAttendance(bookingId, householdId, actor) {
      if (actor.role === 'STAFF') {
        await repository.requireActiveAssignment(bookingId, actor.accountId);
      }

      const [household, history] = await Promise.all([
        guestReader.requireHouseholdForOperations(bookingId, householdId),
        repository.getHouseholdAttendance(bookingId, householdId),
      ]);

      const actualAttendees = history.ledger?.actualAttendees ?? 0;
      const ledgerRevision = history.ledger?.ledgerRevision ?? 1;

      return {
        household,
        actualAttendees,
        ledgerRevision,
        hasOverExpectedWarning: actualAttendees > household.expectedAttendees,
        arrivals: history.arrivals,
        corrections: history.corrections,
      };
    },

    async getBookingAttendance(bookingId) {
      return repository.getBookingAttendance(bookingId);
    },
  };

  return Object.freeze(service);
}

export function createAttendanceReader(
  repository: StaffOperationsRepository,
  guestReader: GuestOperationsReader,
  prisma: PrismaClient,
): AttendanceReader {
  return Object.freeze({
    async getHouseholdAttendance(invitationHouseholdId: string) {
      const ledger = await prisma.householdAttendanceLedger.findFirst({
        where: { invitationHouseholdId },
      });
      if (ledger === null) {
        return {
          expectedAttendees: 0,
          actualAttendees: 0,
          hasOverExpectedWarning: false,
        };
      }
      const household = await guestReader.requireHouseholdForOperations(
        ledger.bookingId,
        invitationHouseholdId,
      );
      return {
        expectedAttendees: household.expectedAttendees,
        actualAttendees: ledger.actualAttendees,
        hasOverExpectedWarning: ledger.actualAttendees > household.expectedAttendees,
      };
    },
    async getBookingAttendance(bookingId: string) {
      return repository.getBookingAttendance(bookingId);
    },
  });
}
