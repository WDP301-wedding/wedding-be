import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createLayoutService } from '../../src/modules/venue-catalog/application/layout.service.js';

/**
 * Commercial tests need actual tables under the fixed ten-person rule. Keep the
 * older catalog geometries intact: their small table identities are also used
 * by layout-versioning and historical print tests.
 */
export async function ensurePublishedTableLayout(
  prisma: PrismaClient,
  hallId: string,
  actorId: string,
  tableCount: number,
) {
  const versions = await prisma.layoutTemplateVersion.findMany({
    where: {
      state: 'PUBLISHED',
      currentFor: { is: { hallId, lifecycle: 'ACTIVE' } },
    },
    select: { id: true, _count: { select: { geometry: true } } },
  });
  const adequate = versions.find((version) => version._count.geometry >= tableCount);
  if (adequate !== undefined) return adequate.id;

  const hall = await prisma.hall.findUniqueOrThrow({ where: { id: hallId } });
  const templateId = randomUUID();
  const versionId = randomUUID();
  const context = { actorId, requestId: randomUUID() };
  const layouts = createLayoutService(prisma);
  await layouts.createTemplate({
    templateId,
    versionId,
    hallId,
    displayOrder: 100,
    name: `Commercial fixture: ${tableCount} tables`,
    description: 'Ten seats per table, independent of historical catalog fixtures.',
    minGuests: 1,
    maxGuests: Math.min(hall.maxGuests, tableCount * 10),
    tables: Array.from({ length: tableCount }, (_, index) => ({
      tableId: randomUUID(),
      label: `C${index + 1}`,
      shape: 'ROUND' as const,
      seatCapacity: 10,
      x: (index % 25) * 350,
      y: Math.floor(index / 25) * 450,
      width: 250,
      height: 250,
      rotationDegrees: 0,
      displayOrder: index + 1,
    })),
    context,
  });
  await layouts.publish({ templateId, versionId, expectedRevision: 1, context });
  return versionId;
}
