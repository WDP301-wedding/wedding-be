import { z } from 'zod';
import { billingReportRowSchema } from './payments-billing.providers.js';
export const billingAnalyticsSchema = billingReportRowSchema.unwrap().extend({
  finalInvoiceRevisionId: z.uuid().nullable(),
  finalizedIncidentalTotalVnd: z.int().nonnegative().nullable(),
  finalInvoiceTotalVnd: z.int().nonnegative().nullable(),
  finalCommercialLines: z
    .array(
      z.strictObject({
        category: z.enum(['MENU', 'PRINT', 'SERVICE']),
        sourceId: z.uuid(),
        sourceRevisionId: z.uuid(),
        name: z.string(),
        unit: z.string(),
        quantity: z.int().positive(),
        lineTotalVnd: z.int().nonnegative(),
      }),
    )
    .optional(),
});
export type BillingAnalyticsRow = z.infer<typeof billingAnalyticsSchema>;
