import type { PrismaClient } from '../../generated/prisma/client.js';
import { createCoupleProfileService } from './application/couple-profile.service.js';
import { createPrismaConsultationRetentionRecorder } from '../identity-access/account/retention-eligibility.port.js';
import { createBookingBoundaryUnitOfWork } from '../../core/database/booking-unit-of-work.js';
import {
  type ConsultationAccessReader,
  createConsultationAccessReader,
  createPrismaConsultationAccessRepository,
} from '../identity-access/authorization/authorization.service.js';
import {
  createCoupleAccessPromoter,
  createPrismaCoupleAccessPromotionRepository,
} from '../identity-access/authorization/couple-access-promotion.js';
import { createBookingAutomationPort } from './application/automation.js';
import { createBookingLifecycleReader } from './application/booking-readers.js';
import {
  createBookingDepositService,
  type ContractContext,
} from './application/deposit.service.js';
import { createPrismaBookingAutomationRepository } from './infrastructure/automation.repository.js';
import {
  createPrismaBookingAccessContextRepository,
  createPrismaBookingCommercialSnapshotReader,
  createPrismaBookingPlanningSnapshotReader,
  createPrismaBookingTimelineSnapshotReader,
} from './infrastructure/booking-readers.repository.js';
import { createPrismaBookingDepositRepository } from './infrastructure/deposit.repository.js';
import { createPrismaBookingLifecycleRepository } from './infrastructure/lifecycle.repository.js';
import { createPrismaBookingReportingReader } from './infrastructure/reporting.repository.js';

export function createBookingLifecycleProviders(
  prisma: PrismaClient,
  access: ConsultationAccessReader,
  scope = createBookingBoundaryUnitOfWork(prisma),
  retentionDays = 365,
) {
  const depositService = (client: PrismaClient) =>
    createBookingDepositService({
      repository: createPrismaBookingDepositRepository(client),
      promoter: createCoupleAccessPromoter(createPrismaCoupleAccessPromotionRepository(client)),
    });
  const lifecycleReader = (client: PrismaClient) =>
    createBookingLifecycleReader({
      repository: createPrismaBookingAccessContextRepository(client),
      access:
        client === prisma
          ? access
          : createConsultationAccessReader(createPrismaConsultationAccessRepository(client)),
      deposits: createPrismaBookingDepositRepository(client),
    });
  return Object.freeze({
    coupleProfileReader: Object.freeze({ read: createCoupleProfileService(prisma).read }),
    boundary: scope.boundary,
    lifecycleReader: Object.freeze({
      requireBookingAccess(
        input: Parameters<ReturnType<typeof lifecycleReader>['requireBookingAccess']>[0],
        context?: ContractContext,
      ) {
        return scope.withClient(input.bookingId, context, (client) =>
          lifecycleReader(client).requireBookingAccess(input),
        );
      },
      requireDepositEligibility(
        input: Parameters<ReturnType<typeof lifecycleReader>['requireDepositEligibility']>[0],
        context?: ContractContext,
      ) {
        return scope.withClient(input.bookingId, context, (client) =>
          lifecycleReader(client).requireDepositEligibility(input),
        );
      },
      requireConfirmedEventContext(bookingId: string, context?: ContractContext) {
        return scope.withClient(bookingId, context, (client) =>
          lifecycleReader(client).requireConfirmedEventContext(bookingId),
        );
      },
    }),
    deposits: Object.freeze({
      requireDepositEligibility(
        input: Parameters<ReturnType<typeof depositService>['requireDepositEligibility']>[0],
        context?: ContractContext,
      ) {
        return scope.withClient(input.bookingId, context, (client) =>
          depositService(client).requireDepositEligibility(input),
        );
      },
      reserve(
        input: Parameters<ReturnType<typeof depositService>['reserve']>[0],
        context: ContractContext,
      ) {
        return scope.withClient(input.bookingId, context, (client) =>
          depositService(client).reserve(input, context),
        );
      },
      recordUnknown(
        input: Parameters<ReturnType<typeof depositService>['recordUnknown']>[0],
        context: ContractContext,
      ) {
        return scope.withClient(input.bookingId, context, (client) =>
          depositService(client).recordUnknown(input, context),
        );
      },
      releaseVerifiedFailure(
        input: Parameters<ReturnType<typeof depositService>['releaseVerifiedFailure']>[0],
        context: ContractContext,
      ) {
        return scope.withClient(input.bookingId, context, (client) =>
          depositService(client).releaseVerifiedFailure(input, context),
        );
      },
      recordSuccessfulDeposit(
        input: Parameters<ReturnType<typeof depositService>['recordSuccessfulDeposit']>[0],
        context?: ContractContext,
      ) {
        return scope.withClient(input.bookingId, context, (client) =>
          depositService(client).recordSuccessfulDeposit(input),
        );
      },
    }),
    timeline: Object.freeze({
      resolveApprovedRevision(
        input: Parameters<
          ReturnType<typeof createPrismaBookingTimelineSnapshotReader>['resolveApprovedRevision']
        >[0],
        context: ContractContext,
      ) {
        return scope.withClient(input.bookingId, context, (client) =>
          createPrismaBookingTimelineSnapshotReader(client).resolveApprovedRevision(input, context),
        );
      },
    }),
    commercial: Object.freeze({
      getAccepted(
        input: Parameters<
          ReturnType<typeof createPrismaBookingCommercialSnapshotReader>['getAccepted']
        >[0],
        context: ContractContext,
      ) {
        return scope.withClient(input.bookingId, context, (client) =>
          createPrismaBookingCommercialSnapshotReader(client).getAccepted(input, context),
        );
      },
    }),
    planning: Object.freeze({
      getCurrent(bookingId: string, context: ContractContext) {
        return scope.withClient(bookingId, context, (client) =>
          createPrismaBookingPlanningSnapshotReader(client).getCurrent(bookingId, context),
        );
      },
    }),
    headcount: Object.freeze({
      synchronize(
        input: Parameters<
          ReturnType<typeof createPrismaBookingLifecycleRepository>['synchronizeHeadcount']
        >[0],
        context: ContractContext,
      ) {
        return scope.withClient(input.bookingId, context, (client) =>
          createPrismaBookingLifecycleRepository(client).synchronizeHeadcount(input, context),
        );
      },
    }),
    reporting: createPrismaBookingReportingReader(prisma),
    createAutomationWorker(authorizeWorker: (context: ContractContext) => Promise<void>) {
      return createBookingAutomationPort(
        createPrismaBookingAutomationRepository(prisma, undefined, (transaction, input, context) =>
          createPrismaConsultationRetentionRecorder(transaction, retentionDays).recordTerminal(
            {
              consultationId: input.consultationId,
              sourceBusinessRecordId: input.bookingId,
              eligibleAfter: input.eligibleAfter,
            },
            context,
          ),
        ),
        authorizeWorker,
      );
    },
  });
}

export type BookingLifecycleProviders = ReturnType<typeof createBookingLifecycleProviders>;
