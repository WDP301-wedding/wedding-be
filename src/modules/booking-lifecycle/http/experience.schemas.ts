import { z } from 'zod';

function minimumPreferredDate(): string {
  const vietnamDate = new Date(Date.now() + 7 * 60 * 60_000);
  vietnamDate.setUTCDate(vietnamDate.getUTCDate() + 2);
  return vietnamDate.toISOString().slice(0, 10);
}

export const consultationRequestBodySchema = z.strictObject({
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
    .refine((value) => value >= minimumPreferredDate(), {
      message: 'Ngày tổ chức dự kiến phải từ ngày mốt trở đi (theo giờ Việt Nam).',
    })
    .nullable(),
  expectedGuests: z.number().int().min(1).max(10000).nullable(),
  message: z.string().trim().max(2000),
});
export const intakeAcknowledgementSchema = z.strictObject({
  data: z.strictObject({ accepted: z.literal(true) }),
});
export const intakeRecordSchema = consultationRequestBodySchema
  .omit({ submissionId: true })
  .extend({
    // Stored requests remain readable after their preferred date has passed.
    preferredDate: z.iso.date().nullable(),
    id: z.uuid(),
    status: z.enum(['NEW', 'CONVERTED', 'CLOSED']),
    consultationId: z.uuid().nullable(),
    consultationRevision: z.number().int().positive().nullable(),
    createdAt: z.iso.datetime(),
  });
export const intakeListSchema = z.strictObject({
  data: z.array(intakeRecordSchema),
  nextCursor: z.uuid().nullable(),
});
export const intakeActionSchema = z.strictObject({
  data: z.strictObject({ consultationId: z.uuid().nullable() }),
});
export const experienceQuerySchema = z.strictObject({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
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
});
export const overviewResponseSchema = z.strictObject({
  data: z.array(overviewItemSchema),
  nextCursor: z.uuid().nullable(),
});
