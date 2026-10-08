import { z } from 'zod';

const uuid = z.uuid();
const revision = z.int().positive();
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u);
const reason = z.string().trim().min(1).max(500);

export const consultationParamsSchema = z.strictObject({ consultationId: uuid });
export const bookingParamsSchema = z.strictObject({ bookingId: uuid });
export const timelineParamsSchema = z.strictObject({ bookingId: uuid, revisionId: uuid });
export const cancellationDecisionParamsSchema = z.strictObject({
  bookingId: uuid,
  requestId: uuid,
});
export const cancellationDecisionBodySchema = z.strictObject({
  expectedRevision: revision,
  decision: z.enum(['APPROVE', 'REJECT']),
  reason,
});

export const createConsultationBodySchema = z.strictObject({
  intendedEmail: z.email(),
  displayName: z.string().trim().min(1).max(120),
  note: z.string().trim().max(2_000).optional(),
});

export const workspaceInvitationBodySchema = z.strictObject({ expectedRevision: revision });

export const availabilityQuerySchema = z.strictObject({
  hallId: uuid,
  eventDate: localDate,
  shiftCode: z.enum(['LUNCH', 'DINNER']),
});

export const createBookingBodySchema = z.strictObject({
  consultationId: uuid,
  hallId: uuid,
  eventDate: localDate,
  shiftCode: z.enum(['LUNCH', 'DINNER']),
  menuPackageVersionId: uuid,
  tableCount: z.int().min(1).max(500),
  planningHeadcount: z.int().min(0).max(10_000),
  expectedRevision: revision,
});

export const expectedRevisionBodySchema = z.strictObject({ expectedRevision: revision });

export const timelineItemSchema = z.strictObject({
  itemId: uuid.optional(),
  order: z.int().min(0).max(99),
  startTime: localTime,
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2_000).optional(),
});

export const timelineRevisionBodySchema = z.strictObject({
  expectedRevision: revision,
  predecessorRevisionId: uuid.nullable(),
  items: z.array(timelineItemSchema).max(100),
});

export const approvalBodySchema = expectedRevisionBodySchema;

export const withdrawalBodySchema = z.strictObject({
  expectedRevision: revision,
  reason,
});

export const changeRequestBodySchema = z.strictObject({
  expectedRevision: revision,
  items: z.array(timelineItemSchema).max(100),
  reason,
});

export const cancellationBodySchema = z.strictObject({
  expectedRevision: revision,
  reason,
});

export const consultationResponseSchema = z.strictObject({
  data: z.strictObject({ consultationId: uuid, revision }),
});

export const bookingResponseSchema = z.strictObject({
  data: z.strictObject({ bookingId: uuid, revision, consultationRevision: revision }),
});
