import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';

export async function nativeTimelineFixture(
  prisma: PrismaClient,
  input: {
    bookingId: string;
    timelineId: string;
    revisionNumber: number;
    actorId: string;
    now: Date;
    approved?: boolean;
    startTime?: string;
    title?: string;
    predecessorRevisionId?: string;
  },
) {
  return prisma.bookingTimelineRevision.create({
    data: {
      id: input.timelineId,
      bookingId: input.bookingId,
      revisionNumber: input.revisionNumber,
      state: input.approved === false ? 'CURRENT' : 'EFFECTIVE',
      predecessorRevisionId: input.predecessorRevisionId ?? null,
      contentHash: `native-fixture-${input.timelineId}`,
      createdByAccountId: input.actorId,
      createdAt: input.now,
      managerApprovedAt: input.approved === false ? null : input.now,
      coupleApprovedAt: input.approved === false ? null : input.now,
      items: {
        create: {
          id: randomUUID(),
          itemId: randomUUID(),
          displayOrder: 0,
          startTime: new Date(`1970-01-01T${input.startTime ?? '11:00'}:00Z`),
          title: input.title ?? 'Welcome',
        },
      },
    },
  });
}

/** Seeds canonical owner records for adapter integration, without simulating payment acceptance. */
export async function nativeBookingFixture(
  prisma: PrismaClient,
  input: {
    bookingId: string;
    consultationId: string;
    timelineId: string;
    paymentId: string;
    actorId: string;
    managerId?: string;
    hallId?: string;
    eventDate: Date;
    now: Date;
  },
) {
  const hallId = input.hallId ?? randomUUID();
  const managerId = input.managerId ?? input.actorId;
  if (input.hallId === undefined) {
    await prisma.hall.create({
      data: {
        id: hallId,
        name: `Hall ${hallId}`,
        nameNormalized: `hall ${hallId}`,
        description: '',
        maxGuests: 100,
        displayOrder: 0,
        updatedByAccountId: managerId,
      },
    });
  }
  const menuPackageId = randomUUID();
  const menuVersionId = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.menuPackage.create({
      data: {
        id: menuPackageId,
        displayOrder: 0,
        createdByAccountId: managerId,
        updatedByAccountId: managerId,
        versions: {
          create: {
            id: menuVersionId,
            versionNumber: 1,
            state: 'PUBLISHED',
            name: 'Approved menu',
            description: '',
            priceVndPerTable: 1_000_000,
            createdByAccountId: managerId,
            publishedAt: input.now,
          },
        },
      },
    });
    await tx.menuPackage.update({
      where: { id: menuPackageId },
      data: { currentPublishedVersionId: menuVersionId },
    });
  });
  await prisma.consultation.create({
    data: {
      id: input.consultationId,
      managerAccountId: managerId,
      intendedEmail: `${input.actorId}@example.test`,
      intendedEmailNormalized: `${input.actorId}@example.test`,
      displayName: 'Native studio couple',
      booking: {
        create: {
          id: input.bookingId,
          hallId,
          shiftCode: 'LUNCH',
          eventDate: input.eventDate,
          planningHeadcount: 20,
          proposalSnapshot: {
            create: {
              hallId,
              hallName: 'Approved hall',
              hallDescription: '',
              hallMaxGuests: 100,
              shiftCode: 'LUNCH',
              shiftStartTime: new Date('1970-01-01T11:00:00Z'),
              shiftEndTime: new Date('1970-01-01T14:00:00Z'),
              menuPackageId,
              menuPackageVersionId: menuVersionId,
              menuVersionNumber: 1,
              menuName: 'Approved menu',
              menuDescription: '',
              menuPriceVndPerTable: 1_000_000,
              tableCount: 2,
              planningHeadcount: 20,
              baseChargeVnd: 2_000_000,
              depositAmountVnd: 600_000,
            },
          },
        },
      },
    },
  });
  await nativeTimelineFixture(prisma, {
    bookingId: input.bookingId,
    timelineId: input.timelineId,
    revisionNumber: 1,
    actorId: managerId,
    now: input.now,
  });
  const proposal = await prisma.bookingProposalSnapshot.findUniqueOrThrow({
    where: { bookingId: input.bookingId },
    // This fixture also runs before later additive proposal columns exist.
    select: { id: true },
  });
  await prisma.bookingProposalSnapshot.update({
    where: { bookingId: input.bookingId },
    data: { commercialRevisionId: proposal.id, commercialAcceptedAt: input.now },
    select: { id: true },
  });
  await prisma.bookingDepositSettlement.create({
    data: {
      paymentId: input.paymentId,
      bookingId: input.bookingId,
      timelineRevisionId: input.timelineId,
      amountVnd: 600_000,
      settledAt: input.now,
      promotionStatus: 'SUCCEEDED',
      promotedAt: input.now,
    },
  });
  await prisma.booking.update({
    where: { id: input.bookingId },
    data: {
      phase: 'CONFIRMED',
      currentTimelineRevisionId: input.timelineId,
      effectiveTimelineRevisionId: input.timelineId,
    },
  });
  await prisma.consultationAccess.create({
    data: {
      accountId: input.actorId,
      consultationId: input.consultationId,
      bookingId: input.bookingId,
      level: 'FULL',
      sourcePaymentId: input.paymentId,
      promotedAt: input.now,
    },
  });
  return { hallId };
}
