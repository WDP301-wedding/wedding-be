import type { PrismaClient } from '../../../generated/prisma/client.js';
import { createReportingFeed } from '../../../core/reporting/reporting-feed.js';
import { billingAnalyticsSchema } from '../application/analytics-reporting.js';
export const createBillingAnalyticsReader = (prisma: PrismaClient) =>
  createReportingFeed(prisma, 'billing', billingAnalyticsSchema);
