import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { ConsultationAccessReader } from '../../identity-access/authorization/authorization.service.js';
import { BookingLifecycleNotFoundError } from '../infrastructure/consultation.repository.js';
import { proposalMenuLinesSchema } from '../domain/booking-policy.js';
import { localVietnamTime } from '../domain/lifecycle.policy.js';
import { completionAppendix } from '../domain/completion-appendix.js';

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
      const menu = {
        versionId: snapshot.menuPackageVersionId,
        packageId: snapshot.menuPackageId,
        versionNumber: snapshot.menuVersionNumber,
        name: snapshot.menuName,
        description: snapshot.menuDescription,
        priceVndPerTable: decimalNumber(snapshot.menuPriceVndPerTable),
      };
      const menus =
        snapshot.menus == null
          ? [
              {
                ...menu,
                tableCount: snapshot.tableCount,
                lineTotalVnd: decimalNumber(snapshot.baseChargeVnd),
              },
            ]
          : proposalMenuLinesSchema.parse(snapshot.menus);
      const approvedContract =
        booking.commercialContract?.currentRevision?.state === 'APPROVED'
          ? booking.commercialContract.currentRevision
          : null;
      const baseChargeVnd =
        approvedContract !== null
          ? decimalNumber(approvedContract.contractTotalVnd)
          : decimalNumber(snapshot.baseChargeVnd);
      const depositAmountVnd =
        approvedContract !== null
          ? decimalNumber(approvedContract.depositAmountVnd)
          : decimalNumber(snapshot.depositAmountVnd);
      const contractDocument = approvedContract?.document as
        Readonly<{ tableCount?: number }> | undefined;
      const tableCount = contractDocument?.tableCount ?? snapshot.tableCount;
      const paymentPending = booking.depositIntents.length > 0;
      const mutuallyApproved = Boolean(
        booking.currentTimelineRevision?.managerApprovedAt &&
        booking.currentTimelineRevision.coupleApprovedAt,
      );
      const ownApproval = manager
        ? booking.currentTimelineRevision?.managerApprovedAt
        : booking.currentTimelineRevision?.coupleApprovedAt;
      const appendix = completionAppendix(booking.commercialAppendices?.currentRevision);
      return immutable({
        bookingId: booking.id,
        consultationId: booking.consultationId,
        phase: booking.phase,
        revision: booking.revision,
        eventDate: booking.eventDate.toISOString().slice(0, 10),
        planningHeadcount: booking.planningHeadcount,
        completion: {
          ...appendix,
          canComplete: manager && booking.phase === 'CONFIRMED' && !appendix.pending,
        },
        commercialProgress: {
          modelVersion: booking.commercialContract
            ? ('FULL_CONTRACT_V1' as const)
            : booking.commercialModelVersion,
          selectionStatus:
            booking.commercialSelections?.[0]?.status === 'SUBMITTED'
              ? ('SUBMITTED' as const)
              : booking.commercialSelections?.[0]
                ? ('DRAFT' as const)
                : ('NOT_STARTED' as const),
          contractState: booking.commercialContract?.currentRevision?.state ?? null,
          managerApproved:
            booking.commercialContract?.currentRevision?.approvals?.some(
              (item) => item.party === 'MANAGER',
            ) ?? false,
          coupleApproved:
            booking.commercialContract?.currentRevision?.approvals?.some(
              (item) => item.party === 'COUPLE',
            ) ?? false,
          timelineMatchesContract: Boolean(
            booking.commercialContract?.currentRevision &&
            booking.currentTimelineRevision &&
            booking.commercialContract.currentRevision.timelineRevisionId ===
              booking.currentTimelineRevision.id,
          ),
        },
        depositTerms: {
          holdExpiresAt: booking.slotHolds?.[0]?.expiresAt.toISOString() ?? null,
          paymentPending,
          cancellationClosesAt: localVietnamTime(
            booking.eventDate.toISOString().slice(0, 10),
            timeText(snapshot.shiftStartTime),
          ).toISOString(),
          cancellationNotice:
            'Không thể hủy tiệc từ giờ bắt đầu ca tiệc. Yêu cầu hủy cần được nhà hàng tiếp nhận và xử lý.',
          refundNotice:
            'Hủy tiệc không tự động hoàn cọc. Khoản hoàn được nhà hàng xác nhận theo thỏa thuận và ghi nhận vào lịch sử giao dịch; không vượt quá số tiền đã thu chưa hoàn.',
        },
        cancellationRequests: booking.cancellationRequests.map((request) => ({
          requestId: request.id,
          reason: request.reason,
          requestedAt: request.requestedAt.toISOString(),
        })),
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
          menu,
          menus,
          tableCount,
          baseChargeVnd,
          depositAmountVnd,
          depositPercentage: booking.depositPercentage ?? 30,
        },
        timeline: timelineView(booking.currentTimelineRevision),
        effectiveTimeline: timelineView(booking.effectiveTimelineRevision),
        capabilities: {
          accessLevel: grant.level,
          canEditTimeline:
            !paymentPending &&
            (booking.phase === 'CONFIRMED' ||
              (['DRAFT', 'AWAITING_DEPOSIT'].includes(booking.phase) && !mutuallyApproved)),
          canApproveTimeline:
            !paymentPending &&
            !ownApproval &&
            ['DRAFT', 'AWAITING_DEPOSIT', 'CONFIRMED'].includes(booking.phase) &&
            booking.currentTimelineRevision?.state === 'CURRENT',
          canWithdrawApproval:
            !paymentPending &&
            Boolean(ownApproval) &&
            ['DRAFT', 'AWAITING_DEPOSIT'].includes(booking.phase),
          canRequestCancellation:
            !manager && ['DRAFT', 'AWAITING_DEPOSIT', 'CONFIRMED'].includes(booking.phase),
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
      commercialModelVersion: true,
      depositPercentage: true,
      commercialSelections: {
        orderBy: { revisionNumber: 'desc' },
        take: 1,
        select: { status: true },
      },
      slotHolds: { where: { status: 'ACTIVE' }, take: 1, select: { expiresAt: true } },
      cancellationRequests: {
        where: { status: 'PENDING' },
        orderBy: [{ requestedAt: 'asc' }, { id: 'asc' }],
        select: { id: true, reason: true, requestedAt: true },
      },
      consultation: { select: { managerAccountId: true } },
      depositIntents: {
        where: { status: { in: ['ACTIVE', 'UNKNOWN'] } },
        take: 1,
        select: { id: true },
      },
      commercialContract: {
        select: {
          currentRevision: {
            select: {
              state: true,
              timelineRevisionId: true,
              approvals: { select: { party: true } },
              contractTotalVnd: true,
              depositAmountVnd: true,
              document: true,
            },
          },
        },
      },
      commercialAppendices: {
        select: {
          currentRevision: {
            select: {
              state: true,
              revisionNumber: true,
              documentDigest: true,
              approvals: { select: { party: true, documentDigest: true } },
            },
          },
        },
      },
      proposalSnapshot: true,
      currentTimelineRevision: {
        select: {
          id: true,
          state: true,
          revisionNumber: true,
          predecessorRevisionId: true,
          managerApprovedAt: true,
          coupleApprovedAt: true,
          items: { orderBy: { displayOrder: 'asc' } },
        },
      },
      effectiveTimelineRevision: {
        select: {
          id: true,
          state: true,
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

function timelineView(
  stored: Awaited<ReturnType<typeof requireProposal>>['currentTimelineRevision'],
) {
  if (stored === null) return null;
  return {
    revisionId: stored.id,
    revisionNumber: stored.revisionNumber,
    predecessorRevisionId: stored.predecessorRevisionId,
    managerApprovedAt: stored.managerApprovedAt?.toISOString() ?? null,
    coupleApprovedAt: stored.coupleApprovedAt?.toISOString() ?? null,
    items: stored.items.map((item) => ({
      itemId: item.itemId,
      order: item.displayOrder,
      startTime: timeText(item.startTime),
      title: item.title,
      description: item.description,
    })),
  };
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
