import { AppError, NotFoundError } from '../../../core/errors/app-error.js';
import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import { SeatingRevisionStaleError } from '../domain/seating-plan.policy.js';
import type { LabelInput } from '../domain/seating-plan.policy.js';

// ─── Data types ───────────────────────────────────────────────────────────────

export interface SeatingPlanRow {
  readonly id: string;
  readonly bookingId: string;
  readonly status: 'DRAFT' | 'CONFIRMED' | 'REQUIRES_REVIEW';
  readonly currentRevisionId: string | null;
  readonly confirmedRevisionId: string | null;
  readonly planRevision: number;
  readonly createdByAccountId: string;
  readonly updatedByAccountId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface LabelRow {
  readonly layoutTableId: string;
  readonly guestGroupId: string;
  readonly colorSnapshot: string;
  readonly displayOrder: number;
}

export interface RevisionRow {
  readonly id: string;
  readonly seatingPlanId: string;
  readonly revisionNumber: number;
  readonly layoutTemplateVersionId: string;
  readonly expectedAttendees: number;
  readonly revisionDigest: string;
  readonly createdByAccountId: string;
  readonly createdAt: Date;
  readonly labels: readonly LabelRow[];
}

export interface CreatePlanInput {
  readonly planId: string;
  readonly revisionId: string;
  readonly bookingId: string;
  readonly layoutTemplateVersionId: string;
  readonly expectedAttendees: number;
  readonly revisionDigest: string;
  readonly createdByAccountId: string;
}

export interface AppendRevisionInput {
  readonly planId: string;
  readonly revisionId: string;
  readonly expectedPlanRevision: number;
  readonly layoutTemplateVersionId: string;
  readonly expectedAttendees: number;
  readonly revisionDigest: string;
  readonly labels: readonly (LabelInput & { colorSnapshot: string; displayOrder: number })[];
  readonly createdByAccountId: string;
}

export interface ConfirmPlanInput {
  readonly planId: string;
  readonly revisionId: string;
  readonly expectedPlanRevision: number;
  readonly registrationId: string;
  readonly validityProofJson: unknown;
  readonly digestAtRegistration: string;
  readonly updatedByAccountId: string;
}

export interface SaveExceptionInput {
  readonly planId: string;
  readonly exceptionId: string;
  readonly planRevisionAtException: number;
  readonly bookingRevisionSnapshot: number;
  readonly headcountSnapshot: number;
  readonly layoutTemplateVersionId: string;
  readonly reason: string;
  readonly grantedByAccountId: string;
}

export interface SeatingPlanRepository {
  findPlanByBookingId(bookingId: string): Promise<SeatingPlanRow | null>;
  requirePlanById(planId: string): Promise<SeatingPlanRow>;
  requirePlanByBookingAndPlanId(bookingId: string, planId: string): Promise<SeatingPlanRow>;
  createPlan(input: CreatePlanInput): Promise<void>;
  appendRevision(
    input: AppendRevisionInput,
  ): Promise<{ revisionId: string; revisionNumber: number; planRevision: number }>;
  confirmPlan(input: ConfirmPlanInput): Promise<{ planRevision: number }>;
  invalidatePlan(planId: string): Promise<void>;
  saveExceptionRecord(input: SaveExceptionInput): Promise<void>;
  getCurrentRevisionWithLabels(revisionId: string): Promise<RevisionRow>;
  getExceptionRecord(planId: string): Promise<{
    readonly reason: string;
    readonly grantedByAccountId: string;
    readonly headcountSnapshot: number;
    readonly createdAt: Date;
  } | null>;
}

// ─── Conflict error ───────────────────────────────────────────────────────────

export class SeatingPlanConflictError extends AppError {
  constructor(code: string, message: string) {
    super({ status: 409, code, message });
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createSeatingPlanRepository(prisma: PrismaClient): SeatingPlanRepository {
  return Object.freeze({
    async findPlanByBookingId(bookingId: string): Promise<SeatingPlanRow | null> {
      const row = await prisma.seatingPlan.findUnique({
        where: { bookingId },
      });
      return row ? mapPlanRow(row) : null;
    },

    async requirePlanById(planId: string): Promise<SeatingPlanRow> {
      const row = await prisma.seatingPlan.findUnique({ where: { id: planId } });
      if (row === null) throw new NotFoundError();
      return mapPlanRow(row);
    },

    async requirePlanByBookingAndPlanId(
      bookingId: string,
      planId: string,
    ): Promise<SeatingPlanRow> {
      const row = await prisma.seatingPlan.findUnique({ where: { id: planId } });
      // Conceal ownership — treat "wrong booking" as not found to avoid enumeration
      if (row === null || row.bookingId !== bookingId) throw new NotFoundError();
      return mapPlanRow(row);
    },

    async createPlan(input: CreatePlanInput): Promise<void> {
      await prisma.$transaction(async (tx) => {
        await tx.seatingPlan.create({
          data: {
            id: input.planId,
            bookingId: input.bookingId,
            status: 'DRAFT',
            currentRevisionId: input.revisionId,
            confirmedRevisionId: null,
            planRevision: 1,
            createdByAccountId: input.createdByAccountId,
            updatedByAccountId: input.createdByAccountId,
          },
        });
        await tx.seatingPlanRevision.create({
          data: {
            id: input.revisionId,
            seatingPlanId: input.planId,
            revisionNumber: 1,
            layoutTemplateVersionId: input.layoutTemplateVersionId,
            expectedAttendees: input.expectedAttendees,
            revisionDigest: input.revisionDigest,
            createdByAccountId: input.createdByAccountId,
          },
        });
      });
    },

    async appendRevision(
      input: AppendRevisionInput,
    ): Promise<{ revisionId: string; revisionNumber: number; planRevision: number }> {
      return prisma.$transaction(async (tx) => {
        // CAS on planRevision for optimistic concurrency
        const updated = await tx.$queryRaw<Array<{ planRevision: number; nextRevisionNumber: number }>>(
          Prisma.sql`
            UPDATE "SeatingPlan"
               SET "planRevision"       = "planRevision" + 1,
                   "currentRevisionId" = ${input.revisionId}::uuid,
                   "status"            = 'DRAFT',
                   "updatedByAccountId" = ${input.createdByAccountId}::uuid,
                   "updatedAt"          = NOW()
             WHERE "id" = ${input.planId}::uuid
               AND "planRevision" = ${input.expectedPlanRevision}
          RETURNING "planRevision",
                    (SELECT COALESCE(MAX("revisionNumber"), 0) + 1
                       FROM "SeatingPlanRevision"
                      WHERE "seatingPlanId" = ${input.planId}::uuid) AS "nextRevisionNumber"
          `,
        );
        const winner = updated[0];
        if (winner === undefined) throw new SeatingRevisionStaleError();

        const revisionNumber = Number(winner.nextRevisionNumber);
        const planRevision = Number(winner.planRevision);

        await tx.seatingPlanRevision.create({
          data: {
            id: input.revisionId,
            seatingPlanId: input.planId,
            revisionNumber,
            layoutTemplateVersionId: input.layoutTemplateVersionId,
            expectedAttendees: input.expectedAttendees,
            revisionDigest: input.revisionDigest,
            createdByAccountId: input.createdByAccountId,
          },
        });

        if (input.labels.length > 0) {
          await tx.seatingPlanLabel.createMany({
            data: input.labels.map((label) => ({
              revisionId: input.revisionId,
              layoutTableId: label.layoutTableId,
              guestGroupId: label.guestGroupId,
              colorSnapshot: label.colorSnapshot,
              displayOrder: label.displayOrder,
            })),
          });
        }

        return { revisionId: input.revisionId, revisionNumber, planRevision };
      });
    },

    async confirmPlan(input: ConfirmPlanInput): Promise<{ planRevision: number }> {
      return prisma.$transaction(async (tx) => {
        const updated = await tx.$queryRaw<Array<{ planRevision: number }>>(
          Prisma.sql`
            UPDATE "SeatingPlan"
               SET "planRevision"        = "planRevision" + 1,
                   "status"              = 'CONFIRMED',
                   "confirmedRevisionId" = ${input.revisionId}::uuid,
                   "updatedByAccountId"  = ${input.updatedByAccountId}::uuid,
                   "updatedAt"           = NOW()
             WHERE "id"          = ${input.planId}::uuid
               AND "planRevision" = ${input.expectedPlanRevision}
               AND "currentRevisionId" = ${input.revisionId}::uuid
          RETURNING "planRevision"
          `,
        );
        const winner = updated[0];
        if (winner === undefined) throw new SeatingRevisionStaleError();

        await tx.seatingRevisionRegistration.create({
          data: {
            id: input.registrationId,
            revisionId: input.revisionId,
            validityProofJson: input.validityProofJson as Prisma.JsonObject,
            digestAtRegistration: input.digestAtRegistration,
          },
        });

        return { planRevision: Number(winner.planRevision) };
      });
    },

    async invalidatePlan(planId: string): Promise<void> {
      await prisma.seatingPlan.update({
        where: { id: planId },
        data: { status: 'REQUIRES_REVIEW', updatedAt: new Date() },
      });
    },

    async saveExceptionRecord(input: SaveExceptionInput): Promise<void> {
      await prisma.seatingPlanExceptionRecord.upsert({
        where: { seatingPlanId: input.planId },
        create: {
          id: input.exceptionId,
          seatingPlanId: input.planId,
          planRevisionAtException: input.planRevisionAtException,
          bookingRevisionSnapshot: input.bookingRevisionSnapshot,
          headcountSnapshot: input.headcountSnapshot,
          layoutTemplateVersionId: input.layoutTemplateVersionId,
          reason: input.reason,
          grantedByAccountId: input.grantedByAccountId,
        },
        update: {
          planRevisionAtException: input.planRevisionAtException,
          bookingRevisionSnapshot: input.bookingRevisionSnapshot,
          headcountSnapshot: input.headcountSnapshot,
          layoutTemplateVersionId: input.layoutTemplateVersionId,
          reason: input.reason,
          grantedByAccountId: input.grantedByAccountId,
        },
      });
    },

    async getCurrentRevisionWithLabels(revisionId: string): Promise<RevisionRow> {
      const row = await prisma.seatingPlanRevision.findUnique({
        where: { id: revisionId },
        include: {
          labels: {
            orderBy: { displayOrder: 'asc' },
          },
        },
      });
      if (row === null) throw new NotFoundError();
      return Object.freeze({
        id: row.id,
        seatingPlanId: row.seatingPlanId,
        revisionNumber: row.revisionNumber,
        layoutTemplateVersionId: row.layoutTemplateVersionId,
        expectedAttendees: row.expectedAttendees,
        revisionDigest: row.revisionDigest,
        createdByAccountId: row.createdByAccountId,
        createdAt: row.createdAt,
        labels: Object.freeze(
          row.labels.map((l) =>
            Object.freeze({
              layoutTableId: l.layoutTableId,
              guestGroupId: l.guestGroupId,
              colorSnapshot: l.colorSnapshot,
              displayOrder: l.displayOrder,
            }),
          ),
        ),
      });
    },

    async getExceptionRecord(planId: string): Promise<{
      readonly reason: string;
      readonly grantedByAccountId: string;
      readonly headcountSnapshot: number;
      readonly createdAt: Date;
    } | null> {
      const rec = await prisma.seatingPlanExceptionRecord.findUnique({
        where: { seatingPlanId: planId },
        select: {
          reason: true,
          grantedByAccountId: true,
          headcountSnapshot: true,
          createdAt: true,
        },
      });
      return rec;
    },
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapPlanRow(row: {
  id: string;
  bookingId: string;
  status: 'DRAFT' | 'CONFIRMED' | 'REQUIRES_REVIEW';
  currentRevisionId: string | null;
  confirmedRevisionId: string | null;
  planRevision: number;
  createdByAccountId: string;
  updatedByAccountId: string;
  createdAt: Date;
  updatedAt: Date;
}): SeatingPlanRow {
  return Object.freeze({
    id: row.id,
    bookingId: row.bookingId,
    status: row.status,
    currentRevisionId: row.currentRevisionId,
    confirmedRevisionId: row.confirmedRevisionId,
    planRevision: row.planRevision,
    createdByAccountId: row.createdByAccountId,
    updatedByAccountId: row.updatedByAccountId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
