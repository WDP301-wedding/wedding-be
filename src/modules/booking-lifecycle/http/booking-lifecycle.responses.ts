import { z } from 'zod';
import { proposalMenuSnapshotSchema, proposalMenuLinesSchema } from '../domain/booking-policy.js';

const uuid = z.uuid();
const revision = z.int().positive();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u);
const timestamp = z.iso.datetime();
const items = z.array(
  z.strictObject({
    itemId: uuid,
    order: z.int().min(0).max(99),
    startTime: time,
    title: z.string(),
    description: z.string().nullable(),
  }),
);

const proposalTimeline = z.strictObject({
  revisionId: uuid,
  revisionNumber: revision,
  predecessorRevisionId: uuid.nullable(),
  managerApprovedAt: timestamp.nullable(),
  coupleApprovedAt: timestamp.nullable(),
  items,
});

export const proposalResponseSchema = z.strictObject({
  data: z.strictObject({
    bookingId: uuid,
    consultationId: uuid,
    phase: z.enum(['DRAFT', 'AWAITING_DEPOSIT', 'CONFIRMED', 'CANCELLED', 'COMPLETED']),
    revision,
    eventDate: z.iso.date(),
    planningHeadcount: z.int().min(0).max(10000),
    commercialSource: z.enum(['APPENDIX', 'CONTRACT', 'PROPOSAL']).optional(),
    capacity: z
      .strictObject({
        guestsPerTable: z.literal(10),
        minimumTables: z.int().nonnegative(),
        maximumTables: z.int().nonnegative(),
        issue: z
          .enum([
            'BOOKING_TABLES_INSUFFICIENT',
            'BOOKING_LAYOUT_TABLE_LIMIT',
            'BOOKING_LAYOUT_UNAVAILABLE',
            'BOOKING_HALL_CAPACITY_EXCEEDED',
          ])
          .nullable(),
      })
      .optional(),
    completion: z
      .strictObject({
        canComplete: z.boolean(),
        pending: z.boolean(),
        appendixRevisionNumber: z.int().positive().nullable(),
        managerApproved: z.boolean(),
        coupleApproved: z.boolean(),
      })
      .optional(),
    commercialProgress: z
      .strictObject({
        modelVersion: z.enum(['LEGACY_PROPOSAL_V1', 'FULL_CONTRACT_V1']),
        selectionStatus: z.enum(['NOT_STARTED', 'DRAFT', 'SUBMITTED']),
        contractState: z.enum(['DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'SUPERSEDED']).nullable(),
        managerApproved: z.boolean(),
        coupleApproved: z.boolean(),
        timelineMatchesContract: z.boolean(),
      })
      .optional(),
    depositTerms: z
      .strictObject({
        holdExpiresAt: timestamp.nullable(),
        paymentPending: z.boolean(),
        cancellationClosesAt: timestamp,
        cancellationNotice: z.string(),
        refundNotice: z.string(),
      })
      .optional(),
    cancellationRequests: z
      .array(z.strictObject({ requestId: uuid, reason: z.string(), requestedAt: timestamp }))
      .optional(),
    proposal: z.strictObject({
      hall: z.strictObject({
        id: uuid,
        name: z.string(),
        description: z.string(),
        maxGuests: z.int(),
      }),
      shift: z.strictObject({ code: z.enum(['LUNCH', 'DINNER']), startTime: time, endTime: time }),
      menu: proposalMenuSnapshotSchema.meta({
        description:
          'Compatibility preview of the first menu only. Use menus for all menu quantities and line totals.',
      }),
      menus: proposalMenuLinesSchema,
      tableCount: z.int().min(1).max(500),
      baseChargeVnd: z.int().nonnegative(),
      depositAmountVnd: z.int().nonnegative(),
      depositPercentage: z.int().min(10).max(100).optional(),
    }),
    timeline: proposalTimeline.nullable(),
    effectiveTimeline: proposalTimeline.nullable(),
    capabilities: z.strictObject({
      accessLevel: z.enum(['RESTRICTED', 'FULL']),
      canEditTimeline: z.boolean(),
      canApproveTimeline: z.boolean(),
      canWithdrawApproval: z.boolean(),
      canRequestCancellation: z.boolean(),
    }),
  }),
});

export const holdResponseSchema = z.strictObject({
  data: z.strictObject({
    holdId: uuid,
    expiresAt: timestamp,
    bookingRevision: revision,
    replayed: z.boolean(),
  }),
});

export const timelineResultResponseSchema = z.strictObject({
  data: z.strictObject({
    changed: z.boolean().optional(),
    bookingRevision: revision,
    revision: z.strictObject({
      revisionId: uuid,
      bookingId: uuid,
      revisionNumber: revision,
      predecessorRevisionId: uuid.nullable(),
      state: z.enum(['CURRENT', 'SUPERSEDED', 'EFFECTIVE']),
      managerApprovedAt: timestamp.nullable(),
      coupleApprovedAt: timestamp.nullable(),
      mutuallyApproved: z.boolean(),
      createdAt: timestamp,
      items,
    }),
  }),
});

export const cancellationRequestResponseSchema = z.strictObject({
  data: z.strictObject({ cancellationRequestId: uuid, bookingRevision: revision }),
});
