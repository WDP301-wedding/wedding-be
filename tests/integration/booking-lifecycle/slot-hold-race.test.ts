import 'dotenv/config';

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../../../src/core/database/prisma.js';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';
import { createPrismaSlotHoldRepository } from '../../../src/modules/booking-lifecycle/infrastructure/slot-hold.repository.js';
import { createPrismaBookingDepositRepository } from '../../../src/modules/booking-lifecycle/infrastructure/deposit.repository.js';
import { createPrismaTimelineRepository } from '../../../src/modules/booking-lifecycle/infrastructure/timeline.repository.js';
import { createPrismaBookingReportingReader } from '../../../src/modules/booking-lifecycle/infrastructure/reporting.repository.js';
import { createPrismaBookingAutomationRepository } from '../../../src/modules/booking-lifecycle/infrastructure/automation.repository.js';
import { createBookingDepositService } from '../../../src/modules/booking-lifecycle/application/deposit.service.js';
import { createPrismaConsultationRetentionRecorder } from '../../../src/modules/identity-access/account/retention-eligibility.port.js';
import { createTimelineService } from '../../../src/modules/booking-lifecycle/application/timeline.service.js';
import {
  createCoupleAccessPromoter,
  createPrismaCoupleAccessPromotionRepository,
} from '../../../src/modules/identity-access/authorization/couple-access-promotion.js';
import {
  createConsultationAccessReader,
  createPrismaConsultationAccessRepository,
} from '../../../src/modules/identity-access/authorization/authorization.service.js';

const execFileAsync = promisify(execFile);
const migrationDatabaseUrl = process.env.TEST_MIGRATION_DATABASE_URL?.trim();
const describeWithDatabase = migrationDatabaseUrl ? describe : describe.skip;
const schemaName = `booking_slot_${randomUUID().replaceAll('-', '')}`;
const admin = new Client({ connectionString: migrationDatabaseUrl });
let prisma: PrismaClient | undefined;
let adminConnected = false;
let schemaCreated = false;

describeWithDatabase('booking slot hold PostgreSQL serialization', () => {
  beforeAll(async () => {
    await admin.connect();
    adminConnected = true;
    await admin.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
    schemaCreated = true;
    await deployMigrations(withSchema(migrationDatabaseUrl!, schemaName));
    prisma = createPrismaClient(withSchema(migrationDatabaseUrl!, schemaName));
    await prisma.$connect();
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    if (adminConnected) {
      if (schemaCreated)
        await admin.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`);
      await admin.end();
    }
  });

  it('selects exactly one winner for concurrent bookings of the same slot', async () => {
    const database = requiredPrisma();
    const managerId = randomUUID();
    const hallId = randomUUID();
    const consultationIds = [randomUUID(), randomUUID()] as const;
    const bookingIds = [randomUUID(), randomUUID()] as const;
    const eventDate = new Date('2026-12-20T00:00:00.000Z');
    await database.hall.create({
      data: {
        id: hallId,
        name: 'Garden Hall',
        nameNormalized: 'garden hall',
        description: 'Race fixture',
        maxGuests: 500,
        displayOrder: 1,
        updatedByAccountId: managerId,
      },
    });
    for (const [index, consultationId] of consultationIds.entries()) {
      await database.consultation.create({
        data: {
          id: consultationId,
          managerAccountId: managerId,
          intendedEmailNormalized: `couple${String(index)}@example.com`,
          intendedEmail: `couple${String(index)}@example.com`,
          displayName: `Couple ${String(index)}`,
          booking: {
            create: {
              id: bookingIds[index]!,
              hallId,
              eventDate,
              shiftCode: 'DINNER',
              planningHeadcount: 100,
            },
          },
        },
      });
    }

    const repository = createPrismaSlotHoldRepository(database);
    const acquiredAt = new Date('2026-10-07T12:00:00.000Z');
    const attempts = bookingIds.map((bookingId) =>
      repository.acquire({
        bookingId,
        holdId: randomUUID(),
        hallId,
        eventDate: '2026-12-20',
        shiftCode: 'DINNER',
        managerAccountId: managerId,
        expectedRevision: 1,
        requestId: randomUUID(),
        acquiredAt,
      }),
    );
    const outcomes = await Promise.allSettled(attempts);

    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejection = outcomes.find(({ status }) => status === 'rejected');
    expect(rejection).toMatchObject({ reason: { code: 'SLOT_NOT_AVAILABLE', status: 409 } });
    await expect(
      database.bookingSlotHold.count({ where: { status: 'ACTIVE', hallId } }),
    ).resolves.toBe(1);
    const bookings = await database.booking.findMany({
      where: { id: { in: [...bookingIds] } },
      orderBy: { id: 'asc' },
      select: { revision: true },
    });
    expect(bookings.map(({ revision }) => revision).sort()).toEqual([1, 2]);
  });

  it('serializes deposit reservation against an invalidating timeline successor', async () => {
    const database = requiredPrisma();
    const now = new Date('2026-10-07T12:00:00.000Z');
    const managerId = randomUUID();
    const coupleId = randomUUID();
    const consultationId = randomUUID();
    const bookingId = randomUUID();
    const hallId = randomUUID();
    const menuPackageId = randomUUID();
    const menuVersionId = randomUUID();
    const timelineRevisionId = randomUUID();
    const holdId = randomUUID();
    await database.account.create({
      data: {
        id: coupleId,
        emailNormalized: `${coupleId}@example.com`,
        displayEmail: `${coupleId}@example.com`,
      },
    });
    const hallName = `Hall ${hallId}`;
    await database.hall.create({
      data: {
        id: hallId,
        name: hallName,
        nameNormalized: hallName.toLowerCase(),
        description: 'Deposit race fixture',
        maxGuests: 500,
        displayOrder: 2,
        updatedByAccountId: managerId,
      },
    });
    await database.$transaction(async (transaction) => {
      await transaction.menuPackage.create({
        data: {
          id: menuPackageId,
          displayOrder: 1,
          createdByAccountId: managerId,
          updatedByAccountId: managerId,
        },
      });
      await transaction.menuPackageVersion.create({
        data: {
          id: menuVersionId,
          menuPackageId,
          versionNumber: 1,
          state: 'PUBLISHED',
          name: 'Garden menu',
          description: 'Published menu',
          priceVndPerTable: 5_000_000,
          createdByAccountId: managerId,
          publishedAt: now,
        },
      });
      await transaction.menuPackage.update({
        where: { id: menuPackageId },
        data: { currentPublishedVersionId: menuVersionId },
      });
    });
    await database.consultation.create({
      data: {
        id: consultationId,
        managerAccountId: managerId,
        intendedEmailNormalized: `${coupleId}@example.com`,
        intendedEmail: `${coupleId}@example.com`,
        displayName: 'Deposit Couple',
        booking: {
          create: {
            id: bookingId,
            hallId,
            eventDate: new Date('2026-12-20T00:00:00.000Z'),
            shiftCode: 'DINNER',
            planningHeadcount: 100,
            proposalSnapshot: {
              create: {
                id: randomUUID(),
                hallId,
                hallName: 'Garden Hall',
                hallDescription: 'Deposit race fixture',
                hallMaxGuests: 500,
                shiftCode: 'DINNER',
                shiftStartTime: new Date('1970-01-01T17:30:00.000Z'),
                shiftEndTime: new Date('1970-01-01T22:00:00.000Z'),
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
    await database.consultationAccess.create({
      data: {
        accountId: coupleId,
        consultationId,
        bookingId,
        level: 'RESTRICTED',
      },
    });
    await database.bookingTimelineRevision.create({
      data: {
        id: timelineRevisionId,
        bookingId,
        revisionNumber: 1,
        state: 'CURRENT',
        managerApprovedAt: now,
        coupleApprovedAt: now,
        contentHash: 'approved-content',
        createdByAccountId: managerId,
        createdAt: now,
        items: {
          create: {
            id: randomUUID(),
            itemId: randomUUID(),
            displayOrder: 0,
            startTime: new Date('1970-01-01T18:00:00.000Z'),
            title: 'Welcome',
          },
        },
      },
    });
    await database.booking.update({
      where: { id: bookingId },
      data: { currentTimelineRevisionId: timelineRevisionId },
    });
    await database.bookingSlotHold.create({
      data: {
        id: holdId,
        bookingId,
        hallId,
        eventDate: new Date('2026-12-20T00:00:00.000Z'),
        shiftCode: 'DINNER',
        expiresAt: new Date('2026-10-07T12:15:00.000Z'),
        acquiredByAccountId: managerId,
        createdAt: now,
      },
    });

    const deposits = createPrismaBookingDepositRepository(database, () => now);
    const timelines = createPrismaTimelineRepository(database);
    const successorId = randomUUID();
    const outcomes = await Promise.allSettled([
      deposits.reserve({
        bookingId,
        timelineRevisionId,
        paymentAttemptId: randomUUID(),
        expectedBookingRevision: 1,
        amountVnd: 15_000_000,
        expiresAt: '2026-10-07T12:10:00.000Z',
        requestId: randomUUID(),
        actorAccountId: coupleId,
      }),
      timelines.save({
        revision: {
          revisionId: successorId,
          bookingId,
          revisionNumber: 2,
          state: 'CURRENT',
          predecessorRevisionId: timelineRevisionId,
          items: [
            {
              itemId: randomUUID(),
              order: 0,
              startTime: '18:15',
              title: 'Updated welcome',
              description: null,
            },
          ],
          managerApprovedAt: null,
          coupleApprovedAt: null,
          mutuallyApproved: false,
          createdAt: now,
        },
        expectedBookingRevision: 1,
        actorAccountId: managerId,
        party: 'MANAGER',
        requestId: randomUUID(),
      }),
    ]);

    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const booking = await database.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { phase: true, revision: true, currentTimelineRevisionId: true },
    });
    const unresolved = await database.bookingDepositIntent.count({
      where: { bookingId, status: { in: ['ACTIVE', 'UNKNOWN'] } },
    });
    const successorCount = await database.bookingTimelineRevision.count({
      where: { id: successorId },
    });
    expect(booking.revision).toBe(2);
    expect([unresolved, successorCount].sort()).toEqual([0, 1]);
    expect(
      booking.phase === 'AWAITING_DEPOSIT'
        ? booking.currentTimelineRevisionId === timelineRevisionId
        : booking.currentTimelineRevisionId === successorId,
    ).toBe(true);
  });

  it('settles once with real identity promotion, keeps the slot occupied, and completes once under concurrent worker replay', async () => {
    const database = requiredPrisma();
    const now = new Date('2026-10-07T12:00:00.000Z');
    const booking = await database.booking.findFirstOrThrow({
      where: { proposalSnapshot: { isNot: null } },
      include: { consultation: true },
    });
    const grant = await database.consultationAccess.findFirstOrThrow({
      where: { consultationId: booking.consultationId },
    });
    const access = createConsultationAccessReader(
      createPrismaConsultationAccessRepository(database),
    );
    const timelines = createTimelineService({
      repository: createPrismaTimelineRepository(database),
      access,
      now: () => now,
    });
    const manager = {
      accountId: booking.consultation.managerAccountId,
      roles: ['MANAGER'] as const,
    };
    const couple = { accountId: grant.accountId, roles: ['COUPLE'] as const };
    for (const actor of [manager, couple]) {
      const current = await database.booking.findUniqueOrThrow({ where: { id: booking.id } });
      await timelines.approve({
        bookingId: booking.id,
        timelineRevisionId: current.currentTimelineRevisionId!,
        expectedBookingRevision: current.revision,
        actor,
        requestId: randomUUID(),
      });
    }
    const current = await database.booking.findUniqueOrThrow({ where: { id: booking.id } });
    const repository = createPrismaBookingDepositRepository(database, () => now);
    const deposits = createBookingDepositService({
      repository,
      promoter: createCoupleAccessPromoter(createPrismaCoupleAccessPromotionRepository(database)),
    });
    const context = {
      actorAccountId: couple.accountId,
      authority: 'AUTHENTICATED' as const,
      requestId: randomUUID(),
      causationId: randomUUID(),
    };
    if (current.phase === 'DRAFT') {
      await deposits.reserve(
        {
          bookingId: current.id,
          timelineRevisionId: current.currentTimelineRevisionId!,
          paymentAttemptId: randomUUID(),
          expectedBookingRevision: current.revision,
          amountVnd: 15_000_000,
          expiresAt: '2026-10-07T12:10:00.000Z',
        },
        context,
      );
    }
    const evidence = {
      bookingId: current.id,
      timelineRevisionId: current.currentTimelineRevisionId!,
      paymentId: randomUUID(),
      amountVnd: 15_000_000,
      settledAt: now,
    };
    await expect(deposits.recordSuccessfulDeposit(evidence)).resolves.toEqual({
      phase: 'CONFIRMED',
      replayed: false,
    });
    await expect(deposits.recordSuccessfulDeposit(evidence)).resolves.toEqual({
      phase: 'CONFIRMED',
      replayed: true,
    });
    expect(
      await database.bookingDepositSettlement.count({ where: { bookingId: current.id } }),
    ).toBe(1);
    const fullGrant = await access.requireAccess({
      accountId: couple.accountId,
      consultationId: booking.consultationId,
      minimum: 'FULL',
    });
    expect(fullGrant.level).toBe('FULL');
    const slots = createPrismaSlotHoldRepository(database);
    await expect(
      slots.inspect({
        hallId: current.hallId,
        eventDate: '2026-12-20',
        shiftCode: 'DINNER',
        databaseNow: now,
      }),
    ).resolves.toEqual({ available: false, activeHold: null });
    const confirmed = await database.booking.findUniqueOrThrow({ where: { id: current.id } });
    const failedWorker = createPrismaBookingAutomationRepository(
      database,
      () => new Date('2026-12-21T03:00:00.000Z'),
      () => Promise.reject(new Error('identity retention unavailable')),
    );
    await expect(
      failedWorker.completeDue(
        {
          bookingId: confirmed.id,
          expectedBookingRevision: confirmed.revision,
          commandId: randomUUID(),
          now: '2026-12-21T03:00:00.000Z',
        },
        { ...context, authority: 'SYSTEM', actorAccountId: null },
      ),
    ).rejects.toThrow('identity retention unavailable');
    expect(await database.booking.findUniqueOrThrow({ where: { id: current.id } })).toMatchObject({
      phase: 'CONFIRMED',
      revision: confirmed.revision,
    });
    expect(
      await database.bookingOutboxEvent.count({
        where: { aggregateId: current.id, eventType: 'booking.completed' },
      }),
    ).toBe(0);
    expect(
      await database.accountRetentionEligibilityFact.count({
        where: { sourceBusinessRecordId: current.id },
      }),
    ).toBe(0);
    const worker = createPrismaBookingAutomationRepository(
      database,
      () => new Date('2026-12-21T03:00:00.000Z'),
      (transaction, input, mutationContext) =>
        createPrismaConsultationRetentionRecorder(transaction, 365).recordTerminal(
          {
            consultationId: input.consultationId,
            sourceBusinessRecordId: input.bookingId,
            eligibleAfter: input.eligibleAfter,
          },
          mutationContext,
        ),
    );
    const due = await worker.listDue(
      { kind: 'COMPLETION', dueBefore: '2026-12-22T00:00:00.000Z', limit: 100 },
      { ...context, authority: 'SYSTEM', actorAccountId: null },
    );
    expect(due.items).toContainEqual(
      expect.objectContaining({ bookingId: current.id, coupleAccountId: couple.accountId }),
    );
    const command = {
      bookingId: confirmed.id,
      expectedBookingRevision: confirmed.revision,
      commandId: randomUUID(),
      now: '2026-12-21T03:00:00.000Z',
    };
    const system = { ...context, authority: 'SYSTEM' as const, actorAccountId: null };
    const outcomes = await Promise.all([
      worker.completeDue(command, system),
      worker.completeDue(command, system),
    ]);
    expect(outcomes.map((row) => row.outcome).sort()).toEqual(['COMPLETED', 'REPLAYED']);
    expect(
      await database.accountRetentionEligibilityFact.findUniqueOrThrow({
        where: {
          accountId_sourceBusinessRecordId: {
            accountId: couple.accountId,
            sourceBusinessRecordId: current.id,
          },
        },
      }),
    ).toMatchObject({
      consultationId: booking.consultationId,
      eligibleAfter: new Date('2026-12-21T03:00:00.000Z'),
    });
    expect(
      await database.bookingOutboxEvent.count({
        where: { aggregateId: current.id, eventType: 'booking.completed' },
      }),
    ).toBe(1);
  });

  it('keeps historical report pages fenced while later state changes commit', async () => {
    const database = requiredPrisma();
    const managerId = randomUUID();
    await database.account.create({
      data: {
        id: managerId,
        emailNormalized: `${managerId}@example.com`,
        displayEmail: `${managerId}@example.com`,
        roles: { create: { role: 'MANAGER' } },
      },
    });
    const context = {
      actorAccountId: managerId,
      authority: 'AUTHENTICATED' as const,
      requestId: randomUUID(),
      causationId: randomUUID(),
    };
    const reader = createPrismaBookingReportingReader(database);
    const first = await reader.readPage({ afterSequence: 0, limit: 1 }, context);
    expect(first.rows).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const bookingId = first.rows[0]!.recordId;
    await database.booking.update({
      where: { id: bookingId },
      data: { phase: 'CANCELLED', revision: { increment: 1 }, cancelledAt: new Date() },
    });
    const historical = await reader.readPage(
      {
        afterSequence: 0,
        throughSequence: first.throughSequence,
        cursor: first.nextCursor!,
        limit: 500,
      },
      context,
    );
    expect(historical.rows.every((row) => row.sequence <= first.throughSequence)).toBe(true);
    expect(historical.rows.every((row) => row.value.phase !== 'CANCELLED')).toBe(true);
    const catchup = await reader.readPage(
      { afterSequence: first.throughSequence, limit: 500 },
      context,
    );
    expect(catchup.rows).toHaveLength(1);
    expect(catchup.rows[0]?.recordId).toBe(bookingId);
    expect(catchup.rows[0]?.value.phase).toBe('CANCELLED');
    expect(JSON.stringify(catchup)).not.toMatch(/example\.com|tokenHash|displayEmail/iu);
    await expect(
      reader.readPage(
        {
          afterSequence: 0,
          cursor: first.nextCursor!,
          throughSequence: catchup.throughSequence,
          limit: 1,
        },
        context,
      ),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      reader.readPage(
        { afterSequence: 0, limit: 1 },
        { ...context, actorAccountId: null, authority: 'SYSTEM' },
      ),
    ).rejects.toMatchObject({ status: 403 });
    const before = catchup.throughSequence;
    await expect(
      database.$transaction(async (tx) => {
        await tx.booking.update({ where: { id: bookingId }, data: { revision: { increment: 1 } } });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect((await reader.readPage({ afterSequence: before, limit: 1 }, context)).rows).toHaveLength(
      0,
    );
  });
});

function requiredPrisma(): PrismaClient {
  if (prisma === undefined) throw new Error('The booking test database is not ready.');
  return prisma;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function withSchema(databaseUrl: string, schema: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('schema', schema);
  url.searchParams.set('options', `-c search_path=${schema}`);
  return url.toString();
}

async function deployMigrations(databaseUrl: string): Promise<void> {
  const prismaCliPath = join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
  await execFileAsync(
    process.execPath,
    [prismaCliPath, 'migrate', 'deploy', '--config', 'prisma.config.ts'],
    {
      cwd: process.cwd(),
      env: { ...process.env, MIGRATION_DATABASE_URL: databaseUrl },
      maxBuffer: 1024 * 1024,
    },
  );
}
