import type { PrismaClient } from '../../../generated/prisma/client.js';
import { createReportingFeed } from '../../../core/reporting/reporting-feed.js';
import { reportSchema } from '../application/guest-readers.js';
export const createGuestAnalyticsReader = (prisma: PrismaClient) =>
  createReportingFeed(
    prisma,
    'guest',
    reportSchema.pick({
      bookingId: true,
      planningHeadcount: true,
      listedGuestCount: true,
      planSourceSequence: true,
    }),
  );
