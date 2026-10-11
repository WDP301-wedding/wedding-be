import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { BookingAccessContextRepository } from '../application/booking-readers.js';
import type {
  BookingCommercialSnapshotReader,
  BookingPlanningSnapshotReader,
  BookingTimelineSnapshotReader,
} from '../application/booking-snapshots.js';
import { BookingLifecycleNotFoundError } from './consultation.repository.js';
import { createContractFinancialReader } from './contract-financial.reader.js';
import { commercialConflict } from '../domain/commercial-contract.js';

export function createPrismaBookingAccessContextRepository(
  prisma: PrismaClient,
): BookingAccessContextRepository {
  return Object.freeze({
    async getAccessContext(bookingId: string) {
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { id: true, consultationId: true, phase: true },
      });
      if (booking === null) throw new BookingLifecycleNotFoundError();
      return Object.freeze({
        consultationId: booking.consultationId,
        bookingId: booking.id,
        phase: booking.phase,
      });
    },

    async requireConfirmedEventContext(bookingId: string) {
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: {
          id: true,
          consultationId: true,
          hallId: true,
          shiftCode: true,
          eventDate: true,
          phase: true,
          effectiveTimelineRevisionId: true,
          planningHeadcount: true,
        },
      });
      if (
        booking === null ||
        booking.phase !== 'CONFIRMED' ||
        booking.effectiveTimelineRevisionId === null
      ) {
        throw new BookingLifecycleNotFoundError();
      }
      return Object.freeze({
        consultationId: booking.consultationId,
        bookingId: booking.id,
        hallId: booking.hallId,
        shiftCode: booking.shiftCode,
        eventDate: isoDate(booking.eventDate),
        effectiveTimelineRevisionId: booking.effectiveTimelineRevisionId,
        planningHeadcount: booking.planningHeadcount,
      });
    },
  });
}

export function createPrismaBookingTimelineSnapshotReader(
  prisma: PrismaClient,
): BookingTimelineSnapshotReader {
  return Object.freeze({
    async resolveApprovedRevision(
      input: Parameters<BookingTimelineSnapshotReader['resolveApprovedRevision']>[0],
    ) {
      const revision = await prisma.bookingTimelineRevision.findUnique({
        where: { id: input.timelineRevisionId },
        select: {
          id: true,
          bookingId: true,
          revisionNumber: true,
          managerApprovedAt: true,
          coupleApprovedAt: true,
          booking: {
            select: {
              eventDate: true,
              shiftCode: true,
              effectiveTimelineRevisionId: true,
              proposalSnapshot: {
                select: { hallName: true, shiftStartTime: true, shiftEndTime: true },
              },
            },
          },
          items: {
            orderBy: { displayOrder: 'asc' },
            select: {
              itemId: true,
              displayOrder: true,
              startTime: true,
              title: true,
              description: true,
            },
          },
        },
      });
      if (
        revision === null ||
        revision.bookingId !== input.bookingId ||
        revision.managerApprovedAt === null ||
        revision.coupleApprovedAt === null ||
        revision.booking.proposalSnapshot === null
      ) {
        throw new BookingLifecycleNotFoundError();
      }
      return Object.freeze({
        bookingId: revision.bookingId,
        timelineRevisionId: revision.id,
        revisionNumber: revision.revisionNumber,
        eventDate: isoDate(revision.booking.eventDate),
        hallName: revision.booking.proposalSnapshot.hallName,
        shiftCode: revision.booking.shiftCode,
        shiftStartTime: timeText(revision.booking.proposalSnapshot.shiftStartTime),
        shiftEndTime: timeText(revision.booking.proposalSnapshot.shiftEndTime),
        items: revision.items.map((item) =>
          Object.freeze({
            itemId: item.itemId,
            order: item.displayOrder,
            startTime: timeText(item.startTime),
            title: item.title,
            description: item.description,
          }),
        ),
        approvedByManagerAt: revision.managerApprovedAt.toISOString(),
        approvedByCoupleAt: revision.coupleApprovedAt.toISOString(),
        isEffective: revision.booking.effectiveTimelineRevisionId === revision.id,
      });
    },
  });
}

export function createPrismaBookingCommercialSnapshotReader(
  prisma: PrismaClient,
): BookingCommercialSnapshotReader {
  return Object.freeze({
    resolveApprovedContract: (bookingId: string, revisionId: string) =>
      createContractFinancialReader(prisma).resolveApproved(bookingId, revisionId),
    async getAccepted(input: Parameters<BookingCommercialSnapshotReader['getAccepted']>[0]) {
      const head = await prisma.commercialContract.findUnique({
        where: { bookingId: input.bookingId },
        include: { currentRevision: true },
      });
      if (head !== null) {
        const row = head.currentRevision;
        const booking = await prisma.booking.findUniqueOrThrow({
          where: { id: input.bookingId },
          include: { currentTimelineRevision: true },
        });
        if (
          row?.state !== 'APPROVED' ||
          row.timelineRevisionId !== input.timelineRevisionId ||
          booking.currentTimelineRevisionId !== input.timelineRevisionId ||
          booking.currentTimelineRevision?.managerApprovedAt == null ||
          booking.currentTimelineRevision.coupleApprovedAt === null
        )
          throw commercialConflict('CONTRACT_APPROVAL_REQUIRED');
        const snapshot = await createContractFinancialReader(prisma).resolveApproved(
          input.bookingId,
          row.id,
        );
        return Object.freeze({
          bookingId: input.bookingId,
          bookingRevision: booking.revision,
          commercialRevisionId: snapshot.contractRevisionId,
          baseChargeVnd: snapshot.contractTotalVnd,
          depositAmountVnd: snapshot.depositAmountVnd,
          menuPackageVersionId: snapshot.document.lines.find((line) => line.category === 'MENU')!
            .sourceRevisionId,
          tableCount: snapshot.document.tableCount,
          acceptedAt: snapshot.approvedAt,
          modelVersion: 'FULL_CONTRACT_V1' as const,
          contractRevisionId: snapshot.contractRevisionId,
          documentDigest: snapshot.documentDigest,
        });
      }
      const booking = await prisma.booking.findUnique({
        where: { id: input.bookingId },
        select: {
          id: true,
          revision: true,
          timelineRevisions: {
            where: { id: input.timelineRevisionId },
            select: { managerApprovedAt: true, coupleApprovedAt: true },
            take: 1,
          },
          proposalSnapshot: {
            select: {
              id: true,
              commercialRevisionId: true,
              commercialAcceptedAt: true,
              baseChargeVnd: true,
              depositAmountVnd: true,
              menuPackageVersionId: true,
              tableCount: true,
            },
          },
        },
      });
      const timeline = booking?.timelineRevisions[0];
      if (
        booking === null ||
        booking.proposalSnapshot === null ||
        timeline === undefined ||
        timeline.managerApprovedAt === null ||
        timeline.coupleApprovedAt === null ||
        booking.proposalSnapshot.commercialRevisionId === null ||
        booking.proposalSnapshot.commercialAcceptedAt === null
      ) {
        throw new BookingLifecycleNotFoundError();
      }
      return Object.freeze({
        bookingId: booking.id,
        commercialRevisionId: booking.proposalSnapshot.commercialRevisionId,
        bookingRevision: booking.revision,
        baseChargeVnd: decimalNumber(booking.proposalSnapshot.baseChargeVnd),
        depositAmountVnd: decimalNumber(booking.proposalSnapshot.depositAmountVnd),
        menuPackageVersionId: booking.proposalSnapshot.menuPackageVersionId,
        tableCount: booking.proposalSnapshot.tableCount,
        acceptedAt: booking.proposalSnapshot.commercialAcceptedAt.toISOString(),
        modelVersion: 'LEGACY_PROPOSAL_V1' as const,
        contractRevisionId: null,
        documentDigest: null,
      });
    },
  });
}

export function createPrismaBookingPlanningSnapshotReader(
  prisma: PrismaClient,
): BookingPlanningSnapshotReader {
  return Object.freeze({
    async getCurrent(bookingId: string) {
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { id: true, revision: true, planningHeadcount: true },
      });
      if (booking === null) throw new BookingLifecycleNotFoundError();
      return Object.freeze({
        bookingId: booking.id,
        bookingRevision: booking.revision,
        planningHeadcount: booking.planningHeadcount,
      });
    },
  });
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function timeText(value: Date): string {
  return value.toISOString().slice(11, 16);
}

function decimalNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value !== null && 'toNumber' in value) {
    return (value as Readonly<{ toNumber(): number }>).toNumber();
  }
  return Number(value);
}
