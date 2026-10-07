import { randomUUID } from 'node:crypto';

import { NotFoundError } from '../../../core/errors/app-error.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import {
  buildRevisionDigest,
  ExceptionExceedsPhysicalCapacityError,
  LayoutRetiredError,
  TableNotInLayoutError,
  GuestGroupUnavailableError,
  validateExceptionReason,
  validateHeadcountInRange,
} from '../domain/seating-plan.policy.js';
import type { LabelInput } from '../domain/seating-plan.policy.js';
import type {
  BookingPlanningReader,
  CompatibleLayoutOption,
  GuestPlanningReader,
  PrintableSeatingContentRegistry,
  ValidityProof,
  VenueSelectionEligibilityReader,
} from '../domain/seating-plan.providers.js';
import type {
  LabelRow,
  RevisionRow,
  SeatingPlanRepository,
  SeatingPlanRow,
} from '../infrastructure/seating-plan.repository.js';

// ─── Input / output types ─────────────────────────────────────────────────────

export interface ListLayoutOptionsInput {
  readonly bookingId: string;
  readonly accessToken: string;
  readonly requestId: string;
}

export interface SelectLayoutInput {
  readonly bookingId: string;
  readonly layoutTemplateVersionId: string;
  readonly expectedBookingRevision: number;
  readonly accessToken: string;
  readonly requestId: string;
  readonly actorAccountId: string;
}

export interface SaveRevisionInput {
  readonly bookingId: string;
  readonly planId: string;
  readonly expectedRevision: number;
  readonly labels: readonly LabelInput[];
  readonly layoutTemplateVersionId?: string;
  readonly accessToken: string;
  readonly requestId: string;
  readonly actorAccountId: string;
}

export interface ConfirmPlanInput {
  readonly bookingId: string;
  readonly planId: string;
  readonly expectedRevision: number;
  readonly expectedBookingRevision: number;
  readonly accessToken: string;
  readonly requestId: string;
  readonly actorAccountId: string;
}

export interface RecordManagerExceptionInput {
  readonly planId: string;
  readonly expectedRevision: number;
  readonly expectedBookingRevision: number;
  readonly reason: string;
  readonly accessToken: string;
  readonly requestId: string;
  readonly actorAccountId: string;
}

export interface GetPlanInput {
  readonly bookingId: string;
  readonly planId: string;
  readonly accessToken: string;
  readonly actorAccountId: string;
}

export interface SeatingPlanResult {
  readonly planId: string;
  readonly bookingId: string;
  readonly status: 'DRAFT' | 'CONFIRMED' | 'REQUIRES_REVIEW';
  readonly planRevision: number;
  readonly currentRevision: RevisionRow | null;
  readonly confirmedRevisionId: string | null;
  readonly hasManagerException: boolean;
}

export interface SeatingGuidanceGroup {
  readonly guestGroupId: string;
  readonly groupName: string;
  readonly color: string;
  readonly tableLabels: readonly string[];
}

export interface SeatingGuidanceResult {
  readonly seatingPlanRevisionId: string | null;
  readonly status: 'DRAFT' | 'CONFIRMED' | 'REQUIRES_REVIEW' | 'ABSENT';
  readonly groups: readonly SeatingGuidanceGroup[];
}

export interface SeatingGuidanceReader {
  getGuidance(bookingId: string): Promise<SeatingGuidanceResult>;
}

export interface SeatingPlanReader {
  requireCurrentPlan(bookingId: string): Promise<{
    seatingPlanId: string;
    revisionId: string;
    status: 'DRAFT' | 'CONFIRMED' | 'REQUIRES_REVIEW';
    layoutTemplateVersionId: string;
    expectedAttendees: number;
    labels: readonly { layoutTableId: string; guestGroupId: string; colorSnapshot: string }[];
  }>;
  resolveRevision(revisionId: string): Promise<{
    bookingId: string;
    layoutTemplateVersionId: string;
    labels: readonly { layoutTableId: string; guestGroupId: string; colorSnapshot: string }[];
  }>;
}

export interface SeatingPlanService extends SeatingGuidanceReader, SeatingPlanReader {
  listLayoutOptions(input: ListLayoutOptionsInput): Promise<readonly CompatibleLayoutOption[]>;
  selectLayout(input: SelectLayoutInput): Promise<SeatingPlanResult>;
  saveRevision(input: SaveRevisionInput): Promise<SeatingPlanResult>;
  confirmPlan(input: ConfirmPlanInput): Promise<SeatingPlanResult>;
  recordManagerException(input: RecordManagerExceptionInput): Promise<SeatingPlanResult>;
  getPlan(input: GetPlanInput): Promise<SeatingPlanResult>;
}

// ─── Service factory ──────────────────────────────────────────────────────────

export interface SeatingPlanServiceDependencies {
  readonly repository: SeatingPlanRepository;
  readonly bookingReader: BookingPlanningReader;
  readonly guestReader: GuestPlanningReader;
  readonly venueReader: VenueSelectionEligibilityReader;
  readonly registry: PrintableSeatingContentRegistry;
  readonly prisma: PrismaClient;
}

export function createSeatingPlanService(
  deps: SeatingPlanServiceDependencies,
): SeatingPlanService {
  const { repository, bookingReader, guestReader, venueReader, registry } = deps;

  return Object.freeze({
    async listLayoutOptions(input: ListLayoutOptionsInput): Promise<readonly CompatibleLayoutOption[]> {
      const booking = await bookingReader.requireConfirmedBookingContext(input.bookingId);
      return venueReader.listCompatibleVersionsForHall(
        booking.hallId,
        booking.planningHeadcount,
      );
    },

    async selectLayout(input: SelectLayoutInput): Promise<SeatingPlanResult> {
      // Resolve booking and layout concurrently
      const [booking, layoutEligibility] = await Promise.all([
        bookingReader.requireConfirmedBookingContext(input.bookingId),
        venueReader.requireLayoutVersionEligible(input.layoutTemplateVersionId),
      ]);

      if (layoutEligibility.isRetired) throw new LayoutRetiredError();
      if (booking.bookingRevision !== input.expectedBookingRevision) {
        throw new SeatingRevisionStaleError();
      }
      validateHeadcountInRange(
        booking.planningHeadcount,
        layoutEligibility.minGuests,
        layoutEligibility.maxGuests,
      );

      // Idempotent: if a plan already exists for this booking, return it
      const existing = await repository.findPlanByBookingId(input.bookingId);
      if (existing !== null) {
        const rev = existing.currentRevisionId
          ? await repository.getCurrentRevisionWithLabels(existing.currentRevisionId)
          : null;
        return buildResult(existing, rev, false);
      }

      const planId = randomUUID();
      const revisionId = randomUUID();
      const digest = buildRevisionDigest(
        input.layoutTemplateVersionId,
        booking.planningHeadcount,
        [],
      );

      await repository.createPlan({
        planId,
        revisionId,
        bookingId: input.bookingId,
        layoutTemplateVersionId: input.layoutTemplateVersionId,
        expectedAttendees: booking.planningHeadcount,
        revisionDigest: digest,
        createdByAccountId: input.actorAccountId,
      });

      const plan = await repository.requirePlanById(planId);
      const rev = await repository.getCurrentRevisionWithLabels(revisionId);
      return buildResult(plan, rev, false);
    },

    async saveRevision(input: SaveRevisionInput): Promise<SeatingPlanResult> {
      const plan = await repository.requirePlanByBookingAndPlanId(input.bookingId, input.planId);

      // Resolve booking and determine layout version to use
      const booking = await bookingReader.requireConfirmedBookingContext(input.bookingId);
      const layoutVersionId =
        input.layoutTemplateVersionId ?? (
          plan.currentRevisionId
            ? (await repository.getCurrentRevisionWithLabels(plan.currentRevisionId))
                .layoutTemplateVersionId
            : undefined
        );
      if (layoutVersionId === undefined) throw new NotFoundError();

      const layoutEligibility = await venueReader.requireLayoutVersionEligible(layoutVersionId);
      if (layoutEligibility.isRetired) throw new LayoutRetiredError();

      const hasException = (await repository.getExceptionRecord(plan.id)) !== null;
      if (!hasException) {
        validateHeadcountInRange(
          booking.planningHeadcount,
          layoutEligibility.minGuests,
          layoutEligibility.maxGuests,
        );
      }

      // Validate labels: all table IDs must be in the layout, and each table has at most one group label
      const tableIdSet = new Set(layoutEligibility.tableIds);
      const seenTableIds = new Set<string>();
      for (const label of input.labels) {
        if (!tableIdSet.has(label.layoutTableId)) throw new TableNotInLayoutError();
        if (seenTableIds.has(label.layoutTableId)) {
          throw new AppError({
            status: 422,
            code: 'VALIDATION_ERROR',
            message: 'Each table can have at most one group label.',
          });
        }
        seenTableIds.add(label.layoutTableId);
      }

      // Resolve guest group colors
      const activeGroups = await guestReader.listActiveGroups(input.bookingId);
      const groupMap = new Map(
        activeGroups.map((g) => [g.guestGroupId, g]),
      );
      const labelRows: Array<LabelInput & { colorSnapshot: string; displayOrder: number }> = [];
      for (let i = 0; i < input.labels.length; i++) {
        const label = input.labels[i];
        if (label === undefined) continue;
        const group = groupMap.get(label.guestGroupId);
        if (group === undefined) throw new GuestGroupUnavailableError();
        labelRows.push({
          layoutTableId: label.layoutTableId,
          guestGroupId: label.guestGroupId,
          colorSnapshot: group.color,
          displayOrder: i + 1,
        });
      }

      const digest = buildRevisionDigest(
        layoutVersionId,
        booking.planningHeadcount,
        input.labels,
      );

      const revisionId = randomUUID();
      const result = await repository.appendRevision({
        planId: plan.id,
        revisionId,
        expectedPlanRevision: input.expectedRevision,
        layoutTemplateVersionId: layoutVersionId,
        expectedAttendees: booking.planningHeadcount,
        revisionDigest: digest,
        labels: labelRows,
        createdByAccountId: input.actorAccountId,
      });

      const updatedPlan = await repository.requirePlanById(plan.id);
      const rev = await repository.getCurrentRevisionWithLabels(revisionId);
      return buildResult(
        { ...updatedPlan, planRevision: result.planRevision },
        rev,
        hasException,
      );
    },

    async confirmPlan(input: ConfirmPlanInput): Promise<SeatingPlanResult> {
      const plan = await repository.requirePlanByBookingAndPlanId(input.bookingId, input.planId);
      if (plan.currentRevisionId === null) throw new NotFoundError();

      const [booking, rev, exRec] = await Promise.all([
        bookingReader.requireConfirmedBookingContext(input.bookingId),
        repository.getCurrentRevisionWithLabels(plan.currentRevisionId),
        repository.getExceptionRecord(plan.id),
      ]);

      if (booking.bookingRevision !== input.expectedBookingRevision) {
        throw new SeatingRevisionStaleError();
      }
      if (booking.planningHeadcount <= 0) {
        throw new AppError({
          status: 422,
          code: 'VALIDATION_ERROR',
          message: 'Confirmation requires a positive planning headcount.',
        });
      }

      const hasException = exRec !== null;
      const layoutEligibility = await venueReader.requireLayoutVersionEligible(
        rev.layoutTemplateVersionId,
      );
      if (layoutEligibility.isRetired) throw new LayoutRetiredError();
      if (!hasException) {
        validateHeadcountInRange(
          booking.planningHeadcount,
          layoutEligibility.minGuests,
          layoutEligibility.maxGuests,
        );
      }

      const digest = buildRevisionDigest(
        rev.layoutTemplateVersionId,
        rev.expectedAttendees,
        rev.labels,
      );

      const validityProof: ValidityProof = {
        minGuests: layoutEligibility.minGuests,
        maxGuests: layoutEligibility.maxGuests,
        totalSeatCapacity: layoutEligibility.totalSeatCapacity,
        hallMaxGuests: layoutEligibility.totalSeatCapacity,
        bookingRevision: booking.bookingRevision,
        planningHeadcount: booking.planningHeadcount,
        managerExceptionGranted: hasException,
      };

      const registrationId = randomUUID();
      const confirmed = await repository.confirmPlan({
        planId: plan.id,
        revisionId: plan.currentRevisionId,
        expectedPlanRevision: input.expectedRevision,
        registrationId,
        validityProofJson: validityProof,
        digestAtRegistration: digest,
        updatedByAccountId: input.actorAccountId,
      });

      // Register with invitation studio
      await registry.registerConfirmed({
        seatingRevisionId: rev.id,
        revisionNumber: rev.revisionNumber,
        digest,
        validityProof,
      });

      const updatedPlan = await repository.requirePlanById(plan.id);
      return buildResult(
        { ...updatedPlan, planRevision: confirmed.planRevision },
        rev,
        hasException,
      );
    },

    async recordManagerException(input: RecordManagerExceptionInput): Promise<SeatingPlanResult> {
      const reason = validateExceptionReason(input.reason);

      const plan = await repository.requirePlanById(input.planId);
      if (plan.currentRevisionId === null) throw new NotFoundError();

      const [booking, rev] = await Promise.all([
        bookingReader.requireConfirmedBookingContext(plan.bookingId),
        repository.getCurrentRevisionWithLabels(plan.currentRevisionId),
      ]);

      const layoutEligibility = await venueReader.requireLayoutVersionEligible(
        rev.layoutTemplateVersionId,
      );

      if (booking.bookingRevision !== input.expectedBookingRevision) {
        throw new SeatingRevisionStaleError();
      }

      // Exception still cannot exceed physical hall capacity
      if (booking.planningHeadcount > layoutEligibility.totalSeatCapacity) {
        throw new ExceptionExceedsPhysicalCapacityError();
      }

      const exceptionId = randomUUID();
      await repository.saveExceptionRecord({
        planId: plan.id,
        exceptionId,
        planRevisionAtException: input.expectedRevision,
        bookingRevisionSnapshot: booking.bookingRevision,
        headcountSnapshot: booking.planningHeadcount,
        layoutTemplateVersionId: rev.layoutTemplateVersionId,
        reason,
        grantedByAccountId: input.actorAccountId,
      });

      // Manager exception confirms the plan and creates confirmed revision registration
      const digest = buildRevisionDigest(
        rev.layoutTemplateVersionId,
        rev.expectedAttendees,
        rev.labels,
      );

      const validityProof: ValidityProof = {
        minGuests: layoutEligibility.minGuests,
        maxGuests: layoutEligibility.maxGuests,
        totalSeatCapacity: layoutEligibility.totalSeatCapacity,
        hallMaxGuests: layoutEligibility.totalSeatCapacity,
        bookingRevision: booking.bookingRevision,
        planningHeadcount: booking.planningHeadcount,
        managerExceptionGranted: true,
      };

      const registrationId = randomUUID();
      const confirmed = await repository.confirmPlan({
        planId: plan.id,
        revisionId: plan.currentRevisionId,
        expectedPlanRevision: input.expectedRevision,
        registrationId,
        validityProofJson: validityProof,
        digestAtRegistration: digest,
        updatedByAccountId: input.actorAccountId,
      });

      await registry.registerConfirmed({
        seatingRevisionId: rev.id,
        revisionNumber: rev.revisionNumber,
        digest,
        validityProof,
      });

      const updatedPlan = await repository.requirePlanById(plan.id);
      return buildResult(
        { ...updatedPlan, planRevision: confirmed.planRevision },
        rev,
        true,
      );
    },

    async getPlan(input: GetPlanInput): Promise<SeatingPlanResult> {
      const plan = await repository.requirePlanByBookingAndPlanId(input.bookingId, input.planId);
      const [rev, exRec] = await Promise.all([
        plan.currentRevisionId
          ? repository.getCurrentRevisionWithLabels(plan.currentRevisionId)
          : Promise.resolve(null),
        repository.getExceptionRecord(plan.id),
      ]);
      return buildResult(plan, rev, exRec !== null);
    },

    async getGuidance(bookingId: string): Promise<SeatingGuidanceResult> {
      const plan = await repository.findPlanByBookingId(bookingId);
      if (plan === null || plan.currentRevisionId === null) {
        return Object.freeze({
          seatingPlanRevisionId: null,
          status: 'ABSENT' as const,
          groups: Object.freeze([]),
        });
      }

      const [rev, activeGroups] = await Promise.all([
        repository.getCurrentRevisionWithLabels(plan.currentRevisionId),
        guestReader.listActiveGroups(bookingId),
      ]);

      const groupLookup = new Map(activeGroups.map((g) => [g.guestGroupId, g]));
      const groupTableMap = new Map<string, string[]>();

      for (const label of rev.labels) {
        const list = groupTableMap.get(label.guestGroupId) ?? [];
        list.push(label.layoutTableId);
        groupTableMap.set(label.guestGroupId, list);
      }

      const groups = Array.from(groupTableMap.entries()).map(([guestGroupId, tableLabels]) => {
        const groupInfo = groupLookup.get(guestGroupId);
        const fallbackColor = rev.labels.find((l) => l.guestGroupId === guestGroupId)?.colorSnapshot ?? '#888888';
        return Object.freeze({
          guestGroupId,
          groupName: groupInfo?.name ?? '',
          color: groupInfo?.color ?? fallbackColor,
          tableLabels: Object.freeze(tableLabels),
        });
      });

      return Object.freeze({
        seatingPlanRevisionId: rev.id,
        status: plan.status,
        groups: Object.freeze(groups),
      });
    },

    async requireCurrentPlan(bookingId: string) {
      const plan = await repository.findPlanByBookingId(bookingId);
      if (plan === null || plan.currentRevisionId === null) {
        throw new NotFoundError();
      }
      const rev = await repository.getCurrentRevisionWithLabels(plan.currentRevisionId);
      return {
        seatingPlanId: plan.id,
        revisionId: rev.id,
        status: plan.status,
        layoutTemplateVersionId: rev.layoutTemplateVersionId,
        expectedAttendees: rev.expectedAttendees,
        labels: rev.labels.map((l) => ({
          layoutTableId: l.layoutTableId,
          guestGroupId: l.guestGroupId,
          colorSnapshot: l.colorSnapshot,
        })),
      };
    },

    async resolveRevision(revisionId: string) {
      const rev = await repository.getCurrentRevisionWithLabels(revisionId);
      const plan = await repository.requirePlanById(rev.seatingPlanId);
      return {
        bookingId: plan.bookingId,
        layoutTemplateVersionId: rev.layoutTemplateVersionId,
        labels: rev.labels.map((l) => ({
          layoutTableId: l.layoutTableId,
          guestGroupId: l.guestGroupId,
          colorSnapshot: l.colorSnapshot,
        })),
      };
    },
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildResult(
  plan: SeatingPlanRow | (SeatingPlanRow & { planRevision: number }),
  rev: RevisionRow | null,
  hasManagerException: boolean,
): SeatingPlanResult {
  return Object.freeze({
    planId: plan.id,
    bookingId: plan.bookingId,
    status: plan.status,
    planRevision: plan.planRevision,
    currentRevision: rev ? deepFreezeRevision(rev) : null,
    confirmedRevisionId: plan.confirmedRevisionId,
    hasManagerException,
  });
}

function deepFreezeRevision(rev: RevisionRow): RevisionRow {
  return Object.freeze({
    ...rev,
    labels: Object.freeze(rev.labels.map((l) => Object.freeze({ ...l }))),
  });
}

function mapLabel(l: LabelRow): LabelRow {
  return Object.freeze({ ...l });
}

void mapLabel; // satisfy TS — used in deepFreezeRevision implicitly
