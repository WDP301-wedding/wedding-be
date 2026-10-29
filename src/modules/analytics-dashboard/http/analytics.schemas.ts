import { z } from 'zod';
import { checkpointSchema } from '../application/projection.js';
import { attendanceSchema } from '../../staff-operations/application/attendance-readers.js';
export const analyticsQuerySchema = z
  .strictObject({
    dateFrom: z.iso.date(),
    dateTo: z.iso.date(),
    hallId: z
      .uuid()
      .overwrite((s) => s.toLowerCase())
      .optional(),
    phase: z.enum(['DRAFT', 'AWAITING_DEPOSIT', 'CONFIRMED', 'CANCELLED', 'COMPLETED']).optional(),
    menuPackageId: z
      .uuid()
      .overwrite((s) => s.toLowerCase())
      .optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().max(2048).optional(),
    search: z.string().trim().max(120).optional(),
  })
  .refine(
    (q) => {
      const days = (Date.parse(q.dateTo) - Date.parse(q.dateFrom)) / 86400000;
      return q.dateFrom >= '0001-01-02' && days >= 0 && days < 366;
    },
    { message: 'Date range must contain 1–366 inclusive local dates starting from 0001-01-02.' },
  );
export type AnalyticsQuery = z.output<typeof analyticsQuerySchema>;
const vnd = z.int().nonnegative(),
  signed = z.int(),
  count = z.int().nonnegative();
export const analyticsMetaSchema = z.strictObject({
  metricDefinitionVersion: z.literal('2'),
  providerVersion: z.literal('ANALYTICS-SOURCES@3.0.0'),
  timezone: z.literal('Asia/Ho_Chi_Minh'),
  dateFrom: z.iso.date(),
  dateTo: z.iso.date(),
  generationId: z.uuid().nullable(),
  refreshedAt: z.iso.datetime().nullable(),
  sourceCheckpoints: z.array(checkpointSchema),
  status: z.enum(['READY', 'STALE', 'SOURCE_NOT_READY']),
});
export const cashSchema = z.strictObject({
  currency: z.literal('VND'),
  cashFromUtc: z.iso.datetime(),
  cashToExclusiveUtc: z.iso.datetime(),
  grossCashReceivedVnd: vnd.nullable(),
  cashRefundedVnd: vnd.nullable(),
  netCashRevenueVnd: signed.nullable(),
  receivablesVnd: vnd.nullable(),
  creditBalanceVnd: vnd.nullable(),
  acceptedChargesVnd: vnd.nullable(),
  settledPaymentsVnd: vnd.nullable(),
  settledRefundsVnd: vnd.nullable(),
  netSettledVnd: signed.nullable(),
  originalContractTotalVnd: vnd.nullable(),
  approvedAppendixDeltaVnd: signed.nullable(),
  effectiveAgreedTotalVnd: vnd.nullable(),
  finalizedIncidentalTotalVnd: vnd.nullable(),
  finalInvoiceTotalVnd: vnd.nullable(),
  finalizedInvoiceCount: count.nullable(),
});
const popularity = z.strictObject({
  sourceId: z.uuid(),
  sourceRevisionId: z.uuid().nullable(),
  nameSnapshot: z.string(),
  bookingCount: count,
  quantity: count,
});
export const bookingRowSchema = z.strictObject({
  bookingId: z.uuid(),
  bookingCode: z
    .string()
    .regex(/^HY-\d{6,}$/)
    .nullable()
    .optional(),
  customerName: z.string().nullable().optional(),
  alias: z.string().nullable().optional(),
  eventDate: z.iso.date(),
  hallId: z.uuid(),
  hallNameSnapshot: z.string(),
  shiftCode: z.enum(['LUNCH', 'DINNER']),
  phase: z.enum(['DRAFT', 'AWAITING_DEPOSIT', 'CONFIRMED', 'CANCELLED', 'COMPLETED']),
  tableCount: count,
});
export const attendanceRowSchema = attendanceSchema.omit({ ledgerRevision: true }).extend({
  planningHeadcount: count,
  listedGuestCount: count.nullable(),
  checkInMode: z.enum(['NONE', 'BY_GUEST_NAME']).nullable(),
  measurementStatus: z.enum(['NOT_RECORDED', 'LISTED_GUESTS_ONLY', 'SOURCE_NOT_READY']),
});
export const printRowSchema = z.strictObject({
  bookingId: z.uuid(),
  printOrderId: z.uuid(),
  status: z.enum([
    'REQUESTED',
    'QUOTED',
    'APPROVED',
    'IN_PRODUCTION',
    'READY_FOR_HANDOVER',
    'HANDED_OVER',
    'CANCELLED',
  ]),
  acceptedAmountVnd: vnd,
  receivableChargeId: z.uuid().nullable(),
});
const statusCounts = z.array(z.strictObject({ status: z.string(), count }));
const utilization = z.strictObject({
  occupiedSlots: count,
  availableSlots: count.nullable(),
  rate: z.number().min(0).max(1).nullable(),
  status: z.enum(['READY', 'SOURCE_NOT_READY', 'NO_AVAILABLE_SLOTS']),
});
export const analyticsResultSchemas = {
  overview: z.strictObject({
    meta: analyticsMetaSchema,
    ...cashSchema.shape,
    bookingStatusCounts: statusCounts,
    hallUtilization: utilization,
    menuPopularity: z.array(popularity),
    servicePopularity: z.array(popularity),
  }),
  revenue: z.strictObject({ meta: analyticsMetaSchema, ...cashSchema.shape }),
  bookings: z.strictObject({
    meta: analyticsMetaSchema,
    items: z.array(bookingRowSchema).max(100),
    nextCursor: z.string().nullable(),
    bookingStatusCounts: statusCounts,
    hallUtilization: utilization,
    menuPopularity: z.array(popularity),
    servicePopularity: z.array(popularity),
  }),
  attendance: z.strictObject({
    meta: analyticsMetaSchema,
    items: z.array(attendanceRowSchema).max(100),
    nextCursor: z.string().nullable(),
  }),
  'print-orders': z.strictObject({
    meta: analyticsMetaSchema,
    items: z.array(printRowSchema).max(100),
    nextCursor: z.string().nullable(),
    statusCounts,
  }),
};
export type AnalyticsReport = keyof typeof analyticsResultSchemas;
export const rebuildBodySchema = z.strictObject({ reason: z.string().trim().min(1).max(500) });
export const projectionResultSchema = z.strictObject({ generationId: z.uuid() });
