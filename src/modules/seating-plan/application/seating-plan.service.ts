import { randomUUID } from 'node:crypto';

import { AppError, NotFoundError } from '../../../core/errors/app-error.js';
import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import {
  buildRevisionDigest,
  ExceptionExceedsPhysicalCapacityError,
  LayoutRetiredError,
  SeatingRevisionStaleError,
  TableNotInLayoutError,
  GuestGroupUnavailableError,
  validateExceptionReason,
  validateHeadcountInRange,
  type LabelInput,
} from '../domain/seating-plan.policy.js';
import type {
  BookingContext,
  BookingPlanningReader,
  CompatibleLayoutOption,
  GuestPlanningReader,
  PrintableSeatingContentRegistry,
  ValidityProof,
  VenueSelectionEligibilityReader,
} from '../domain/seating-plan.providers.js';
import type {
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
  readonly layoutTemplateVersionId?: string | undefined;
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
  const { repository, bookingReader, guestReader, venueReader, registry, prisma } = deps;

  async function revalidatePlanStatus(
    plan: SeatingPlanRow,
    rev: RevisionRow | null,
    booking: BookingContext,
    exRec: { headcountSnapshot: number; bookingRevisionSnapshot: number } | null,
  ): Promise<'DRAFT' | 'CONFIRMED' | 'REQUIRES_REVIEW'> {
    if (plan.status !== 'CONFIRMED' || rev === null) {
      return plan.status;
    }
    const hasValidException =
      exRec !== null &&
      exRec.headcountSnapshot === booking.planningHeadcount &&
      exRec.bookingRevisionSnapshot === booking.bookingRevision;

    let isInvalid = false;
    try {
      const layoutEligibility = await venueReader.requireLayoutVersionEligible(rev.layoutTemplateVersionId);
      if (layoutEligibility.isRetired) {
        isInvalid = true;
      } else if (!hasValidException) {
        if (booking.planningHeadcount < layoutEligibility.minGuests || booking.planningHeadcount > layoutEligibility.maxGuests) {
          isInvalid = true;
        }
      }
    } catch {
      isInvalid = true;
    }

    if (isInvalid) {
      await repository.invalidatePlan(plan.id);
      if (plan.confirmedRevisionId) {
        await registry.markRequiresReview(plan.confirmedRevisionId);
      }
      return 'REQUIRES_REVIEW';
    }
    return 'CONFIRMED';
  }

  return Object.freeze({
    async listLayoutOptions(input: ListLayoutOptionsInput): Promise<readonly CompatibleLayoutOption[]> {
      const booking = await bookingReader.requireConfirmedBookingContext(input.bookingId);
      return venueReader.listCompatibleVersionsForHall(
        booking.hallId,
        booking.planningHeadcount,
      );
    },

    async selectLayout(input: SelectLayoutInput): Promise<SeatingPlanResult> {
      const [booking, layoutEligibility] = await Promise.all([
        bookingReader.requireConfirmedBookingContext(input.bookingId),
        venueReader.requireLayoutVersionEligible(input.layoutTemplateVersionId),
      ]);

      if (layoutEligibility.isRetired) throw new LayoutRetiredError();
      if (layoutEligibility.hallId !== booking.hallId) {
        throw new TableNotInLayoutError();
      }
      if (booking.bookingRevision !== input.expectedBookingRevision) {
        throw new SeatingRevisionStaleError();
      }
      if (booking.planningHeadcount > 0) {
        validateHeadcountInRange(
          booking.planningHeadcount,
          layoutEligibility.minGuests,
          layoutEligibility.maxGuests,
        );
      }

      const existing = await repository.findPlanByBookingId(input.bookingId);
      if (existing !== null) {
        const rev = existing.currentRevisionId
          ? await repository.getCurrentRevisionWithLabels(existing.currentRevisionId)
          : null;
        if (rev !== null && rev.layoutTemplateVersionId === input.layoutTemplateVersionId) {
          const exRec = await repository.getExceptionRecord(existing.id);
          const hasValidException =
            exRec !== null &&
            exRec.headcountSnapshot === booking.planningHeadcount &&
            exRec.bookingRevisionSnapshot === booking.bookingRevision;
          return buildResult(existing, rev, hasValidException);
        }

        const tableIdSet = new Set(layoutEligibility.tableIds);
        const preservedLabels = (rev?.labels ?? [])
          .filter((l) => tableIdSet.has(l.layoutTableId))
          .map((l, idx) => ({
            layoutTableId: l.layoutTableId,
            guestGroupId: l.guestGroupId,
            colorSnapshot: l.colorSnapshot,
            displayOrder: idx + 1,
          }));

        const revisionId = randomUUID();
        const digest = buildRevisionDigest(
          input.layoutTemplateVersionId,
          booking.planningHeadcount,
          preservedLabels,
        );
        const appendRes = await repository.appendRevision({
          planId: existing.id,
          revisionId,
          expectedPlanRevision: existing.planRevision,
          layoutTemplateVersionId: input.layoutTemplateVersionId,
          expectedAttendees: booking.planningHeadcount,
          revisionDigest: digest,
          labels: preservedLabels,
          createdByAccountId: input.actorAccountId,
        });
        const updatedPlan = await repository.requirePlanById(existing.id);
        const newRev = await repository.getCurrentRevisionWithLabels(revisionId);
        return buildResult(
          { ...updatedPlan, planRevision: appendRes.planRevision },
          newRev,
          false,
        );
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
      if (layoutEligibility.hallId !== booking.hallId) throw new TableNotInLayoutError();

      const exRec = await repository.getExceptionRecord(plan.id);
      const hasValidException =
        exRec !== null &&
        exRec.headcountSnapshot === booking.planningHeadcount &&
        exRec.bookingRevisionSnapshot === booking.bookingRevision;

      if (!hasValidException && booking.planningHeadcount > 0) {
        validateHeadcountInRange(
          booking.planningHeadcount,
          layoutEligibility.minGuests,
          layoutEligibility.maxGuests,
        );
      }

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
        hasValidException,
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

      const hasValidException =
        exRec !== null &&
        exRec.headcountSnapshot === booking.planningHeadcount &&
        exRec.bookingRevisionSnapshot === booking.bookingRevision;

      const layoutEligibility = await venueReader.requireLayoutVersionEligible(
        rev.layoutTemplateVersionId,
      );
      if (layoutEligibility.isRetired) throw new LayoutRetiredError();
      if (!hasValidException) {
        validateHeadcountInRange(
          booking.planningHeadcount,
          layoutEligibility.minGuests,
          layoutEligibility.maxGuests,
        );
      }

      const digest = buildRevisionDigest(
        rev.layoutTemplateVersionId,
        booking.planningHeadcount,
        rev.labels,
      );

      const validityProof: ValidityProof = {
        minGuests: layoutEligibility.minGuests,
        maxGuests: layoutEligibility.maxGuests,
        totalSeatCapacity: layoutEligibility.totalSeatCapacity,
        hallMaxGuests: layoutEligibility.hallMaxGuests,
        bookingRevision: booking.bookingRevision,
        planningHeadcount: booking.planningHeadcount,
        managerExceptionGranted: hasValidException,
      };

      const existingRegistration = await prisma.seatingRevisionRegistration.findUnique({
        where: { revisionId: rev.id },
      });

      let targetRevision = rev;
      let targetPlanRevision = input.expectedRevision;

      const result = await prisma.$transaction(async (tx) => {
        if (existingRegistration !== null || plan.status === 'REQUIRES_REVIEW') {
          const newRevisionId = randomUUID();
          const appendRes = await tx.$queryRaw<Array<{ revisionNumber: number; planRevision: number }>>(Prisma.sql`
            WITH max_rev AS (
              SELECT COALESCE(MAX("revisionNumber"), 0) + 1 AS next_rev
              FROM "SeatingPlanRevision"
              WHERE "seatingPlanId" = ${plan.id}::uuid
            ),
            plan_upd AS (
              UPDATE "SeatingPlan"
              SET "planRevision" = "planRevision" + 1,
                  "currentRevisionId" = ${newRevisionId}::uuid,
                  "updatedByAccountId" = ${input.actorAccountId}::uuid,
                  "updatedAt" = NOW()
              WHERE "id" = ${plan.id}::uuid
                AND "planRevision" = ${input.expectedRevision}
              RETURNING "planRevision"
            ),
            rev_ins AS (
              INSERT INTO "SeatingPlanRevision" ("id", "seatingPlanId", "revisionNumber", "layoutTemplateVersionId", "expectedAttendees", "revisionDigest", "createdByAccountId", "createdAt")
              SELECT ${newRevisionId}::uuid, ${plan.id}::uuid, max_rev.next_rev, ${rev.layoutTemplateVersionId}::uuid, ${booking.planningHeadcount}, ${digest}, ${input.actorAccountId}::uuid, NOW()
              FROM max_rev, plan_upd
              RETURNING "revisionNumber"
            )
            SELECT rev_ins."revisionNumber", plan_upd."planRevision"
            FROM rev_ins, plan_upd
          `);
          if (!appendRes[0]) throw new SeatingRevisionStaleError();

          targetPlanRevision = appendRes[0].planRevision;
          if (rev.labels.length > 0) {
            await tx.seatingPlanLabel.createMany({
              data: rev.labels.map((l) => ({
                revisionId: newRevisionId,
                layoutTableId: l.layoutTableId,
                guestGroupId: l.guestGroupId,
                colorSnapshot: l.colorSnapshot,
                displayOrder: l.displayOrder,
              })),
            });
          }

          targetRevision = {
            ...rev,
            id: newRevisionId,
            revisionNumber: appendRes[0].revisionNumber,
            expectedAttendees: booking.planningHeadcount,
            revisionDigest: digest,
          };
        }

        const confirmRes = await tx.$queryRaw<Array<{ planRevision: number }>>(Prisma.sql`
          UPDATE "SeatingPlan"
          SET "planRevision" = "planRevision" + 1,
              "status" = 'CONFIRMED',
              "confirmedRevisionId" = ${targetRevision.id}::uuid,
              "updatedByAccountId" = ${input.actorAccountId}::uuid,
              "updatedAt" = NOW()
          WHERE "id" = ${plan.id}::uuid
            AND "planRevision" = ${targetPlanRevision}
            AND "currentRevisionId" = ${targetRevision.id}::uuid
          RETURNING "planRevision"
        `);
        if (!confirmRes[0]) throw new SeatingRevisionStaleError();

        const registrationId = randomUUID();
        await tx.seatingRevisionRegistration.create({
          data: {
            id: registrationId,
            revisionId: targetRevision.id,
            validityProofJson: validityProof as unknown as Prisma.InputJsonValue,
            digestAtRegistration: digest,
          },
        });

        await registry.registerConfirmed({
          seatingRevisionId: targetRevision.id,
          revisionNumber: targetRevision.revisionNumber,
          digest,
          validityProof,
        });

        return { planRevision: confirmRes[0].planRevision };
      });

      const updatedPlan = await repository.requirePlanById(plan.id);
      return buildResult(
        { ...updatedPlan, planRevision: result.planRevision },
        targetRevision,
        hasValidException,
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

      // Manager exception cannot override a retired layout
      if (layoutEligibility.isRetired) {
        throw new LayoutRetiredError();
      }

      if (booking.bookingRevision !== input.expectedBookingRevision) {
        throw new SeatingRevisionStaleError();
      }

      if (
        booking.planningHeadcount > layoutEligibility.totalSeatCapacity ||
        booking.planningHeadcount > layoutEligibility.hallMaxGuests
      ) {
        throw new ExceptionExceedsPhysicalCapacityError();
      }

      const digest = buildRevisionDigest(
        rev.layoutTemplateVersionId,
        booking.planningHeadcount,
        rev.labels,
      );

      const validityProof: ValidityProof = {
        minGuests: layoutEligibility.minGuests,
        maxGuests: layoutEligibility.maxGuests,
        totalSeatCapacity: layoutEligibility.totalSeatCapacity,
        hallMaxGuests: layoutEligibility.hallMaxGuests,
        bookingRevision: booking.bookingRevision,
        planningHeadcount: booking.planningHeadcount,
        managerExceptionGranted: true,
      };

      const existingRegistration = await prisma.seatingRevisionRegistration.findUnique({
        where: { revisionId: rev.id },
      });

      let targetRevision = rev;
      let targetPlanRevision = input.expectedRevision;

      const result = await prisma.$transaction(async (tx) => {
        await tx.seatingPlanExceptionRecord.upsert({
          where: { seatingPlanId: plan.id },
          create: {
            id: randomUUID(),
            seatingPlanId: plan.id,
            planRevisionAtException: input.expectedRevision,
            bookingRevisionSnapshot: booking.bookingRevision,
            headcountSnapshot: booking.planningHeadcount,
            layoutTemplateVersionId: rev.layoutTemplateVersionId,
            reason,
            grantedByAccountId: input.actorAccountId,
          },
          update: {
            planRevisionAtException: input.expectedRevision,
            bookingRevisionSnapshot: booking.bookingRevision,
            headcountSnapshot: booking.planningHeadcount,
            layoutTemplateVersionId: rev.layoutTemplateVersionId,
            reason,
            grantedByAccountId: input.actorAccountId,
          },
        });

        if (existingRegistration !== null || plan.status === 'REQUIRES_REVIEW') {
          const newRevisionId = randomUUID();
          const appendRes = await tx.$queryRaw<Array<{ revisionNumber: number; planRevision: number }>>(Prisma.sql`
            WITH max_rev AS (
              SELECT COALESCE(MAX("revisionNumber"), 0) + 1 AS next_rev
              FROM "SeatingPlanRevision"
              WHERE "seatingPlanId" = ${plan.id}::uuid
            ),
            plan_upd AS (
              UPDATE "SeatingPlan"
              SET "planRevision" = "planRevision" + 1,
                  "currentRevisionId" = ${newRevisionId}::uuid,
                  "updatedByAccountId" = ${input.actorAccountId}::uuid,
                  "updatedAt" = NOW()
              WHERE "id" = ${plan.id}::uuid
                AND "planRevision" = ${input.expectedRevision}
              RETURNING "planRevision"
            ),
            rev_ins AS (
              INSERT INTO "SeatingPlanRevision" ("id", "seatingPlanId", "revisionNumber", "layoutTemplateVersionId", "expectedAttendees", "revisionDigest", "createdByAccountId", "createdAt")
              SELECT ${newRevisionId}::uuid, ${plan.id}::uuid, max_rev.next_rev, ${rev.layoutTemplateVersionId}::uuid, ${booking.planningHeadcount}, ${digest}, ${input.actorAccountId}::uuid, NOW()
              FROM max_rev, plan_upd
              RETURNING "revisionNumber"
            )
            SELECT rev_ins."revisionNumber", plan_upd."planRevision"
            FROM rev_ins, plan_upd
          `);
          if (!appendRes[0]) throw new SeatingRevisionStaleError();

          targetPlanRevision = appendRes[0].planRevision;
          if (rev.labels.length > 0) {
            await tx.seatingPlanLabel.createMany({
              data: rev.labels.map((l) => ({
                revisionId: newRevisionId,
                layoutTableId: l.layoutTableId,
                guestGroupId: l.guestGroupId,
                colorSnapshot: l.colorSnapshot,
                displayOrder: l.displayOrder,
              })),
            });
          }

          targetRevision = {
            ...rev,
            id: newRevisionId,
            revisionNumber: appendRes[0].revisionNumber,
            expectedAttendees: booking.planningHeadcount,
            revisionDigest: digest,
          };
        }

        const confirmRes = await tx.$queryRaw<Array<{ planRevision: number }>>(Prisma.sql`
          UPDATE "SeatingPlan"
          SET "planRevision" = "planRevision" + 1,
              "status" = 'CONFIRMED',
              "confirmedRevisionId" = ${targetRevision.id}::uuid,
              "updatedByAccountId" = ${input.actorAccountId}::uuid,
              "updatedAt" = NOW()
          WHERE "id" = ${plan.id}::uuid
            AND "planRevision" = ${targetPlanRevision}
            AND "currentRevisionId" = ${targetRevision.id}::uuid
          RETURNING "planRevision"
        `);
        if (!confirmRes[0]) throw new SeatingRevisionStaleError();

        const registrationId = randomUUID();
        await tx.seatingRevisionRegistration.create({
          data: {
            id: registrationId,
            revisionId: targetRevision.id,
            validityProofJson: validityProof as unknown as Prisma.InputJsonValue,
            digestAtRegistration: digest,
          },
        });

        await registry.registerConfirmed({
          seatingRevisionId: targetRevision.id,
          revisionNumber: targetRevision.revisionNumber,
          digest,
          validityProof,
        });

        return { planRevision: confirmRes[0].planRevision };
      });

      const updatedPlan = await repository.requirePlanById(plan.id);
      return buildResult(
        { ...updatedPlan, planRevision: result.planRevision },
        targetRevision,
        true,
      );
    },

    async getPlan(input: GetPlanInput): Promise<SeatingPlanResult> {
      const plan = await repository.requirePlanByBookingAndPlanId(input.bookingId, input.planId);
      const [booking, rev, exRec] = await Promise.all([
        bookingReader.requireConfirmedBookingContext(input.bookingId),
        plan.currentRevisionId
          ? repository.getCurrentRevisionWithLabels(plan.currentRevisionId)
          : Promise.resolve(null),
        repository.getExceptionRecord(plan.id),
      ]);
      const hasValidException =
        exRec !== null &&
        exRec.headcountSnapshot === booking.planningHeadcount &&
        exRec.bookingRevisionSnapshot === booking.bookingRevision;

      const status = await revalidatePlanStatus(plan, rev, booking, exRec);
      const planToReturn = status !== plan.status ? { ...plan, status } : plan;
      return buildResult(planToReturn, rev, hasValidException);
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

      const [bookingResult, rev, exRec, activeGroups, layoutEligibility] = await Promise.all([
        bookingReader.requireConfirmedBookingContext(bookingId).catch(() => null),
        repository.getCurrentRevisionWithLabels(plan.currentRevisionId),
        repository.getExceptionRecord(plan.id),
        guestReader.listActiveGroups(bookingId),
        venueReader.requireLayoutVersionEligible(
          (await repository.getCurrentRevisionWithLabels(plan.currentRevisionId)).layoutTemplateVersionId,
        ).catch(() => null),
      ]);

      let planStatus = plan.status;
      if (bookingResult !== null) {
        planStatus = await revalidatePlanStatus(plan, rev, bookingResult, exRec);
      }

      const tableLabelMap = new Map<string, string>();
      if (layoutEligibility?.tables !== undefined) {
        for (const t of layoutEligibility.tables) {
          tableLabelMap.set(t.tableId, t.label);
        }
      }

      const groupLookup = new Map(activeGroups.map((g) => [g.guestGroupId, g]));
      const groupTableMap = new Map<string, string[]>();

      for (const label of rev.labels) {
        const list = groupTableMap.get(label.guestGroupId) ?? [];
        const displayLabel = tableLabelMap.get(label.layoutTableId) ?? label.layoutTableId;
        list.push(displayLabel);
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
        status: planStatus,
        groups: Object.freeze(groups),
      });
    },

    async requireCurrentPlan(bookingId: string) {
      const plan = await repository.findPlanByBookingId(bookingId);
      if (plan === null || plan.currentRevisionId === null) {
        throw new NotFoundError();
      }
      const [bookingResult, rev, exRec] = await Promise.all([
        bookingReader.requireConfirmedBookingContext(bookingId).catch(() => null),
        repository.getCurrentRevisionWithLabels(plan.currentRevisionId),
        repository.getExceptionRecord(plan.id),
      ]);

      let status = plan.status;
      if (bookingResult !== null) {
        status = await revalidatePlanStatus(plan, rev, bookingResult, exRec);
      }

      return {
        seatingPlanId: plan.id,
        revisionId: rev.id,
        status,
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
