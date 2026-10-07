import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { ConsultationAccessReader } from '../../identity-access/authorization/authorization.service.js';
import { BookingLifecycleNotFoundError } from '../infrastructure/consultation.repository.js';

type ProposalActor = Readonly<{
  accountId: string;
  roles: readonly ('MANAGER' | 'STAFF' | 'COUPLE')[];
}>;

export function createProposalQueryService(prisma: PrismaClient, access: ConsultationAccessReader) {
  return Object.freeze({
    async get(input: Readonly<{ bookingId: string; actor: ProposalActor }>) {
      const booking = await requireProposal(prisma, input.bookingId);
      const manager =
        booking.consultation.managerAccountId === input.actor.accountId &&
        input.actor.roles.includes('MANAGER');
      const grant = manager
        ? ({ level: 'FULL' } as const)
        : await access.requireAccess({
            accountId: input.actor.accountId,
            consultationId: booking.consultationId,
            minimum: 'RESTRICTED',
          });
      const snapshot = booking.proposalSnapshot;
      if (snapshot === null) throw new BookingLifecycleNotFoundError();
      return immutable({
        bookingId: booking.id,
        consultationId: booking.consultationId,
        phase: booking.phase,
        revision: booking.revision,
        eventDate: booking.eventDate.toISOString().slice(0, 10),
        planningHeadcount: booking.planningHeadcount,
        proposal: {
          hall: {
            id: snapshot.hallId,
            name: snapshot.hallName,
            description: snapshot.hallDescription,
            maxGuests: snapshot.hallMaxGuests,
          },
          shift: {
            code: snapshot.shiftCode,
            startTime: timeText(snapshot.shiftStartTime),
            endTime: timeText(snapshot.shiftEndTime),
          },
          menu: {
            versionId: snapshot.menuPackageVersionId,
            packageId: snapshot.menuPackageId,
            versionNumber: snapshot.menuVersionNumber,
            name: snapshot.menuName,
            description: snapshot.menuDescription,
            priceVndPerTable: decimalNumber(snapshot.menuPriceVndPerTable),
          },
          tableCount: snapshot.tableCount,
          baseChargeVnd: decimalNumber(snapshot.baseChargeVnd),
          depositAmountVnd: decimalNumber(snapshot.depositAmountVnd),
        },
        timeline:
          booking.currentTimelineRevision === null
            ? null
            : {
                revisionId: booking.currentTimelineRevision.id,
                revisionNumber: booking.currentTimelineRevision.revisionNumber,
                predecessorRevisionId: booking.currentTimelineRevision.predecessorRevisionId,
                managerApprovedAt:
                  booking.currentTimelineRevision.managerApprovedAt?.toISOString() ?? null,
                coupleApprovedAt:
                  booking.currentTimelineRevision.coupleApprovedAt?.toISOString() ?? null,
                items: booking.currentTimelineRevision.items.map((item) => ({
                  itemId: item.itemId,
                  order: item.displayOrder,
                  startTime: timeText(item.startTime),
                  title: item.title,
                  description: item.description,
                })),
              },
        capabilities: {
          accessLevel: grant.level,
          canEditTimeline: booking.phase === 'DRAFT' || booking.phase === 'CONFIRMED',
          canApproveTimeline: booking.phase === 'DRAFT' || booking.phase === 'CONFIRMED',
          canRequestCancellation: grant.level === 'FULL' && booking.phase === 'CONFIRMED',
        },
      });
    },

    async getManagerSlotContext(bookingId: string, managerAccountId: string) {
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: {
          id: true,
          hallId: true,
          eventDate: true,
          shiftCode: true,
          currentTimelineRevisionId: true,
          consultation: { select: { managerAccountId: true } },
        },
      });
      if (booking === null || booking.consultation.managerAccountId !== managerAccountId) {
        throw new BookingLifecycleNotFoundError();
      }
      return Object.freeze({
        hallId: booking.hallId,
        eventDate: booking.eventDate.toISOString().slice(0, 10),
        shiftCode: booking.shiftCode,
        currentTimelineRevisionId: booking.currentTimelineRevisionId,
      });
    },

    async getCurrentTimelineRevisionId(bookingId: string) {
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { currentTimelineRevisionId: true },
      });
      if (booking === null) throw new BookingLifecycleNotFoundError();
      return booking.currentTimelineRevisionId;
    },
  });
}

async function requireProposal(prisma: PrismaClient, bookingId: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      consultationId: true,
      phase: true,
      revision: true,
      eventDate: true,
      planningHeadcount: true,
      consultation: { select: { managerAccountId: true } },
      proposalSnapshot: true,
      currentTimelineRevision: {
        select: {
          id: true,
          revisionNumber: true,
          predecessorRevisionId: true,
          managerApprovedAt: true,
          coupleApprovedAt: true,
          items: { orderBy: { displayOrder: 'asc' } },
        },
      },
    },
  });
  if (booking === null) throw new BookingLifecycleNotFoundError();
  return booking;
}

function immutable<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
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
