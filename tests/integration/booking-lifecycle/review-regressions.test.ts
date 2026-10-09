import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBookingDepositService } from '../../../src/modules/booking-lifecycle/application/deposit.service.js';
import {
  approveTimelineRevision,
  createTimelineRevision,
  withdrawTimelineApproval,
  type TimelineParty,
} from '../../../src/modules/booking-lifecycle/domain/timeline.policy.js';
import { createPrismaBookingCommercialSnapshotReader } from '../../../src/modules/booking-lifecycle/infrastructure/booking-readers.repository.js';
import {
  createPrismaConsultationRepository,
  createPrismaConsultationWorkspaceRepository,
} from '../../../src/modules/booking-lifecycle/infrastructure/consultation.repository.js';
import { createPrismaBookingDepositRepository } from '../../../src/modules/booking-lifecycle/infrastructure/deposit.repository.js';
import { createPrismaBookingLifecycleRepository } from '../../../src/modules/booking-lifecycle/infrastructure/lifecycle.repository.js';
import { createPrismaSlotHoldRepository } from '../../../src/modules/booking-lifecycle/infrastructure/slot-hold.repository.js';
import { createPrismaTimelineRepository } from '../../../src/modules/booking-lifecycle/infrastructure/timeline.repository.js';
import {
  createCoupleAccessPromoter,
  createPrismaCoupleAccessPromotionRepository,
} from '../../../src/modules/identity-access/authorization/couple-access-promotion.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';

const describeWithDatabase = catalogMigrationDatabaseUrl ? describe : describe.skip;

describeWithDatabase('booking lifecycle review regressions', () => {
  const database = new CatalogTestDatabase('booking_regressions');

  beforeAll(() => database.connect(), 60_000);
  afterAll(() => database.disconnect());

  it('settles and promotes the initiating account when another grant was created first', async () => {
    const fixture = await createFixture();
    const payerId = await createAccount();
    await database.prisma.consultationAccess.create({
      data: {
        accountId: payerId,
        consultationId: fixture.consultationId,
        level: 'RESTRICTED',
        createdAt: new Date(fixture.now.getTime() + 1_000),
      },
    });
    const repository = createPrismaBookingDepositRepository(database.prisma);
    const service = createBookingDepositService({
      repository,
      promoter: createCoupleAccessPromoter(
        createPrismaCoupleAccessPromotionRepository(database.prisma),
      ),
    });
    const paymentAttemptId = randomUUID();
    await repository.reserve({
      ...reserveInput(fixture),
      paymentAttemptId,
      actorAccountId: payerId,
    });
    await service.recordSuccessfulDeposit({
      bookingId: fixture.bookingId,
      timelineRevisionId: fixture.timelineRevisionId,
      paymentId: randomUUID(),
      amountVnd: 15_000_000,
      settledAt: fixture.now,
    });

    const intent = await database.prisma.bookingDepositIntent.findUniqueOrThrow({
      where: { id: paymentAttemptId },
    });
    const grants = await database.prisma.consultationAccess.findMany({
      where: { consultationId: fixture.consultationId },
    });
    expect(intent.coupleAccountId).toBe(payerId);
    expect(grants.find((grant) => grant.accountId === payerId)?.level).toBe('FULL');
    expect(grants.find((grant) => grant.accountId === fixture.coupleId)?.level).toBe('RESTRICTED');
  });

  it('rejects a deposit reservation from an account without consultation access', async () => {
    const fixture = await createFixture();
    const outsiderId = await createAccount();
    const repository = createPrismaBookingDepositRepository(database.prisma);

    await expect(
      repository.reserve({ ...reserveInput(fixture), actorAccountId: outsiderId }),
    ).rejects.toMatchObject({ status: 404, code: 'BOOKING_NOT_FOUND' });
    expect(
      await database.prisma.bookingDepositIntent.count({
        where: { bookingId: fixture.bookingId },
      }),
    ).toBe(0);
    expect(
      (await database.prisma.booking.findUniqueOrThrow({ where: { id: fixture.bookingId } })).phase,
    ).toBe('DRAFT');
  });

  it('reuses a pending invitation after creating a booking advances consultation revision', async () => {
    const fixture = await createFixture();
    const consultationId = randomUUID();
    const intendedEmail = `retry-${consultationId}@example.com`;
    const workspace = createPrismaConsultationWorkspaceRepository(database.prisma);
    await workspace.createConsultation({
      consultationId,
      managerAccountId: fixture.managerId,
      intendedEmail,
      displayName: 'Invitation retry',
      note: null,
      revision: 1,
      requestId: randomUUID(),
    });
    const repository = createPrismaConsultationRepository(database.prisma);
    const request = {
      consultationId,
      invitationIntentId: randomUUID(),
      managerAccountId: fixture.managerId,
      intendedEmail,
      expectedRevision: 1,
      requestId: randomUUID(),
      status: 'PENDING' as const,
      invitationId: null,
    };
    const original = await repository.getOrCreateInvitationIntent(request);
    await workspace.createBooking({
      consultationId,
      bookingId: randomUUID(),
      managerAccountId: fixture.managerId,
      expectedConsultationRevision: 1,
      requestId: randomUUID(),
      proposal: {
        hall: { id: fixture.hallId, name: 'Hall', description: 'Hall', maxGuests: 500 },
        shift: { code: 'DINNER', startTime: '17:30', endTime: '22:00' },
        menu: {
          packageId: fixture.menuPackageId,
          versionId: fixture.menuVersionId,
          versionNumber: 1,
          name: 'Menu',
          description: 'Menu',
          priceVndPerTable: 5_000_000,
        },
        eventDate: fixture.eventDate,
        tableCount: 10,
        planningHeadcount: 100,
        baseChargeVnd: 50_000_000,
        depositAmountVnd: 15_000_000,
      },
    });

    const oldRevisionRetry = await repository.getOrCreateInvitationIntent(request);
    const currentRevisionRetry = await repository.getOrCreateInvitationIntent({
      ...request,
      invitationIntentId: randomUUID(),
      expectedRevision: 2,
      requestId: randomUUID(),
    });
    expect(oldRevisionRetry).toEqual(original);
    expect(currentRevisionRetry).toEqual(original);
    expect(await database.prisma.bookingInvitationIntent.count({ where: { consultationId } })).toBe(
      1,
    );
  });

  it('keeps commercial acceptance immutable across withdrawal, reapproval and a successor timeline', async () => {
    const fixture = await createFixture();
    const repository = createPrismaTimelineRepository(database.prisma);
    const reader = createPrismaBookingCommercialSnapshotReader(database.prisma);
    const input = {
      bookingId: fixture.bookingId,
      timelineRevisionId: fixture.timelineRevisionId,
    };
    const context = {
      requestId: randomUUID(),
      causationId: randomUUID(),
      actorAccountId: fixture.coupleId,
      authority: 'AUTHENTICATED' as const,
    };
    const original = await reader.getAccepted(input, context);
    expect(await reader.getAccepted(input, context)).toEqual(original);
    const [persisted] = await database.prisma.$queryRaw<
      Array<{ commercialRevisionId: string; commercialAcceptedAt: Date }>
    >`SELECT "commercialRevisionId", "commercialAcceptedAt"
      FROM "BookingProposalSnapshot" WHERE "bookingId" = ${fixture.bookingId}::uuid`;
    expect(persisted?.commercialRevisionId).toBe(original.commercialRevisionId);
    expect(persisted?.commercialAcceptedAt.toISOString()).toBe(original.acceptedAt);
    const later = new Date(fixture.now.getTime() + 60_000);
    await expect(
      database.prisma.$executeRaw`UPDATE "BookingProposalSnapshot"
        SET "commercialAcceptedAt" = ${later}
        WHERE "bookingId" = ${fixture.bookingId}::uuid`,
    ).rejects.toThrow();
    expect(await reader.getAccepted(input, context)).toEqual(original);
    const current = await repository.getContext(fixture.bookingId);
    if (current.currentRevision === null) throw new Error('Expected fixture timeline.');
    await repository.withdraw({
      ...input,
      expectedBookingRevision: current.bookingRevision,
      actorAccountId: fixture.coupleId,
      party: 'COUPLE',
      requestId: randomUUID(),
      decisionAt: later,
      reason: 'Review the schedule',
      withdrawnRevision: withdrawTimelineApproval(current.currentRevision, 'COUPLE', 'DRAFT'),
    });
    await approve(fixture.bookingId, 'COUPLE', fixture.coupleId, later);
    const reaccepted = await reader.getAccepted(input, context);
    expect(reaccepted.commercialRevisionId).toBe(original.commercialRevisionId);
    expect(reaccepted.acceptedAt).toBe(original.acceptedAt);

    const beforeSuccessor = await repository.getContext(fixture.bookingId);
    if (beforeSuccessor.currentRevision === null) throw new Error('Expected fixture timeline.');
    const successor = createTimelineRevision({
      revisionId: randomUUID(),
      bookingId: fixture.bookingId,
      predecessor: beforeSuccessor.currentRevision,
      items: beforeSuccessor.currentRevision.items.map((item) => ({
        ...item,
        title: 'Updated welcome',
      })),
      shift: beforeSuccessor.shift,
      createdAt: later,
    }).revision;
    await repository.save({
      revision: successor,
      expectedBookingRevision: beforeSuccessor.bookingRevision,
      actorAccountId: fixture.managerId,
      party: 'MANAGER',
      requestId: randomUUID(),
    });
    const historical = await reader.getAccepted(input, context);
    expect(historical.commercialRevisionId).toBe(original.commercialRevisionId);
    expect(historical.acceptedAt).toBe(original.acceptedAt);
    await approve(fixture.bookingId, 'MANAGER', fixture.managerId, later);
    await approve(fixture.bookingId, 'COUPLE', fixture.coupleId, later);
    const replacement = await reader.getAccepted(
      { bookingId: fixture.bookingId, timelineRevisionId: successor.revisionId },
      context,
    );
    expect(replacement.commercialRevisionId).toBe(original.commercialRevisionId);
    expect(replacement.acceptedAt).toBe(original.acceptedAt);
  });

  it('releases an active hold atomically when the manager cancels a draft booking', async () => {
    const fixture = await createFixture();
    await createPrismaBookingLifecycleRepository(database.prisma).cancel({
      bookingId: fixture.bookingId,
      expectedBookingRevision: fixture.bookingRevision,
      reason: 'Changed plans',
      context: { requestId: randomUUID(), actorAccountId: fixture.managerId },
    });
    const hold = await database.prisma.bookingSlotHold.findUniqueOrThrow({
      where: { id: fixture.holdId },
    });
    const availability = await createPrismaSlotHoldRepository(database.prisma).inspect({
      hallId: fixture.hallId,
      eventDate: fixture.eventDate,
      shiftCode: 'DINNER',
      databaseNow: fixture.now,
    });
    expect(hold.status).toBe('RELEASED');
    expect(hold.terminalAt).not.toBeNull();
    expect(availability.available).toBe(true);
    expect(
      (await database.prisma.booking.findUniqueOrThrow({ where: { id: fixture.bookingId } })).phase,
    ).toBe('CANCELLED');
  });

  it('keeps a database-valid hold when the requesting application clock is eleven minutes fast', async () => {
    const fixture = await createFixture();
    const nextBookingId = randomUUID();
    await database.prisma.consultation.create({
      data: {
        id: randomUUID(),
        managerAccountId: fixture.managerId,
        intendedEmailNormalized: `${nextBookingId}@example.com`,
        intendedEmail: `${nextBookingId}@example.com`,
        displayName: 'Another slot request',
        booking: {
          create: {
            id: nextBookingId,
            hallId: fixture.hallId,
            eventDate: new Date(`${fixture.eventDate}T00:00:00Z`),
            shiftCode: 'DINNER',
            planningHeadcount: 100,
          },
        },
      },
    });
    await expect(
      createPrismaSlotHoldRepository(database.prisma).acquire({
        bookingId: nextBookingId,
        holdId: randomUUID(),
        hallId: fixture.hallId,
        eventDate: fixture.eventDate,
        shiftCode: 'DINNER',
        managerAccountId: fixture.managerId,
        expectedRevision: 1,
        requestId: randomUUID(),
        acquiredAt: new Date(fixture.now.getTime() + 660_000),
      }),
    ).rejects.toMatchObject({ code: 'SLOT_NOT_AVAILABLE', status: 409 });
    expect(
      (await database.prisma.bookingSlotHold.findUniqueOrThrow({ where: { id: fixture.holdId } }))
        .status,
    ).toBe('ACTIVE');
  });

  async function createAccount(): Promise<string> {
    const id = randomUUID();
    await database.prisma.account.create({
      data: { id, emailNormalized: `${id}@example.com`, displayEmail: `${id}@example.com` },
    });
    return id;
  }

  async function approve(bookingId: string, party: TimelineParty, accountId: string, at: Date) {
    const repository = createPrismaTimelineRepository(database.prisma);
    const current = await repository.getContext(bookingId);
    if (current.currentRevision === null) throw new Error('Expected fixture timeline.');
    return repository.approve({
      bookingId,
      timelineRevisionId: current.currentRevision.revisionId,
      expectedBookingRevision: current.bookingRevision,
      actorAccountId: accountId,
      party,
      requestId: randomUUID(),
      decisionAt: at,
      approvedRevision: approveTimelineRevision(current.currentRevision, party, at),
    });
  }

  async function createFixture() {
    const prisma = database.prisma;
    const [clock] = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    if (clock === undefined) throw new Error('Expected database clock.');
    const now = clock.now;
    const eventDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000)
      .toISOString()
      .slice(0, 10);
    const managerId = await createAccount();
    const coupleId = await createAccount();
    const consultationId = randomUUID();
    const bookingId = randomUUID();
    const hallId = randomUUID();
    const menuPackageId = randomUUID();
    const menuVersionId = randomUUID();
    const timelineRevisionId = randomUUID();
    const holdId = randomUUID();
    const hallName = `Hall ${hallId}`;
    await prisma.hall.create({
      data: {
        id: hallId,
        name: hallName,
        nameNormalized: hallName.toLowerCase(),
        description: 'Booking regression fixture',
        maxGuests: 500,
        displayOrder: 1,
        updatedByAccountId: managerId,
      },
    });
    await prisma.$transaction(async (transaction) => {
      await transaction.menuPackage.create({
        data: {
          id: menuPackageId,
          displayOrder: 1,
          createdByAccountId: managerId,
          updatedByAccountId: managerId,
          versions: {
            create: {
              id: menuVersionId,
              versionNumber: 1,
              state: 'PUBLISHED',
              name: 'Garden menu',
              description: 'Published menu',
              priceVndPerTable: 5_000_000,
              createdByAccountId: managerId,
              publishedAt: now,
            },
          },
        },
      });
      await transaction.menuPackage.update({
        where: { id: menuPackageId },
        data: { currentPublishedVersionId: menuVersionId },
      });
    });
    await prisma.consultation.create({
      data: {
        id: consultationId,
        managerAccountId: managerId,
        intendedEmailNormalized: `${coupleId}@example.com`,
        intendedEmail: `${coupleId}@example.com`,
        displayName: 'Booking regression couple',
        booking: {
          create: {
            id: bookingId,
            hallId,
            eventDate: new Date(`${eventDate}T00:00:00Z`),
            shiftCode: 'DINNER',
            planningHeadcount: 100,
            proposalSnapshot: {
              create: {
                id: randomUUID(),
                hallId,
                hallName,
                hallDescription: 'Booking regression fixture',
                hallMaxGuests: 500,
                shiftCode: 'DINNER',
                shiftStartTime: new Date('1970-01-01T17:30:00Z'),
                shiftEndTime: new Date('1970-01-01T22:00:00Z'),
                menuPackageId,
                menuPackageVersionId: menuVersionId,
                menuVersionNumber: 1,
                menuName: 'Garden menu',
                menuDescription: 'Published menu',
                menuPriceVndPerTable: 5_000_000,
                tableCount: 10,
                planningHeadcount: 100,
                baseChargeVnd: 50_000_000,
                depositAmountVnd: 15_000_000,
              },
            },
          },
        },
      },
    });
    await prisma.consultationAccess.create({
      data: {
        accountId: coupleId,
        consultationId,
        bookingId,
        level: 'RESTRICTED',
        createdAt: now,
      },
    });
    await prisma.bookingTimelineRevision.create({
      data: {
        id: timelineRevisionId,
        bookingId,
        revisionNumber: 1,
        state: 'CURRENT',
        contentHash: 'regression-content',
        createdByAccountId: managerId,
        createdAt: now,
        items: {
          create: {
            id: randomUUID(),
            itemId: randomUUID(),
            displayOrder: 0,
            startTime: new Date('1970-01-01T18:00:00Z'),
            title: 'Welcome',
          },
        },
      },
    });
    await prisma.booking.update({
      where: { id: bookingId },
      data: { currentTimelineRevisionId: timelineRevisionId },
    });
    await approve(bookingId, 'MANAGER', managerId, now);
    const approved = await approve(bookingId, 'COUPLE', coupleId, now);
    await prisma.bookingSlotHold.create({
      data: {
        id: holdId,
        bookingId,
        hallId,
        eventDate: new Date(`${eventDate}T00:00:00Z`),
        shiftCode: 'DINNER',
        expiresAt: new Date(now.getTime() + 600_000),
        acquiredByAccountId: managerId,
        createdAt: now,
      },
    });
    return {
      now,
      eventDate,
      managerId,
      coupleId,
      consultationId,
      bookingId,
      bookingRevision: approved.bookingRevision,
      hallId,
      menuPackageId,
      menuVersionId,
      timelineRevisionId,
      holdId,
    };
  }

  function reserveInput(fixture: Awaited<ReturnType<typeof createFixture>>) {
    return {
      bookingId: fixture.bookingId,
      timelineRevisionId: fixture.timelineRevisionId,
      paymentAttemptId: randomUUID(),
      expectedBookingRevision: fixture.bookingRevision,
      amountVnd: 15_000_000,
      expiresAt: new Date(fixture.now.getTime() + 600_000).toISOString(),
      requestId: randomUUID(),
    };
  }
});
