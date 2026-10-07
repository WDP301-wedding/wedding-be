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
