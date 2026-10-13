import { z } from 'zod';
import { bookingReportRowSchema } from './reporting.schemas.js';
const vnd = z.int().nonnegative();
export const commercialMetricLineSchema = z.strictObject({
  category: z.enum(['MENU', 'PRINT', 'SERVICE']),
  sourceId: z.uuid(),
  sourceRevisionId: z.uuid(),
  name: z.string(),
  quantity: z.int().positive(),
});
export const bookingAnalyticsSchema = bookingReportRowSchema.extend({
  planningHeadcount: z.int().nonnegative(),
  originalContractTotalVnd: vnd.nullable(),
  approvedAppendixDeltaVnd: z.int(),
  effectiveAgreedTotalVnd: vnd.nullable(),
  commercialLines: z.array(commercialMetricLineSchema),
});
export type BookingAnalyticsRow = z.infer<typeof bookingAnalyticsSchema>;
