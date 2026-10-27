import { bookingEventMetadata } from '../../../core/integration-events/booking-event.js';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import type { DepositEligibility } from '../application/deposit.service.js';
import { contractDocumentSchema, documentDigest } from '../domain/commercial-contract.js';
import { evaluateDepositEligibility } from '../domain/deposit.policy.js';
import { BookingLifecycleNotFoundError } from './consultation.repository.js';

export type EligibilityClient = Pick<
  PrismaClient | Prisma.TransactionClient,
  'booking' | 'consultationAccess'
> & {
  bookingSlotHold?: Pick<PrismaClient['bookingSlotHold'], 'findFirst' | 'updateMany'>;
};

export async function readEligibility(
  client: EligibilityClient,
  input: Readonly<{ bookingId: string; timelineRevisionId: string }>,
  databaseNow: Date,
  actorAccountId: string | null = null,
): Promise<DepositEligibility> {
  const booking = await client.booking.findUnique({
    where: { id: input.bookingId },
    select: {
      hallId: true,
      eventDate: true,
      shiftCode: true,
      consultationId: true,
      consultation: { select: { intendedEmailNormalized: true } },
      phase: true,
      revision: true,
      currentTimelineRevisionId: true,
      currentTimelineRevision: {
        select: { id: true, managerApprovedAt: true, coupleApprovedAt: true },
      },
      proposalSnapshot: { select: { depositAmountVnd: true } },
      commercialContract: { include: { currentRevision: { include: { approvals: true } } } },
      slotHolds: {
        where: { status: 'ACTIVE' },
        select: { expiresAt: true, depositIntentPin: true },
        take: 1,
      },
    },
  });
  if (booking === null || booking.proposalSnapshot === null) {
    throw new BookingLifecycleNotFoundError();
  }
  const access = await client.consultationAccess.findFirst({
    where: {
      consultationId: booking.consultationId,
      ...(actorAccountId === null
        ? {
            account: {
              emailNormalized: booking.consultation.intendedEmailNormalized,
              status: 'ACTIVE',
            },
          }
        : { accountId: actorAccountId, account: { status: 'ACTIVE' } }),
    },
    select: { accountId: true },
  });
  if (access === null) throw new BookingLifecycleNotFoundError();
  const hold = booking.slotHolds[0];
  let hasActiveSlotHold =
    hold !== undefined &&
    (hold.expiresAt.getTime() > databaseNow.getTime() ||
      hold.depositIntentPin === 'ACTIVE' ||
      hold.depositIntentPin === 'UNKNOWN');
  if (!hasActiveSlotHold && booking.hallId && booking.eventDate && booking.shiftCode) {
    if (typeof client.booking.findFirst === 'function') {
      const confirmedOther = await client.booking.findFirst({
        where: {
          id: { not: input.bookingId },
          hallId: booking.hallId,
          eventDate: booking.eventDate,
          shiftCode: booking.shiftCode,
          phase: { in: ['CONFIRMED', 'COMPLETED'] },
        },
        select: { id: true },
      });
      const activeOtherHold =
        typeof client.bookingSlotHold?.findFirst === 'function'
          ? await client.bookingSlotHold.findFirst({
              where: {
                hallId: booking.hallId,
                eventDate: booking.eventDate,
                shiftCode: booking.shiftCode,
                status: 'ACTIVE',
                bookingId: { not: input.bookingId },
                OR: [
                  { expiresAt: { gt: databaseNow } },
                  { depositIntentPin: { in: ['ACTIVE', 'UNKNOWN'] } },
                ],
              },
              select: { id: true },
            })
          : null;

      if (confirmedOther === null && activeOtherHold === null) {
        hasActiveSlotHold = true;
      }
    }
  }
  let reasonCode = evaluateDepositEligibility({
    bookingPhase: booking.phase,
    requestedTimelineRevisionId: input.timelineRevisionId,
    currentTimelineRevisionId: booking.currentTimelineRevisionId,
    managerApproved: booking.currentTimelineRevision?.managerApprovedAt != null,
    coupleApproved: booking.currentTimelineRevision?.coupleApprovedAt != null,
    hasActiveSlotHold,
  });
  const contract = booking.commercialContract?.currentRevision;
  if (booking.commercialContract !== null) {
    const document = contract == null ? null : contractDocumentSchema.parse(contract.document);
    if (
      contract?.state !== 'APPROVED' ||
      contract.timelineRevisionId !== input.timelineRevisionId ||
      contract.approvals.length !== 2 ||
      document?.brideName == null ||
      document.groomName === null ||
      documentDigest(document) !== contract.documentDigest ||
      contract.approvals.some((approval) => approval.documentDigest !== contract.documentDigest)
    ) {
      if (reasonCode === 'ELIGIBLE') reasonCode = 'CONTRACT_APPROVAL_REQUIRED';
    }
  }
  return Object.freeze({
    eligible: reasonCode === 'ELIGIBLE',
    reasonCode,
    consultationId: booking.consultationId,
    coupleAccountId: access.accountId,
    bookingRevision: booking.revision,
    depositAmountVnd: decimalNumber(
      contract?.depositAmountVnd ?? booking.proposalSnapshot.depositAmountVnd,
    ),
    contractRevisionId: contract?.id ?? null,
    documentDigest: contract?.documentDigest ?? null,
    ...(contract == null ? {} : { contractTotalVnd: decimalNumber(contract.contractTotalVnd) }),
    ...(booking.hallId && booking.eventDate && booking.shiftCode
      ? {
          slot: {
            hallId: booking.hallId,
            eventDate: booking.eventDate,
            shiftCode: booking.shiftCode,
          },
        }
      : {}),
  });
}

export async function appendEvidence(
  transaction: Prisma.TransactionClient,
  createId: () => string,
  input: Readonly<{
    action: string;
    eventType: string;
    bookingId: string;
    bookingRevision: number;
    timelineRevisionId: string;
    requestId: string;
    causationId?: string | null;
    actorAccountId: string | null;
    occurredAt: Date;
  }>,
): Promise<void> {
  await transaction.auditLog.create({
    data: {
      occurredAt: input.occurredAt,
      requestId: input.requestId,
      actorType: input.actorAccountId === null ? 'SYSTEM' : 'USER',
      actorId: input.actorAccountId,
      action: input.action,
      entityType: 'booking',
      entityId: input.bookingId,
      metadata: {
        bookingRevision: input.bookingRevision,
        timelineRevisionId: input.timelineRevisionId,
      },
    },
  });
  await transaction.bookingOutboxEvent.create({
    data: {
      ...bookingEventMetadata(input),
      id: createId(),
      eventType: input.eventType,
      aggregateId: input.bookingId,
      aggregateRevision: input.bookingRevision,
      occurredAt: input.occurredAt,
      payload: {
        bookingId: input.bookingId,
        timelineRevisionId: input.timelineRevisionId,
        bookingRevision: input.bookingRevision,
        ...(input.eventType === 'booking.deposit-eligible'
          ? { eligibleAt: input.occurredAt.toISOString() }
          : {}),
      },
    },
  });
}

export function decimalNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value !== null && 'toNumber' in value) {
    return (value as Readonly<{ toNumber(): number }>).toNumber();
  }
  return Number(value);
}
