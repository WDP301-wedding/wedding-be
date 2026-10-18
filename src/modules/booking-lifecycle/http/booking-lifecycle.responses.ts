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
