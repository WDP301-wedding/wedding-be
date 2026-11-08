import { z } from 'zod';

const money = z.int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const count = z.int().nonnegative();
export const completedEventsQuerySchema = z
  .strictObject({
    dateFrom: z.iso.date(),
    dateTo: z.iso.date(),
    hallId: z.uuid().optional(),
    paymentStatus: z.enum(['ALL', 'PAID', 'DEBT']).default('ALL'),
    q: z.string().trim().max(120).default(''),
    page: z.coerce.number().int().min(1).max(1000000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(10),
  })
  .refine(
    (q) => {
      const days = (Date.parse(q.dateTo) - Date.parse(q.dateFrom)) / 86400000;
      return q.dateFrom >= '0001-01-02' && days >= 0 && days < 366;
    },
    { message: 'Select 1–366 inclusive local event dates.' },
  );
export type CompletedEventsQuery = z.infer<typeof completedEventsQuerySchema>;
export const completedEventSchema = z.strictObject({
  bookingId: z.uuid(),
  bookingCode: z.string(),
  customerName: z.string(),
  eventDate: z.iso.date(),
  hallId: z.uuid(),
  hallName: z.string(),
  invoiceRevisionId: z.uuid().nullable(),
  invoiceState: z.enum(['FINALIZED', 'PROVISIONAL', 'SOURCE_NOT_READY']),
  totalVnd: money.nullable(),
  netPaidVnd: money.nullable(),
  outstandingVnd: money.nullable(),
  creditVnd: money.nullable(),
  paymentStatus: z.enum(['PAID', 'DEBT', 'PENDING_INVOICE', 'UNKNOWN']),
});
export const completedSummarySchema = z.strictObject({
  completedCount: count,
  finalizedCount: count,
  provisionalCount: count,
  unknownCount: count,
  revenueVnd: money,
  provisionalTotalVnd: money,
  netPaidVnd: money.nullable(),
  outstandingVnd: money.nullable(),
  creditVnd: money.nullable(),
  unallocatedRevenueVnd: z.int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
});
export const completedHallSchema = z.strictObject({
  hallId: z.uuid(),
  hallName: z.string(),
  bookingCount: count,
  finalizedCount: count,
  revenueVnd: money,
  netPaidVnd: money.nullable(),
  outstandingVnd: money.nullable(),
});
export const completedOfferingSchema = z.strictObject({
  category: z.enum(['MENU', 'SERVICE']),
  sourceId: z.uuid(),
  name: z.string(),
  unit: z.string(),
  bookingCount: count,
  finalizedBookingCount: count,
  quantity: count,
  revenueVnd: money,
});
export const completedEventsResponseSchema = z.strictObject({
  data: z.strictObject({
    meta: z.strictObject({
      definitionVersion: z.literal('COMPLETED_INVOICE_V1'),
      dateFrom: z.iso.date(),
      dateTo: z.iso.date(),
      generatedAt: z.iso.datetime(),
      status: z.enum(['READY', 'SOURCE_NOT_READY']),
      sourceSequences: z.strictObject({ booking: count, billing: count }),
    }),
    summary: completedSummarySchema,
    halls: z.array(completedHallSchema).max(10000),
    offerings: z.array(completedOfferingSchema).max(10000),
    page: count.positive(),
    pageSize: count.positive(),
    total: count,
    totalPages: count,
    items: z.array(completedEventSchema).max(100),
  }),
});
