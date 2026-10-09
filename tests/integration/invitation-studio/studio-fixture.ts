import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';
import { createPrismaSessionRepository } from '../../../src/modules/identity-access/session/session.repository.js';
import { issueOpaqueToken } from '../../../src/modules/identity-access/crypto/token.js';
import { createLayoutService } from '../../../src/modules/venue-catalog/application/layout.service.js';
import { createInvitationStudioServices } from '../../../src/modules/invitation-studio/infrastructure/studio.composition.js';
import type { AiImageProvider } from '../../../src/integrations/ai-image/ai-image-provider.js';
import { digest } from '../../../src/modules/invitation-studio/domain/studio-policy.js';
import { controlledStorage } from './controlled-storage.js';

export async function studioFixture(prisma: PrismaClient, ai: AiImageProvider | null = null) {
  const now = new Date();
  const eventDate = new Date(Date.now() + 10 * 86400000);
  eventDate.setUTCHours(0, 0, 0, 0);
  async function actor(
    role: 'COUPLE' | 'MANAGER' | 'STAFF',
    clientKind: 'WEB' | 'ANDROID' = 'WEB',
    accountId?: string,
  ) {
    const account =
      accountId === undefined
        ? await prisma.account.create({
            data: {
              emailNormalized: `${randomUUID()}@example.test`,
              displayEmail: 'fixture@example.test',
              roles: { create: { role } },
            },
          })
        : { id: accountId };
    const access = issueOpaqueToken('access', 32),
      refresh = issueOpaqueToken('refresh', 32);
    const expiry = new Date(now.getTime() + 86400000);
    const session = await createPrismaSessionRepository(prisma).createSession({
      accountId: account.id,
      clientKind,
      accessTokenHash: access.tokenHash,
      refreshTokenHash: refresh.tokenHash,
      now,
      accessExpiresAt: expiry,
      idleExpiresAt: expiry,
      absoluteExpiresAt: expiry,
    });
    return {
      actorId: account.id,
      requestId: randomUUID(),
      accessToken: access.token,
      sessionId: session.sessionId,
    };
  }
  const couple = await actor('COUPLE'),
    manager = await actor('MANAGER'),
    android = await actor('COUPLE', 'ANDROID', couple.actorId);
  const hallId = randomUUID(),
    bookingId = randomUUID(),
    consultationId = randomUUID(),
    timelineId = randomUUID(),
    paymentId = randomUUID();
  await prisma.hall.create({
    data: {
      id: hallId,
      name: `Hall ${hallId}`,
      nameNormalized: `hall ${hallId}`,
      description: '',
      maxGuests: 100,
      displayOrder: 0,
      updatedByAccountId: manager.actorId,
    },
  });
  const layout = createLayoutService(prisma),
    templateId = randomUUID(),
    layoutId = randomUUID();
  const tables = [
    {
      tableId: randomUUID(),
      label: 'T1',
      shape: 'ROUND' as const,
      seatCapacity: 40,
      x: 0,
      y: 0,
      width: 500,
      height: 500,
      rotationDegrees: 0,
      displayOrder: 1,
    },
  ];
  const ownerContext = { actorId: manager.actorId, requestId: manager.requestId };
  await layout.createTemplate({
    templateId,
    versionId: layoutId,
    hallId,
    displayOrder: 0,
    name: 'Approved layout',
    description: '',
    minGuests: 10,
    maxGuests: 30,
    tables,
    context: ownerContext,
  });
  await layout.publish({
    templateId,
    versionId: layoutId,
    expectedRevision: 1,
    context: ownerContext,
  });
  await prisma.booking.create({
    data: {
      id: bookingId,
      consultationId,
      hallId,
      shiftCode: 'LUNCH',
      eventDate,
      planningHeadcount: 20,
    },
  });
  await prisma.bookingTimelineRevision.create({
    data: {
      id: timelineId,
      bookingId,
      revisionNumber: 1,
      eventDate,
      hallName: 'Approved hall',
      shiftCode: 'LUNCH',
      shiftStartTime: '11:00',
      shiftEndTime: '14:00',
      items: [
        { itemId: randomUUID(), order: 0, startTime: '11:00', title: 'Welcome', description: null },
      ],
      approvedByManagerAt: now,
      approvedByCoupleAt: now,
    },
  });
  await prisma.depositSettlement.create({
    data: {
      paymentId,
      bookingId,
      amountVnd: 1000000,
      settledAt: now,
      evidenceReference: 'native-reader-fixture-only',
    },
  });
  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      phase: 'CONFIRMED',
      effectiveTimelineRevisionId: timelineId,
      confirmedPaymentId: paymentId,
      confirmedAt: now,
    },
  });
  await prisma.consultationAccess.create({
    data: {
      accountId: couple.actorId,
      consultationId,
      bookingId,
      level: 'FULL',
      sourcePaymentId: paymentId,
      promotedAt: now,
    },
  });
  const storage = controlledStorage(),
    services = createInvitationStudioServices(
      prisma,
      storage.provider,
      ai,
      'https://wedding.example.test',
      () => now,
    );
  const bytes = await sharp({ create: { width: 5, height: 4, channels: 3, background: '#abcdef' } })
    .png()
    .toBuffer();
  const content = {
    title: 'Our wedding',
    textFields: { greeting: 'Mời bạn' },
    sections: [{ kind: 'HERO' as const, textKey: 'greeting' as const, derivedAssetId: null }],
    derivedAssetIds: [] as string[],
    includesSeating: false,
  };
  const contract = {
    requestId: couple.requestId,
    causationId: couple.requestId,
    actorAccountId: couple.actorId,
    authority: 'AUTHENTICATED' as const,
  };
  const renderSnapshot = tables.map((t) => ({
    layoutTableId: t.tableId,
    tableLabel: t.label,
    shape: t.shape,
    x: t.x,
    y: t.y,
    width: t.width,
    height: t.height,
    rotationDegrees: t.rotationDegrees,
    guestGroupId: null,
    guestGroupName: null,
    color: null,
  }));
  const registry = {
    bookingId,
    seatingPlanRevisionId: randomUUID(),
    seatingPlanRevisionNumber: 1,
    layoutTemplateVersionId: layoutId,
    contentDigest: digest(renderSnapshot),
    renderSnapshot,
    validityProof: {
      bookingRevision: 1,
      expectedAttendees: 20,
      minGuests: 10,
      maxGuests: 30,
      totalSeatCapacity: 40,
      managerException: null,
    },
  };
  return {
    prisma,
    services,
    storage,
    bytes,
    now,
    actor,
    couple,
    manager,
    android,
    bookingId,
    consultationId,
    timelineId,
    hallId,
    layoutId,
    templateId,
    layout,
    ownerContext,
    content,
    contract,
    registry,
  };
}
