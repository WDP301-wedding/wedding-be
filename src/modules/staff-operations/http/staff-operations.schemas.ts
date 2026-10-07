import { z } from 'zod';

import { strictWriteSchema } from '../../../core/http/validate.js';
import { STAFF_OPERATIONS_LIMITS } from '../domain/staff-operations.policy.js';

export const bookingParamsSchema = z.strictObject({
  bookingId: z.uuid(),
});

export const householdParamsSchema = z.strictObject({
  bookingId: z.uuid(),
  id: z.uuid(),
});

export const staffAccountParamsSchema = z.strictObject({
  id: z.uuid(),
});

export const assignmentParamsSchema = z.strictObject({
  bookingId: z.uuid(),
  id: z.uuid(),
});

export const provisionStaffAccountBodySchema = strictWriteSchema({
  email: z.string().email().max(320),
  commandKey: z.string().trim().min(1).max(255),
});

export const operationalAccessBodySchema = strictWriteSchema({
  enabled: z.boolean(),
  reason: z.string().trim().min(STAFF_OPERATIONS_LIMITS.reasonLength.min).max(STAFF_OPERATIONS_LIMITS.reasonLength.max),
});

export const assignStaffBodySchema = strictWriteSchema({
  staffAccountId: z.uuid(),
});

export const revokeAssignmentBodySchema = strictWriteSchema({
  expectedRevision: z.int().min(1),
  reason: z.string().trim().min(STAFF_OPERATIONS_LIMITS.reasonLength.min).max(STAFF_OPERATIONS_LIMITS.reasonLength.max),
});

export const householdSearchQuerySchema = z.strictObject({
  name: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(30).optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(STAFF_OPERATIONS_LIMITS.searchLimit.max)
    .default(STAFF_OPERATIONS_LIMITS.searchLimit.default),
});

export const recordArrivalBodySchema = strictWriteSchema({
  attendeeCount: z
    .int()
    .min(STAFF_OPERATIONS_LIMITS.arrivalCount.min)
    .max(STAFF_OPERATIONS_LIMITS.arrivalCount.max),
  eventTime: z.string().datetime().optional(),
  managerOverrideReason: z
    .string()
    .trim()
    .min(STAFF_OPERATIONS_LIMITS.reasonLength.min)
    .max(STAFF_OPERATIONS_LIMITS.reasonLength.max)
    .optional(),
});

export const recordCorrectionBodySchema = strictWriteSchema({
  arrivalId: z.uuid(),
  delta: z
    .int()
    .min(STAFF_OPERATIONS_LIMITS.correctionDelta.min)
    .max(STAFF_OPERATIONS_LIMITS.correctionDelta.max)
    .refine((val) => val !== 0, { message: 'Delta must be nonzero.' }),
  expectedLedgerRevision: z.int().min(1),
  reason: z
    .string()
    .trim()
    .min(STAFF_OPERATIONS_LIMITS.reasonLength.min)
    .max(STAFF_OPERATIONS_LIMITS.reasonLength.max),
});

export const attendanceHistoryQuerySchema = z.strictObject({
  cursor: z.uuid().optional(),
});
