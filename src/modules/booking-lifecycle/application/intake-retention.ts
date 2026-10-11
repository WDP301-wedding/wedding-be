import type { PrismaClient } from '../../../generated/prisma/client.js';
import { randomUUID } from 'node:crypto';

export async function purgeConsultationIntake(
  prisma: PrismaClient,
  now = new Date(),
  options: { batchSize?: number; requestId?: string; operatorId?: string } = {},
) {
  const batchSize = options.batchSize ?? 100;
  if (
    !Number.isSafeInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 1000 ||
    !Number.isFinite(now.getTime())
  )
    throw new RangeError('Invalid retention batch.');
  const cutoff = new Date(now.getTime() - 180 * 86400_000);
  return prisma.$transaction(async (tx) => {
    const rows = await tx.consultationRequest.findMany({
      where: {
        createdAt: { lte: cutoff },
        OR: [{ status: { not: 'CONVERTED' } }, { email: { not: '' } }],
      },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: { id: true, status: true },
    });
    let deleted = 0,
      scrubbed = 0;
    for (const row of rows) {
      if (row.status === 'CONVERTED') {
        scrubbed += (
          await tx.consultationRequest.updateMany({
            where: {
              id: row.id,
              status: 'CONVERTED',
              createdAt: { lte: cutoff },
              email: { not: '' },
            },
            data: {
              displayName: '',
              brideName: null,
              groomName: null,
              email: '',
              phone: '',
              message: '',
              payloadHash: '',
              preferredDate: null,
              expectedGuests: null,
            },
          })
        ).count;
      } else {
        deleted += (
          await tx.consultationRequest.deleteMany({
            where: { id: row.id, status: { not: 'CONVERTED' }, createdAt: { lte: cutoff } },
          })
        ).count;
      }
    }
    if (deleted || scrubbed || options.operatorId !== undefined)
      await tx.auditLog.create({
        data: {
          requestId: options.requestId ?? randomUUID(),
          actorType: 'SYSTEM',
          action: 'booking.intake-retention',
          entityType: 'consultation-request',
          metadata: {
            deleted,
            scrubbed,
            ...(options.operatorId === undefined
              ? {}
              : { operatorId: options.operatorId, batchSize }),
          },
        },
      });
    return { deleted, scrubbed };
  });
}
