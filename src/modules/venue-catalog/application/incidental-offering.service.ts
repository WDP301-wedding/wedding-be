import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { NotFoundError } from '../../../core/errors/app-error.js';
import type { CatalogMutationContext } from '../infrastructure/catalog-version.repository.js';
import {
  createIncidentalOfferingSchema,
  reviseIncidentalOfferingSchema,
} from '../domain/incidental-offering.js';
import { offeringConflict } from './restaurant-service.service.js';

export function createIncidentalOfferingService(prisma: PrismaClient) {
  const view = (row: Awaited<ReturnType<typeof prisma.incidentalOffering.findUniqueOrThrow>>) => {
    const { id, unitPriceVnd, ...rest } = row;
    return { ...rest, offeringId: id, unitPriceVnd: unitPriceVnd.toNumber() };
  };
  return {
    async list(includeArchived = false, cursor?: string, limit = 20) {
      const rows = await prisma.incidentalOffering.findMany({
        where: {
          ...(includeArchived ? {} : { active: true }),
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: limit + 1,
      });
      return {
        items: rows.slice(0, limit).map(view),
        nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
      };
    },
    async create(raw: unknown, context: CatalogMutationContext) {
      const input = createIncidentalOfferingSchema.parse(raw);
      return prisma.$transaction(async (tx) => {
        const restaurant = await tx.restaurantProfile.findUniqueOrThrow({
          where: { singletonKey: 'RESTAURANT' },
        });
        await tx.$queryRaw`SELECT "id" FROM "RestaurantProfile" WHERE "id" = ${restaurant.id}::uuid FOR UPDATE`;
        if ((await tx.incidentalOffering.count({ where: { restaurantId: restaurant.id } })) >= 200)
          throw offeringConflict('INCIDENTAL_CATALOG_LIMIT');
        const row = await tx.incidentalOffering.create({
          data: { id: randomUUID(), restaurantId: restaurant.id, ...input },
        });
        await tx.auditLog.create({
          data: {
            requestId: context.requestId,
            actorType: 'USER',
            actorId: context.actorId,
            action: 'venue.incidental-created',
            entityType: 'incidental-offering',
            entityId: row.id,
            metadata: { after: view(row) },
          },
        });
        return view(row);
      });
    },
    async revise(id: string, raw: unknown, context: CatalogMutationContext) {
      const { expectedRevision, ...input } = reviseIncidentalOfferingSchema.parse(raw);
      return prisma.$transaction(async (tx) => {
        const before = await tx.incidentalOffering.findUnique({ where: { id } });
        if (!before) throw new NotFoundError();
        await tx.$queryRaw`SELECT "id" FROM "RestaurantProfile" WHERE "id" = ${before.restaurantId}::uuid FOR UPDATE`;
        const changed = await tx.incidentalOffering.updateMany({
          where: { id, revision: expectedRevision },
          data: { ...input, revision: { increment: 1 } },
        });
        if (changed.count !== 1) throw offeringConflict('COMMERCIAL_PRICE_REVISION_STALE');
        const row = await tx.incidentalOffering.findUniqueOrThrow({ where: { id } });
        await tx.auditLog.create({
          data: {
            requestId: context.requestId,
            actorType: 'USER',
            actorId: context.actorId,
            action: 'venue.incidental-revised',
            entityType: 'incidental-offering',
            entityId: id,
            metadata: { before: view(before), after: view(row) },
          },
        });
        return view(row);
      });
    },
  };
}
