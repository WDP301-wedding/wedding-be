import type { PrismaClient } from '../../../generated/prisma/client.js';
import { createReportingFeed } from '../../../core/reporting/reporting-feed.js';
import { availabilitySchema } from '../application/analytics-reporting.js';
export const createVenueAnalyticsReader = (prisma: PrismaClient) =>
  createReportingFeed(prisma, 'venue', availabilitySchema);
