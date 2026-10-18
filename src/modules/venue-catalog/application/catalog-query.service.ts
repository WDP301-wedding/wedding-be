import { NotFoundError } from '../../../core/errors/app-error.js';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import type { CatalogMediaService } from './catalog-media.service.js';

export interface CatalogPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export interface CatalogAdminQueryService {
  listPublicHalls(input: PageInput): Promise<CatalogPage<unknown>>;
  findAggregateIdForVersion(
    kind: 'DISH' | 'MENU_PACKAGE' | 'TIMELINE_TEMPLATE' | 'LAYOUT_TEMPLATE',
    versionId: string,
  ): Promise<string>;
  listPublicDishes(
    input: PageInput & {
      readonly categoryLabel?: string | undefined;
      readonly search?: string | undefined;
    },
  ): Promise<CatalogPage<unknown>>;
  listPublicMenuPackages(input: PageInput): Promise<CatalogPage<unknown>>;
  listTimelineTemplates(input: PageInput): Promise<CatalogPage<unknown>>;
  getTimelineTemplate(templateId: string): Promise<unknown>;
  listLayoutTemplates(input: PageInput): Promise<CatalogPage<unknown>>;
  getLayoutTemplate(templateId: string): Promise<unknown>;
  listDishes(input: PageInput): Promise<CatalogPage<unknown>>;
  getDish(dishId: string): Promise<unknown>;
  listMenuPackages(input: PageInput): Promise<CatalogPage<unknown>>;
  getMenuPackage(menuPackageId: string): Promise<unknown>;
}

interface PageInput {
  readonly limit: number;
  readonly cursor?: string | undefined;
}

const dishVersionSelect = {
  id: true,
  versionNumber: true,
  revision: true,
  state: true,
  name: true,
  description: true,
  categoryLabel: true,
  priceVnd: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DishVersionSelect;

const menuVersionSelect = {
  id: true,
  versionNumber: true,
  revision: true,
  state: true,
  name: true,
  description: true,
  priceVndPerTable: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
  items: {
    orderBy: { displayOrder: 'asc' as const },
    select: {
      displayOrder: true,
      dishVersion: {
        select: {
          id: true,
          dishId: true,
          versionNumber: true,
          name: true,
          description: true,
          categoryLabel: true,
          priceVnd: true,
        },
      },
    },
  },
} satisfies Prisma.MenuPackageVersionSelect;

const dishAggregateSelect = {
  id: true,
  lifecycle: true,
  displayOrder: true,
  revision: true,
  retiredAt: true,
  currentPublishedVersionId: true,
  draftVersionId: true,
  versions: {
    orderBy: [{ versionNumber: 'desc' as const }, { createdAt: 'desc' as const }],
    select: dishVersionSelect,
  },
} satisfies Prisma.DishSelect;

const menuAggregateSelect = {
  id: true,
  lifecycle: true,
  displayOrder: true,
  revision: true,
  retiredAt: true,
  currentPublishedVersionId: true,
  draftVersionId: true,
  versions: {
    orderBy: [{ versionNumber: 'desc' as const }, { createdAt: 'desc' as const }],
    select: menuVersionSelect,
  },
} satisfies Prisma.MenuPackageSelect;

export function createCatalogQueryService(
  prisma: PrismaClient,
  media: Pick<CatalogMediaService, 'listSigned' | 'listSignedBatch' | 'listSignedHallPage'>,
): CatalogAdminQueryService {
  const service: CatalogAdminQueryService = {
    listPublicHalls(input) {
      return media.listSignedHallPage(input);
    },
    async findAggregateIdForVersion(kind, versionId) {
      const owner = await findVersionOwner(prisma, kind, versionId);
      if (owner === null) throw new NotFoundError();
      return owner;
    },

    async listPublicDishes(input) {
      const rows = await prisma.dish.findMany({
        where: {
          lifecycle: 'ACTIVE',
          currentPublishedVersion: {
            is: {
              state: 'PUBLISHED',
              ...(input.categoryLabel === undefined ? {} : { categoryLabel: input.categoryLabel }),
              ...(input.search === undefined
                ? {}
                : { name: { contains: input.search, mode: 'insensitive' } }),
            },
          },
        },
        orderBy: { id: 'asc' },
        ...(input.cursor === undefined ? {} : { cursor: { id: input.cursor }, skip: 1 }),
        take: input.limit + 1,
        select: { id: true, currentPublishedVersion: { select: dishVersionSelect } },
      });
      const assets = await media.listSignedBatch(
        'DISH_VERSION',
        rows
          .slice(0, input.limit)
          .flatMap((r) => (r.currentPublishedVersion ? [r.currentPublishedVersion.id] : [])),
      );
      return page(
        rows.slice(0, input.limit).map(({ id, currentPublishedVersion }) => {
          if (currentPublishedVersion === null || currentPublishedVersion.versionNumber === null) {
            throw new NotFoundError();
          }
          return Object.freeze({
            id,
            versionId: currentPublishedVersion.id,
            versionNumber: currentPublishedVersion.versionNumber,
            name: currentPublishedVersion.name,
            description: currentPublishedVersion.description,
            categoryLabel: currentPublishedVersion.categoryLabel,
            priceVnd: decimalNumber(currentPublishedVersion.priceVnd),
            media: assets.get(currentPublishedVersion.id) ?? [],
          });
        }),
        rows,
        input.limit,
      );
    },

    async listPublicMenuPackages(input) {
      const rows = await prisma.menuPackage.findMany({
        where: { lifecycle: 'ACTIVE', currentPublishedVersion: { is: { state: 'PUBLISHED' } } },
        orderBy: { id: 'asc' },
        ...(input.cursor === undefined ? {} : { cursor: { id: input.cursor }, skip: 1 }),
        take: input.limit + 1,
        select: { id: true, currentPublishedVersion: { select: menuVersionSelect } },
      });
      const assets = await media.listSignedBatch(
        'MENU_PACKAGE_VERSION',
        rows
          .slice(0, input.limit)
          .flatMap((r) => (r.currentPublishedVersion ? [r.currentPublishedVersion.id] : [])),
      );
      return page(
        rows.slice(0, input.limit).map(({ id, currentPublishedVersion }) => {
          if (currentPublishedVersion === null || currentPublishedVersion.versionNumber === null)
            throw new NotFoundError();
          return Object.freeze({
            id,
            versionId: currentPublishedVersion.id,
            versionNumber: currentPublishedVersion.versionNumber,
            name: currentPublishedVersion.name,
            description: currentPublishedVersion.description,
            priceVndPerTable: decimalNumber(currentPublishedVersion.priceVndPerTable),
            items: currentPublishedVersion.items.map(({ displayOrder, dishVersion }) => ({
              dishId: dishVersion.dishId,
              dishVersionId: dishVersion.id,
              dishVersionNumber: dishVersion.versionNumber,
              name: dishVersion.name,
              description: dishVersion.description,
              categoryLabel: dishVersion.categoryLabel,
              priceVnd: decimalNumber(dishVersion.priceVnd),
              displayOrder,
            })),
            media: assets.get(currentPublishedVersion.id) ?? [],
          });
        }),
        rows,
        input.limit,
      );
    },

    listDishes(input) {
      return listDishAdmin(prisma, input);
    },
    async getDish(dishId) {
      const row = await prisma.dish.findUnique({
        where: { id: dishId },
        select: dishAggregateSelect,
      });
      if (row === null) throw new NotFoundError();
      return serializeDishAggregate(row);
    },
    listMenuPackages(input) {
      return listMenuAdmin(prisma, input);
    },
    async getMenuPackage(menuPackageId) {
      const row = await prisma.menuPackage.findUnique({
        where: { id: menuPackageId },
        select: menuAggregateSelect,
      });
      if (row === null) throw new NotFoundError();
      return serializeMenuAggregate(row);
    },
    async listTimelineTemplates(input) {
      const rows = await prisma.timelineTemplate.findMany({
        orderBy: { id: 'asc' },
        ...(input.cursor === undefined ? {} : { cursor: { id: input.cursor }, skip: 1 }),
        take: input.limit + 1,
        select: timelineAggregateSelect,
      });
      return page(rows.slice(0, input.limit).map(serializeTimelineAggregate), rows, input.limit);
    },
    async getTimelineTemplate(templateId) {
      const row = await prisma.timelineTemplate.findUnique({
        where: { id: templateId },
        select: timelineAggregateSelect,
      });
      if (row === null) throw new NotFoundError();
      return serializeTimelineAggregate(row);
    },
    async listLayoutTemplates(input) {
      const rows = await prisma.layoutTemplate.findMany({
        orderBy: { id: 'asc' },
        ...(input.cursor === undefined ? {} : { cursor: { id: input.cursor }, skip: 1 }),
        take: input.limit + 1,
        select: layoutAggregateSelect,
      });
      return page(rows.slice(0, input.limit).map(serializeLayoutAggregate), rows, input.limit);
    },
    async getLayoutTemplate(templateId) {
      const row = await prisma.layoutTemplate.findUnique({
        where: { id: templateId },
        select: layoutAggregateSelect,
      });
      if (row === null) throw new NotFoundError();
      return serializeLayoutAggregate(row);
    },
  };
  return Object.freeze(service);
}

const timelineAggregateSelect = {
  id: true,
  lifecycle: true,
  displayOrder: true,
  revision: true,
  retiredAt: true,
  currentPublishedVersionId: true,
  draftVersionId: true,
  versions: {
    orderBy: [{ versionNumber: 'desc' as const }, { createdAt: 'desc' as const }],
    select: {
      id: true,
      versionNumber: true,
      revision: true,
      state: true,
      name: true,
      description: true,
      publishedAt: true,
      createdAt: true,
      updatedAt: true,
      items: {
        orderBy: { displayOrder: 'asc' as const },
        select: {
          id: true,
          title: true,
          description: true,
          offsetMinutes: true,
          durationMinutes: true,
          displayOrder: true,
        },
      },
    },
  },
} satisfies Prisma.TimelineTemplateSelect;

const layoutAggregateSelect = {
  id: true,
  hallId: true,
  lifecycle: true,
  displayOrder: true,
  revision: true,
  retiredAt: true,
  currentPublishedVersionId: true,
  draftVersionId: true,
  tableIdentities: { orderBy: { id: 'asc' as const }, select: { id: true, retiredAt: true } },
  versions: {
    orderBy: [{ versionNumber: 'desc' as const }, { createdAt: 'desc' as const }],
    select: {
      id: true,
      versionNumber: true,
      revision: true,
      state: true,
      name: true,
      description: true,
      minGuests: true,
      maxGuests: true,
      publishedAt: true,
      createdAt: true,
      updatedAt: true,
      geometry: {
        orderBy: { displayOrder: 'asc' as const },
        select: {
          tableId: true,
          label: true,
          shape: true,
          seatCapacity: true,
          x: true,
          y: true,
          width: true,
          height: true,
          rotationDegrees: true,
          displayOrder: true,
        },
      },
    },
  },
} satisfies Prisma.LayoutTemplateSelect;

async function findVersionOwner(
  prisma: PrismaClient,
  kind: Parameters<CatalogAdminQueryService['findAggregateIdForVersion']>[0],
  versionId: string,
): Promise<string | null> {
  switch (kind) {
    case 'DISH':
      return (
        (
          await prisma.dishVersion.findUnique({
            where: { id: versionId },
            select: { dishId: true },
          })
        )?.dishId ?? null
      );
    case 'MENU_PACKAGE':
      return (
        (
          await prisma.menuPackageVersion.findUnique({
            where: { id: versionId },
            select: { menuPackageId: true },
          })
        )?.menuPackageId ?? null
      );
    case 'TIMELINE_TEMPLATE':
      return (
        (
          await prisma.timelineTemplateVersion.findUnique({
            where: { id: versionId },
            select: { timelineTemplateId: true },
          })
        )?.timelineTemplateId ?? null
      );
    case 'LAYOUT_TEMPLATE':
      return (
        (
          await prisma.layoutTemplateVersion.findUnique({
            where: { id: versionId },
            select: { layoutTemplateId: true },
          })
        )?.layoutTemplateId ?? null
      );
  }
}

async function listDishAdmin(
  prisma: PrismaClient,
  input: PageInput,
): Promise<CatalogPage<unknown>> {
  const rows = await prisma.dish.findMany({
    orderBy: { id: 'asc' },
    ...(input.cursor === undefined ? {} : { cursor: { id: input.cursor }, skip: 1 }),
    take: input.limit + 1,
    select: dishAggregateSelect,
  });
  return page(rows.slice(0, input.limit).map(serializeDishAggregate), rows, input.limit);
}

async function listMenuAdmin(
  prisma: PrismaClient,
  input: PageInput,
): Promise<CatalogPage<unknown>> {
  const rows = await prisma.menuPackage.findMany({
    orderBy: { id: 'asc' },
    ...(input.cursor === undefined ? {} : { cursor: { id: input.cursor }, skip: 1 }),
    take: input.limit + 1,
    select: menuAggregateSelect,
  });
  return page(rows.slice(0, input.limit).map(serializeMenuAggregate), rows, input.limit);
}

type DishAggregateRow = Prisma.DishGetPayload<{ select: typeof dishAggregateSelect }>;
type MenuAggregateRow = Prisma.MenuPackageGetPayload<{ select: typeof menuAggregateSelect }>;
type TimelineAggregateRow = Prisma.TimelineTemplateGetPayload<{
  select: typeof timelineAggregateSelect;
}>;
type LayoutAggregateRow = Prisma.LayoutTemplateGetPayload<{
  select: typeof layoutAggregateSelect;
}>;

interface AggregateSerializationRow {
  readonly id: string;
  readonly lifecycle: string;
  readonly displayOrder: number;
  readonly revision: number;
  readonly retiredAt: Date | null;
  readonly currentPublishedVersionId: string | null;
  readonly draftVersionId: string | null;
}

interface VersionSerializationRow {
  readonly id: string;
  readonly versionNumber: number | null;
  readonly revision: number;
  readonly state: string;
  readonly name: string;
  readonly description: string;
  readonly publishedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

function serializeDishAggregate(row: DishAggregateRow) {
  return {
    ...aggregateFields(row),
    versions: row.versions.map((version) => ({
      ...versionFields(version),
      categoryLabel: version.categoryLabel,
      priceVnd: decimalNumber(version.priceVnd),
    })),
  };
}

function serializeMenuAggregate(row: MenuAggregateRow) {
  return {
    ...aggregateFields(row),
    versions: row.versions.map((version) => ({
      ...versionFields(version),
      priceVndPerTable: decimalNumber(version.priceVndPerTable),
      items: version.items.map(({ displayOrder, dishVersion }) => ({
        displayOrder,
        dishId: dishVersion.dishId,
        dishVersionId: dishVersion.id,
        dishVersionNumber: dishVersion.versionNumber,
        name: dishVersion.name,
        description: dishVersion.description,
        categoryLabel: dishVersion.categoryLabel,
        priceVnd: decimalNumber(dishVersion.priceVnd),
      })),
    })),
  };
}

function serializeTimelineAggregate(row: TimelineAggregateRow) {
  return {
    ...aggregateFields(row),
    versions: row.versions.map((version) => ({
      ...versionFields(version),
      items: version.items,
    })),
  };
}

function serializeLayoutAggregate(row: LayoutAggregateRow) {
  return {
    ...aggregateFields(row),
    hallId: row.hallId,
    tables: row.tableIdentities.map((table) => ({
      id: table.id,
      retiredAt: iso(table.retiredAt),
    })),
    versions: row.versions.map((version) => ({
      ...versionFields(version),
      minGuests: version.minGuests,
      maxGuests: version.maxGuests,
      totalSeatCapacity: version.geometry.reduce((total, table) => total + table.seatCapacity, 0),
      tables: version.geometry,
    })),
  };
}

function aggregateFields(row: AggregateSerializationRow) {
  return {
    id: row.id,
    lifecycle: row.lifecycle,
    displayOrder: row.displayOrder,
    revision: row.revision,
    retiredAt: iso(row.retiredAt),
    currentPublishedVersionId: row.currentPublishedVersionId,
    draftVersionId: row.draftVersionId,
  };
}

function versionFields(version: VersionSerializationRow) {
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    revision: version.revision,
    state: version.state,
    name: version.name,
    description: version.description,
    publishedAt: iso(version.publishedAt),
    createdAt: iso(version.createdAt),
    updatedAt: iso(version.updatedAt),
  };
}

function decimalNumber(value: { toNumber(): number } | number | null): number | null {
  if (value === null) return null;
  const number = typeof value === 'number' ? value : value.toNumber();
  if (!Number.isSafeInteger(number))
    throw new RangeError('Catalog VND values must be safe integers.');
  return number;
}

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function page<T>(
  items: readonly T[],
  rows: readonly { readonly id: string }[],
  limit: number,
): CatalogPage<T> {
  return Object.freeze({
    items: Object.freeze([...items]),
    nextCursor: rows.length > limit ? (rows[limit - 1]?.id ?? null) : null,
  });
}
