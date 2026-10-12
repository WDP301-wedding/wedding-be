import type { PrismaClient } from '../../../generated/prisma/client.js';
import { createReportingFeed } from '../../../core/reporting/reporting-feed.js';
import { printAnalyticsSchema } from '../application/analytics-reporting.js';
export const createPrintAnalyticsReader = (prisma: PrismaClient) =>
  createReportingFeed(prisma, 'invitation', printAnalyticsSchema);
