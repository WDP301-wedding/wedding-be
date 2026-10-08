import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config } from '../src/config/config.js';
import { createPrismaClient } from '../src/core/database/prisma.js';
import { hashPassword } from '../src/modules/identity-access/crypto/password.js';
import { CATALOG_SEED_IDS as catalog, seedVenueCatalog } from './catalog-seed.js';

const url = new URL(config.database.url ?? '');
if (
  url.hostname !== '127.0.0.1' ||
  url.port !== '55435' ||
  url.pathname !== '/wedding_local_demo'
) {
  throw new Error('Demo seed only accepts the dedicated local demo database.');
}
const managerEmail = z.email().parse(process.env.DEMO_MANAGER_EMAIL).trim().toLowerCase();
const coupleEmail = z.email().parse(process.env.DEMO_COUPLE_EMAIL).trim().toLowerCase();
if (managerEmail === coupleEmail)
  throw new Error('Manager and Couple need distinct email addresses.');
const passwordSchema = z.string().min(12).max(128);
const managerPassword = passwordSchema.parse(process.env.DEMO_MANAGER_PASSWORD);
const couplePassword = passwordSchema.parse(process.env.DEMO_COUPLE_PASSWORD);
const prisma = createPrismaClient();
const coupleId = '30000000-0000-4000-8000-000000000001';
const confirmedConsultationId = '30000000-0000-4000-8000-000000000010';
const confirmedBookingId = '30000000-0000-4000-8000-000000000011';
const draftConsultationId = '30000000-0000-4000-8000-000000000020';
const draftBookingId = '30000000-0000-4000-8000-000000000021';
const timelineId = '30000000-0000-4000-8000-000000000030';
const paymentId = '30000000-0000-4000-8000-000000000040';
const now = new Date();
try {
  await seedVenueCatalog(prisma);
  await prisma.$transaction(
    async (tx) => {
      for (const [id, email, password, role, displayName] of [
        [catalog.actor, managerEmail, managerPassword, 'MANAGER', 'Quản lý Wedding Estate'],
        [coupleId, coupleEmail, couplePassword, 'COUPLE', 'Lan và Minh'],
      ] as const) {
        const existing = await tx.account.findUnique({ where: { id } });
        if (existing) {
          if (existing.emailNormalized !== email)
            throw new Error(
              'Existing demo account differs from .env.demo; edit its email explicitly before reseeding.',
            );
          continue;
        }
        const verifier = await hashPassword(password, config.identityAccess.password);
        await tx.account.create({
          data: {
            id,
            emailNormalized: email,
            displayEmail: email,
            displayName,
            roles: { create: { role } },
            passwordCredential: {
              create: {
                algorithm: verifier.algorithm,
                version: verifier.version,
                ...verifier.parameters,
                saltEncoded: verifier.saltEncoded,
                derivedKeyEncoded: verifier.derivedKeyEncoded,
              },
            },
          },
        });
      }
      if (await tx.booking.findUnique({ where: { id: confirmedBookingId } })) return;
      const hall = await tx.hall.findUniqueOrThrow({ where: { id: catalog.lotusHall } });
      const menu = await tx.menuPackageVersion.findUniqueOrThrow({
        where: { id: catalog.classicMenuVersion },
      });
      const dinner = await tx.restaurantShift.findUniqueOrThrow({ where: { code: 'DINNER' } });
      const futureDate = (days: number) => {
        const value = new Date(now);
        value.setUTCDate(value.getUTCDate() + days);
        return new Date(value.toISOString().slice(0, 10));
      };
      for (const [consultationId, bookingId, days, confirmed] of [
        [confirmedConsultationId, confirmedBookingId, 90, true],
        [draftConsultationId, draftBookingId, 120, false],
      ] as const) {
        await tx.consultation.create({
          data: {
            id: consultationId,
            managerAccountId: catalog.actor,
            intendedEmail: coupleEmail,
            intendedEmailNormalized: coupleEmail,
            displayName: confirmed
              ? 'Lan & Minh — lễ cưới chính'
              : 'Lan & Minh — đề xuất tiệc gia đình',
            note: 'Dữ liệu demo SPEC-01 đến SPEC-03.',
          },
        });
        await tx.booking.create({
          data: {
            id: bookingId,
            consultationId,
            hallId: hall.id,
            eventDate: futureDate(days),
            shiftCode: 'DINNER',
            planningHeadcount: 180,
            proposalSnapshot: {
              create: {
                hallId: hall.id,
                hallName: hall.name,
                hallDescription: hall.description,
                hallMaxGuests: hall.maxGuests,
                shiftCode: dinner.code,
                shiftStartTime: dinner.startTime,
                shiftEndTime: dinner.endTime,
                menuPackageId: catalog.classicMenu,
                menuPackageVersionId: menu.id,
                menuVersionNumber: menu.versionNumber ?? 1,
                menuName: menu.name,
                menuDescription: menu.description,
                menuPriceVndPerTable: menu.priceVndPerTable,
                tableCount: 18,
                planningHeadcount: 180,
                baseChargeVnd: 63_000_000,
                depositAmountVnd: 18_900_000,
                ...(confirmed
                  ? { commercialRevisionId: randomUUID(), commercialAcceptedAt: now }
                  : {}),
              },
            },
          },
        });
        await tx.consultationAccess.create({
          data: {
            accountId: coupleId,
            consultationId,
            level: confirmed ? 'FULL' : 'RESTRICTED',
            ...(confirmed ? { bookingId, promotedAt: now, sourcePaymentId: paymentId } : {}),
          },
        });
      }
      const items = [
        {
          itemId: randomUUID(),
          displayOrder: 1,
          startTime: '17:00',
          title: 'Đón khách',
          description: 'Chụp ảnh và hướng dẫn khách vào sảnh.',
        },
        {
          itemId: randomUUID(),
          displayOrder: 2,
          startTime: '18:00',
          title: 'Nghi thức thành hôn',
          description: 'Trao nhẫn và lời cảm ơn hai gia đình.',
        },
        {
          itemId: randomUUID(),
          displayOrder: 3,
          startTime: '18:30',
          title: 'Khai tiệc',
          description: 'Phục vụ thực đơn và giao lưu cùng khách.',
        },
      ];
      await tx.bookingTimelineRevision.create({
        data: {
          id: timelineId,
          bookingId: confirmedBookingId,
          revisionNumber: 1,
          state: 'EFFECTIVE',
          managerApprovedAt: now,
          coupleApprovedAt: now,
          contentHash: createHash('sha256').update(JSON.stringify(items)).digest('hex'),
          createdByAccountId: catalog.actor,
          createdAt: now,
          items: {
            create: items.map((item) => ({
              ...item,
              id: randomUUID(),
              startTime: new Date(`1970-01-01T${item.startTime}:00Z`),
            })),
          },
          decisions: {
            create: [
              {
                id: randomUUID(),
                party: 'MANAGER',
                decision: 'APPROVED',
                sequence: 1,
                actorAccountId: catalog.actor,
                requestId: randomUUID(),
                occurredAt: now,
              },
              {
                id: randomUUID(),
                party: 'COUPLE',
                decision: 'APPROVED',
                sequence: 1,
                actorAccountId: coupleId,
                requestId: randomUUID(),
                occurredAt: now,
              },
            ],
          },
        },
      });
      await tx.booking.update({
        where: { id: confirmedBookingId },
        data: {
          phase: 'CONFIRMED',
          revision: 3,
          currentTimelineRevisionId: timelineId,
          effectiveTimelineRevisionId: timelineId,
        },
      });
      await tx.bookingDepositSettlement.create({
        data: {
          paymentId,
          bookingId: confirmedBookingId,
          timelineRevisionId: timelineId,
          amountVnd: 18_900_000,
          settledAt: now,
          promotionStatus: 'SUCCEEDED',
          promotedAt: now,
        },
      });
      await tx.bookingDepositIntent.create({
        data: {
          id: paymentId,
          bookingId: confirmedBookingId,
          timelineRevisionId: timelineId,
          amountVnd: 18_900_000,
          status: 'SETTLED',
          bookingRevisionReserved: 2,
          coupleAccountId: coupleId,
          requestId: randomUUID(),
          expiresAt: new Date(now.getTime() + 3600_000),
          settledAt: now,
          providerEvidenceId: 'local-demo-spec03-fixture',
        },
      });
      await tx.consultationRequest.create({
        data: {
          submissionId: randomUUID(),
          payloadHash: createHash('sha256').update('local-demo-intake').digest('hex'),
          displayName: 'Hà & Nam',
          email: coupleEmail,
          phone: '0901234567',
          preferredDate: futureDate(150),
          expectedGuests: 120,
          message: 'Muốn tư vấn sảnh cho tiệc 120 khách. Đây là yêu cầu mẫu để demo.',
        },
      });
      await tx.auditLog.create({
        data: {
          requestId: randomUUID(),
          actorType: 'SYSTEM',
          action: 'demo.spec01-03.seeded',
          entityType: 'demo',
          metadata: { consultations: 2, confirmedBookings: 1, draftBookings: 1 },
        },
      });
    },
    { timeout: 20_000 },
  );
  console.log(
    'Demo: 2 accounts, 2 halls, 2 menus, 2 consultations/bookings, 1 approved timeline, 1 intake request. No future-SPEC datasets.',
  );
} finally {
  await prisma.$disconnect();
}
