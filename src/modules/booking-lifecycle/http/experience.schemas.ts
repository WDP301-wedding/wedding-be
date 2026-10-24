import { z } from 'zod';
import { coupleNameSchema, coupleProfileFields } from '../domain/couple-profile.js';
import { minimumEventDate } from '../domain/event-date.js';

export const consultationRequestBodySchema = z.strictObject({
  ...coupleProfileFields,
  submissionId: z.uuid(),
  displayName: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .overwrite((value) => value.normalize('NFC')),
  email: z
    .email()
    .max(320)
    .overwrite((value) => value.trim().toLowerCase()),
  phone: z
    .string()
    .trim()
    .max(30)
    .regex(/^[+\d\s().-]*$/u),
  preferredDate: z.iso
    .date()
    .refine((value) => value >= minimumEventDate(), {
      message: 'Ngày tổ chức dự kiến phải từ ngày mốt trở đi (theo giờ Việt Nam).',
    })
    .nullable(),
  expectedGuests: z.number().int().min(1).max(10000).nullable(),
  message: z.string().trim().max(2000),
});
export const intakeAcknowledgementSchema = z.strictObject({
  data: z.strictObject({ accepted: z.literal(true) }),
});
export const intakeStatusSchema = z.enum(['NEW', 'CONVERTED', 'CLOSED']);
export const intakeRecordSchema = consultationRequestBodySchema
  .omit({ submissionId: true })
  .extend({
    // Stored requests remain readable after their preferred date has passed.
    brideName: coupleNameSchema.nullable(),
    groomName: coupleNameSchema.nullable(),
    preferredDate: z.iso.date().nullable(),
    id: z.uuid(),
    status: intakeStatusSchema,
    consultationId: z.uuid().nullable(),
    consultationRevision: z.number().int().positive().nullable(),
    createdAt: z.iso.datetime(),
  });
export const intakeListSchema = z.strictObject({
  data: z.array(intakeRecordSchema),
  nextCursor: z.uuid().nullable(),
  totalMatches: z.int().nonnegative().optional(),
  counts: z
    .strictObject({
      NEW: z.int().nonnegative(),
      CONVERTED: z.int().nonnegative(),
      CLOSED: z.int().nonnegative(),
    })
    .optional(),
});
export const intakeActionSchema = z.strictObject({
  data: z.strictObject({
    consultationId: z.uuid().nullable(),
    consultationRevision: z.int().positive().optional(),
  }),
});
export const experienceQuerySchema = z.strictObject({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const intakeQuerySchema = experienceQuerySchema.extend({
  status: z.enum(['ALL', 'NEW', 'CONVERTED', 'CLOSED']).default('ALL'),
  q: z
    .string()
    .trim()
    .max(120)
    .transform((value) => value.normalize('NFC'))
    .default(''),
  sort: z.enum(['newest', 'oldest', 'date-asc', 'guests-desc', 'name-asc']).default('newest'),
});
export const intakeParamsSchema = z.strictObject({ id: z.uuid() });
export const overviewQuerySchema = experienceQuerySchema.extend({
  client: z.enum(['WEB', 'ANDROID']).default('WEB'),
});
export const overviewItemSchema = z.strictObject({
  bookingId: z.uuid(),
  consultationId: z.uuid(),
  eventDate: z.iso.date(),
  phase: z.enum(['DRAFT', 'AWAITING_DEPOSIT', 'CONFIRMED', 'CANCELLED', 'COMPLETED']),
  accessLevel: z.enum(['RESTRICTED', 'FULL']),
  hallName: z.string(),
  shiftCode: z.enum(['LUNCH', 'DINNER']),
  planningHeadcount: z.number().int(),
  managerApproved: z.boolean(),
  coupleApproved: z.boolean(),
  hasTimeline: z.boolean(),
  revision: z.number().int().positive().optional(),
  eventType: z.enum(['WEDDING', 'ENGAGEMENT', 'RECEPTION', 'ANNIVERSARY', 'OTHER']).default('WEDDING'),
  alias: z.string().nullable().optional(),
  brideName: coupleNameSchema.nullable().optional(),
  groomName: coupleNameSchema.nullable().optional(),
  totalVnd: z.number().int().nonnegative().optional(),
  depositPaidVnd: z.number().int().nonnegative().optional(),
});
export const overviewResponseSchema = z.strictObject({
  data: z.array(overviewItemSchema),
  nextCursor: z.uuid().nullable(),
});
export const updateBookingAliasParamsSchema = z.strictObject({
  bookingId: z.uuid(),
});
export const updateBookingAliasBodySchema = z.strictObject({
  expectedRevision: z.number().int().positive().optional(),
  alias: z.string().trim().max(120).nullable().optional(),
  eventType: z.enum(['WEDDING', 'ENGAGEMENT', 'RECEPTION', 'ANNIVERSARY', 'OTHER']).optional(),
});
export const updateBookingAliasResponseSchema = z.strictObject({
  data: z.strictObject({
    bookingId: z.uuid(),
    revision: z.number().int().positive(),
    alias: z.string().nullable(),
    eventType: z.enum(['WEDDING', 'ENGAGEMENT', 'RECEPTION', 'ANNIVERSARY', 'OTHER']),
  }),
});
