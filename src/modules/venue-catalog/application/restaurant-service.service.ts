import { randomUUID } from 'node:crypto';
import { AppError, NotFoundError } from '../../../core/errors/app-error.js';
import type { PrismaClient, RestaurantServiceRevision } from '../../../generated/prisma/client.js';
import type { CatalogMutationContext } from '../infrastructure/catalog-version.repository.js';
import {
  checkedLineTotal,
  createServiceSchema,
  reviseServiceSchema,
  serviceSelectionSchema,
} from '../domain/commercial-offering.js';

export function offeringConflict(code: string) {
  return new AppError({
    status: 409,
    code,
    message: 'The commercial offering is no longer selectable at this revision.',
  });
}
function view(row: RestaurantServiceRevision, restaurantId: string) {
  return Object.freeze({
    serviceId: row.serviceId,
    sourceRevisionId: row.id,
    restaurantId,
    revision: row.revision,
    name: row.name,
    description: row.description,
    unit: row.unit,
    unitPriceVnd: row.unitPriceVnd.toNumber(),
    active: row.active,
  });
}
export function createRestaurantServiceService(prisma: PrismaClient) {
  return Object.freeze({
    async create(value: unknown, context: CatalogMutationContext) {
      const input = createServiceSchema.parse(value);
      return prisma.$transaction(async (tx) => {
        const restaurant = await tx.restaurantProfile.findUniqueOrThrow({
          where: { singletonKey: 'RESTAURANT' },
        });
        const serviceId = randomUUID();
        await tx.restaurantService.create({
          data: { id: serviceId, restaurantId: restaurant.id, revision: 1, active: input.active },
        });
        const row = await tx.restaurantServiceRevision.create({
          data: { id: randomUUID(), serviceId, revision: 1, ...input, actorId: context.actorId },
        });
        await tx.auditLog.create({
          data: {
            requestId: context.requestId,
            actorType: 'USER',
            actorId: context.actorId,
            action: 'venue.service-created',
            entityType: 'restaurant-service',
            entityId: serviceId,
            metadata: { revision: 1, sourceRevisionId: row.id },
          },
        });
        return view(row, restaurant.id);
      });
    },
    async revise(serviceId: string, value: unknown, context: CatalogMutationContext) {
      const { expectedRevision, ...input } = reviseServiceSchema.parse(value);
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "RestaurantService" WHERE "id" = ${serviceId}::uuid FOR UPDATE`;
        const head = await tx.restaurantService.findUnique({ where: { id: serviceId } });
        if (head === null) throw new NotFoundError();
        if (head.revision !== expectedRevision)
          throw offeringConflict('COMMERCIAL_PRICE_REVISION_STALE');
        const revision = expectedRevision + 1;
        const row = await tx.restaurantServiceRevision.create({
          data: { id: randomUUID(), serviceId, revision, ...input, actorId: context.actorId },
        });
        await tx.restaurantService.update({
          where: { id: serviceId },
          data: { revision, active: input.active },
        });
        await tx.auditLog.create({
          data: {
            requestId: context.requestId,
            actorType: 'USER',
            actorId: context.actorId,
            action: 'venue.service-revised',
            entityType: 'restaurant-service',
            entityId: serviceId,
            metadata: { predecessorRevision: expectedRevision, revision, sourceRevisionId: row.id },
          },
        });
        return view(row, head.restaurantId);
      });
    },
    async list(includeArchived = false, cursor?: string, limit = 20) {
      return prisma.$transaction(
        async (tx) => {
          const rows = await tx.restaurantService.findMany({
            where: {
              ...(includeArchived ? {} : { active: true }),
              ...(cursor === undefined ? {} : { id: { gt: cursor } }),
            },
            orderBy: { id: 'asc' },
            take: limit + 1,
            include: { revisions: { orderBy: { revision: 'desc' }, take: 1 } },
          });
          return {
            items: rows.slice(0, limit).map((head) => view(head.revisions[0]!, head.restaurantId)),
            nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
          };
        },
        { isolationLevel: 'RepeatableRead' },
      );
    },
    async resolveRevision(sourceRevisionId: string) {
      const row = await prisma.restaurantServiceRevision.findUnique({
        where: { id: sourceRevisionId },
        include: { service: true },
      });
      if (row === null) throw new NotFoundError();
      return view(row, row.service.restaurantId);
    },
    async requireSelection(value: unknown) {
      const input = serviceSelectionSchema.parse(value);
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "RestaurantService" WHERE "id" = ${input.serviceId}::uuid FOR SHARE`;
        const head = await tx.restaurantService.findUnique({
          where: { id: input.serviceId },
          include: { revisions: { orderBy: { revision: 'desc' }, take: 1 } },
        });
        if (head === null || !head.active) throw offeringConflict('OFFERING_NOT_SELECTABLE');
        const current = head.revisions[0]!;
        if (current.id !== input.sourceRevisionId)
          throw offeringConflict('COMMERCIAL_PRICE_REVISION_STALE');
        const facts = view(current, head.restaurantId);
        return Object.freeze({
          ...facts,
          quantity: input.quantity,
          lineTotalVnd: checkedLineTotal(facts.unitPriceVnd, input.quantity),
        });
      });
    },
  });
}

export type RestaurantServiceReader = Pick<
  ReturnType<typeof createRestaurantServiceService>,
  'resolveRevision' | 'requireSelection'
>;
export function createRestaurantServiceReader(prisma: PrismaClient): RestaurantServiceReader {
  const service = createRestaurantServiceService(prisma);
  return Object.freeze({
    resolveRevision: service.resolveRevision,
    requireSelection: service.requireSelection,
  });
}
