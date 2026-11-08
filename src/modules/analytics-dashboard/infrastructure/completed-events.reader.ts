import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import { AppError } from '../../../core/errors/app-error.js';
import { prismaSchema } from '../../../core/database/prisma.js';
import {
  completedEventsQuerySchema,
  completedEventsResponseSchema,
} from '../http/completed-events.schemas.js';
import { completedEventsSql } from './completed-events.sql.js';

/** Read only owner-published facts, in one statement snapshot. Never infer ledger
 * amounts from a contract or join Analytics to another module's mutable tables. */
export function createCompletedEventsReader(prisma: PrismaClient) {
  return async (value: unknown) => {
    const query = completedEventsQuerySchema.parse(value);
    const schema = Prisma.raw('"' + prismaSchema(prisma).replaceAll('"', '""') + '"');
    const [row] = await prisma.$queryRaw<
      {
        payload: Prisma.JsonObject;
        eventCount: number;
        offeringCount: number;
        bookingSequence: number;
        billingSequence: number;
      }[]
    >(completedEventsSql(schema, query));
    if (!row)
      throw new AppError({
        status: 503,
        code: 'ANALYTICS_NOT_READY',
        message: 'Report sources are unavailable.',
      });
    if (row.eventCount > 10000 || row.offeringCount > 10000)
      throw new AppError({
        status: 422,
        code: 'ANALYTICS_QUERY_TOO_BROAD',
        message: 'Narrow the report to at most 10,000 events and offerings.',
      });
    const result = completedEventsResponseSchema.safeParse({
      data: {
        ...row.payload,
        meta: {
          definitionVersion: 'COMPLETED_INVOICE_V1',
          dateFrom: query.dateFrom,
          dateTo: query.dateTo,
          generatedAt: new Date().toISOString(),
          status:
            (row.payload.summary as Prisma.JsonObject)?.unknownCount === 0
              ? 'READY'
              : 'SOURCE_NOT_READY',
          sourceSequences: { booking: row.bookingSequence, billing: row.billingSequence },
        },
      },
    });
    if (!result.success) {
      const overflow = result.error.issues.some((issue) => issue.code === 'too_big');
      throw new AppError({
        status: overflow ? 422 : 503,
        code: overflow ? 'ANALYTICS_AMOUNT_OVERFLOW' : 'ANALYTICS_NOT_READY',
        message: 'The report cannot represent its source amounts safely.',
      });
    }
    return result.data.data;
  };
}
