import { z } from 'zod';

export const bookingReportRowSchema = z.strictObject({
  bookingId: z.uuid(),
  phase: z.enum(['DRAFT', 'AWAITING_DEPOSIT', 'CONFIRMED', 'CANCELLED', 'COMPLETED']),
  eventDate: z.iso.date(),
  hallId: z.uuid(),
  hallNameSnapshot: z.string(),
  shiftCode: z.enum(['LUNCH', 'DINNER']),
  menuPackageId: z.uuid().nullable(),
  menuNameSnapshot: z.string().nullable(),
  tableCount: z.int().min(1).max(500),
  baseChargeVnd: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  confirmedAt: z.iso.datetime({ offset: true }).nullable(),
  cancelledAt: z.iso.datetime({ offset: true }).nullable(),
});

export const sourceQuerySchema = z.strictObject({
  afterSequence: z.int().nonnegative(),
  throughSequence: z.int().nonnegative().optional(),
  cursor: z.string().max(512).optional(),
  limit: z.int().min(1).max(500),
});
