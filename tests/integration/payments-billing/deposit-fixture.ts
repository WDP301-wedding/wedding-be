import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '../../../src/generated/prisma/client.js';
import { CATALOG_SEED_IDS } from '../../../scripts/catalog-seed.js';

let eventDay = 1;

export async function createPayableBooking(prisma: PrismaClient) {
  const accountId = randomUUID();
  const consultationId = randomUUID();
  const bookingId = randomUUID();
  const timelineRevisionId = randomUUID();
  const commercialRevisionId = randomUUID();
  const requestId = randomUUID();
  const managerId = CATALOG_SEED_IDS.actor;
  const hallId = CATALOG_SEED_IDS.lotusHall;
  const eventDate = new Date(Date.UTC(2027, 0, eventDay++));
  const now = new Date();
  await prisma.account.create({
    data: {
      id: accountId,
      emailNormalized: `${accountId}@example.com`,
      displayEmail: `${accountId}@example.com`,
    },
  });
  await prisma.consultation.create({
    data: {
      id: consultationId,
      managerAccountId: managerId,
      intendedEmailNormalized: `${accountId}@example.com`,
      intendedEmail: `${accountId}@example.com`,
      displayName: 'Deposit Couple',
      booking: {
        create: {
          id: bookingId,
          hallId,
          eventDate,
          shiftCode: 'DINNER',
          planningHeadcount: 100,
          proposalSnapshot: {
            create: {
              id: commercialRevisionId,
              hallId,
              hallName: 'Lotus Hall',
              hallDescription: 'Deposit fixture',
              hallMaxGuests: 500,
              shiftCode: 'DINNER',
              shiftStartTime: new Date('1970-01-01T17:30:00Z'),
              shiftEndTime: new Date('1970-01-01T22:00:00Z'),
              menuPackageId: CATALOG_SEED_IDS.classicMenu,
              menuPackageVersionId: CATALOG_SEED_IDS.classicMenuVersion,
              menuVersionNumber: 1,
              menuName: 'Accepted menu',
              menuDescription: 'Accepted commercial snapshot',
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
    data: { accountId, consultationId, bookingId, level: 'RESTRICTED' },
  });
  await prisma.bookingTimelineRevision.create({
    data: {
      id: timelineRevisionId,
      bookingId,
      revisionNumber: 1,
      state: 'CURRENT',
      managerApprovedAt: now,
      coupleApprovedAt: now,
      contentHash: randomUUID(),
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
  await prisma.bookingSlotHold.create({
    data: {
      id: randomUUID(),
      bookingId,
      hallId,
      eventDate,
      shiftCode: 'DINNER',
      expiresAt: new Date(now.getTime() + 15 * 60_000),
      acquiredByAccountId: managerId,
    },
  });
  return {
    accountId,
    consultationId,
    bookingId,
    timelineRevisionId,
    commercialRevisionId,
    command: { bookingId, timelineRevisionId, commandId: randomUUID() },
    context: {
      requestId,
      causationId: randomUUID(),
      actorAccountId: accountId,
      authority: 'AUTHENTICATED' as const,
    },
    system: {
      requestId: randomUUID(),
      causationId: requestId,
      actorAccountId: null,
      authority: 'SYSTEM' as const,
    },
  };
}
