import type { PrismaClient } from '../../../generated/prisma/client.js';
import { createReportingFeed } from '../../../core/reporting/reporting-feed.js';
import { bookingAnalyticsSchema } from '../application/analytics-reporting.js';
export const createBookingAnalyticsReader = (prisma: PrismaClient) =>
  createReportingFeed(prisma, 'booking', bookingAnalyticsSchema);
