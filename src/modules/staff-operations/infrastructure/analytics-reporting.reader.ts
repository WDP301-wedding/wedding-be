import type { PrismaClient } from '../../../generated/prisma/client.js';
import { createReportingFeed } from '../../../core/reporting/reporting-feed.js';
import { attendanceSchema } from '../application/attendance-readers.js';
export const createAttendanceAnalyticsReader = (prisma: PrismaClient) =>
  createReportingFeed(prisma, 'staff', attendanceSchema);
