import { z } from 'zod';
import { billingReportRowSchema } from './payments-billing.providers.js';
export const billingAnalyticsSchema = billingReportRowSchema.unwrap().extend({
  finalInvoiceRevisionId: z.uuid().nullable(),
  finalizedIncidentalTotalVnd: z.int().nonnegative().nullable(),
  finalInvoiceTotalVnd: z.int().nonnegative().nullable(),
});
export type BillingAnalyticsRow = z.infer<typeof billingAnalyticsSchema>;
