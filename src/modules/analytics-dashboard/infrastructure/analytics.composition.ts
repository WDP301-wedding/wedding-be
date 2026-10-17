import type { PrismaClient } from '../../../generated/prisma/client.js';
import {
  PrismaBookingBoundary,
  type ContractContext,
} from '../../../core/database/booking-boundary.js';
import { createScopedIdentityReaders } from '../../identity-access/authorization/scoped-identity.reader.js';
import { createBookingAnalyticsReader } from '../../booking-lifecycle/infrastructure/analytics-reporting.reader.js';
import { createBillingAnalyticsReader } from '../../payments-billing/infrastructure/analytics-reporting.reader.js';
import { createPrintAnalyticsReader } from '../../invitation-studio/infrastructure/analytics-reporting.reader.js';
import { createGuestAnalyticsReader } from '../../guest-management/infrastructure/analytics-reporting.reader.js';
import { createAttendanceAnalyticsReader } from '../../staff-operations/infrastructure/analytics-reporting.reader.js';
import { createVenueAnalyticsReader } from '../../venue-catalog/infrastructure/analytics-reporting.reader.js';
import { createProjectionRepository } from './projection.repository.js';
import { AnalyticsProjector } from '../application/projection.js';
import { AnalyticsService } from '../application/analytics.service.js';
import { reportingFencesSchema } from '../../../core/reporting/reporting-feed.js';
import type { AnalyticsObserver } from '../application/analytics-observation.js';
export function createAnalyticsServices(
  prisma: PrismaClient,
  now: () => Date = () => new Date(),
  observe?: AnalyticsObserver,
) {
  const sources = {
    booking: createBookingAnalyticsReader(prisma),
    billing: createBillingAnalyticsReader(prisma),
    invitation: createPrintAnalyticsReader(prisma),
    guest: createGuestAnalyticsReader(prisma),
    staff: createAttendanceAnalyticsReader(prisma),
    venue: createVenueAnalyticsReader(prisma),
  };
  const store = createProjectionRepository(prisma),
    projector = new AnalyticsProjector(
      sources,
      store,
      now,
      async () =>
        reportingFencesSchema.parse(
          Object.fromEntries(
            (await prisma.reportingSequence.findMany()).map((h) => [h.owner, h.value]),
          ),
        ),
      observe,
    );
  const service = new AnalyticsService(
    projector,
    store,
    now,
    async (p) => {
      const heads = await prisma.reportingSequence.findMany();
      return heads.some(
        (h) => p.checkpoints.find((c) => c.owner === h.owner)?.throughSequence !== h.value,
      );
    },
    observe,
  );
  const resolver = createScopedIdentityReaders(
    prisma,
    new PrismaBookingBoundary(prisma),
    now,
  ).resolver;
  const audit = (
    context: ContractContext,
    action: string,
    metadata: {
      generationId: string;
      reason?: string;
      filters?: {
        dateFrom: string;
        dateTo: string;
        hallId?: string;
        phase?: string;
        menuPackageId?: string;
      };
      resultSize?: number;
    },
  ) =>
    prisma.auditLog
      .create({
        data: {
          actorType: 'USER',
          actorId: context.actorAccountId,
          requestId: context.requestId,
          action,
          entityType: 'AnalyticsGeneration',
          entityId: metadata.generationId,
          metadata: metadata,
        },
      })
      .then(() => undefined);
  return { sources, store, projector, service, resolver, audit };
}
