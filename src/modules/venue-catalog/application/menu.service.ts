import { AppError, NotFoundError } from '../../../core/errors/app-error.js';
import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import {
  createImmutableMenuItems,
  validateCatalogDescription,
  validateCatalogName,
  validateDishPriceVnd,
  validateMenuPriceVnd,
  type CatalogVersionState,
  type MenuItemInput,
} from '../domain/catalog-policy.js';
import {
  createPrismaCatalogVersionRepository,
  type CatalogMutationContext,
  type CatalogVersionRepository,
} from '../infrastructure/catalog-version.repository.js';

export interface DishVersionContent {
  readonly name: string;
  readonly description: string;
  readonly categoryLabel: string;
  readonly priceVnd: number | null;
}

export interface DishVersionSnapshot extends DishVersionContent {
  readonly id: string;
  readonly dishId: string;
  readonly versionNumber: number;
  readonly state: Exclude<CatalogVersionState, 'DRAFT'>;
  readonly revision: number;
}

export interface MenuPackageItemSnapshot extends DishVersionContent {
  readonly dishId: string;
  readonly dishVersionId: string;
  readonly dishVersionNumber: number;
  readonly displayOrder: number;
}

export interface MenuPackageSnapshot {
  readonly id: string;
  readonly menuPackageId: string;
  readonly versionNumber: number;
  readonly state: Exclude<CatalogVersionState, 'DRAFT'>;
  readonly revision: number;
  readonly name: string;
  readonly description: string;
  readonly priceVndPerTable: number;
  readonly items: readonly MenuPackageItemSnapshot[];
}

export interface CreateDishInput extends DishVersionContent {
  readonly dishId: string;
  readonly versionId: string;
  readonly displayOrder: number;
  readonly context: CatalogMutationContext;
}

export interface UpdateDishDraftInput extends DishVersionContent {
  readonly dishId: string;
  readonly versionId: string;
  readonly expectedRevision: number;
  readonly context: CatalogMutationContext;
}

export interface CreateMenuPackageInput {
  readonly menuPackageId: string;
  readonly versionId: string;
  readonly displayOrder: number;
  readonly name: string;
  readonly description: string;
  readonly priceVndPerTable: number;
  readonly items: readonly MenuItemInput[];
  readonly context: CatalogMutationContext;
}

export interface UpdateMenuPackageDraftInput extends Omit<CreateMenuPackageInput, 'displayOrder'> {
  readonly expectedRevision: number;
}

export interface PublishVersionInput {
  readonly versionId: string;
  readonly expectedRevision: number;
  readonly context: CatalogMutationContext;
}

export interface CloneVersionInput {
  readonly sourceVersionId: string;
  readonly versionId: string;
  readonly context: CatalogMutationContext;
}

export interface MenuService {
  createDish(input: CreateDishInput): Promise<Readonly<CreateDishInput & { revision: number }>>;
  cloneDishVersion(
    input: CloneVersionInput & { readonly dishId: string },
  ): Promise<Readonly<{ versionId: string; revision: number }>>;
  updateDishDraft(input: UpdateDishDraftInput): Promise<Readonly<{ revision: number }>>;
  publishDish(
    input: PublishVersionInput & { readonly dishId: string },
  ): ReturnType<CatalogVersionRepository['publish']>;
  changeDishLifecycle(
    input: LifecycleInput,
  ): ReturnType<CatalogVersionRepository['changeLifecycle']>;
  requireCurrentDishVersion(dishId: string): Promise<DishVersionSnapshot>;
  resolveDishVersion(versionId: string): Promise<DishVersionSnapshot>;
  createMenuPackage(
    input: CreateMenuPackageInput,
  ): Promise<Readonly<CreateMenuPackageInput & { revision: number }>>;
  cloneMenuPackageVersion(
    input: CloneVersionInput & { readonly menuPackageId: string },
  ): Promise<Readonly<{ versionId: string; revision: number }>>;
  updateMenuPackageDraft(
    input: UpdateMenuPackageDraftInput,
  ): Promise<Readonly<{ revision: number }>>;
  publishMenuPackage(
    input: PublishVersionInput & { readonly menuPackageId: string },
  ): ReturnType<CatalogVersionRepository['publish']>;
  changeMenuPackageLifecycle(
    input: LifecycleInput,
  ): ReturnType<CatalogVersionRepository['changeLifecycle']>;
  requireCurrentMenuPackageVersion(menuPackageId: string): Promise<MenuPackageSnapshot>;
  resolveMenuPackageVersion(versionId: string): Promise<MenuPackageSnapshot>;
}

export interface LifecycleInput {
  readonly aggregateId: string;
  readonly expectedRevision: number;
  readonly transition: 'RETIRE' | 'RESTORE';
  readonly context: CatalogMutationContext;
}

export class MenuCatalogConflictError extends AppError {
  constructor(code: 'CATALOG_DRAFT_CONFLICT' | 'CATALOG_DISH_REFERENCE_CONFLICT') {
    super({
      status: 409,
      code,
      message:
        code === 'CATALOG_DRAFT_CONFLICT'
          ? 'The aggregate already has a draft or the source version is invalid.'
          : 'Every menu item must reference the current published version of an active dish.',
    });
  }
}

type Transaction = Prisma.TransactionClient;

export function createMenuService(
  prisma: PrismaClient,
  versions: CatalogVersionRepository = createPrismaCatalogVersionRepository(prisma),
): MenuService {
  const service: MenuService = {
    async createDish(input) {
      const content = validateDishContent(input);
      const displayOrder = requireDisplayOrder(input.displayOrder);
      try {
        await prisma.$transaction(async (transaction) => {
          await transaction.dish.create({
            data: {
              id: input.dishId,
              displayOrder,
              createdByAccountId: input.context.actorId,
              updatedByAccountId: input.context.actorId,
            },
          });
          await transaction.dishVersion.create({
            data: {
              id: input.versionId,
              dishId: input.dishId,
              ...content,
              createdByAccountId: input.context.actorId,
            },
          });
          await transaction.dish.update({
            where: { id: input.dishId },
            data: { draftVersionId: input.versionId },
          });
          await appendAudit(transaction, input.context, {
            action: 'catalog.dish-created',
            entityType: 'dish',
            entityId: input.dishId,
            metadata: { draftVersionId: input.versionId },
          });
        });
      } catch (error: unknown) {
        throw mapDraftConflict(error);
      }
      return Object.freeze({ ...input, ...content, displayOrder, revision: 1 });
    },

    async cloneDishVersion(input) {
      try {
        await prisma.$transaction(async (transaction) => {
          const source = await transaction.dishVersion.findFirst({
            where: {
              id: input.sourceVersionId,
              dishId: input.dishId,
              state: { in: ['PUBLISHED', 'SUPERSEDED'] },
            },
          });
          if (source === null) throw new MenuCatalogConflictError('CATALOG_DRAFT_CONFLICT');
          await transaction.dishVersion.create({
            data: {
              id: input.versionId,
              dishId: input.dishId,
              name: source.name,
              description: source.description,
              categoryLabel: source.categoryLabel,
              priceVnd: source.priceVnd,
              createdByAccountId: input.context.actorId,
            },
          });
          const claimed = await transaction.dish.updateMany({
            where: { id: input.dishId, lifecycle: 'ACTIVE', draftVersionId: null },
            data: {
              draftVersionId: input.versionId,
              revision: { increment: 1 },
              updatedByAccountId: input.context.actorId,
            },
          });
          if (claimed.count !== 1) throw new MenuCatalogConflictError('CATALOG_DRAFT_CONFLICT');
          await appendCloneAudit(transaction, input.context, 'dish', input);
        });
      } catch (error: unknown) {
        throw mapDraftConflict(error);
      }
      return Object.freeze({ versionId: input.versionId, revision: 1 });
    },

    updateDishDraft(input) {
      const content = validateDishContent(input);
      return versions.compareAndSwapDraft({
        kind: 'DISH',
        aggregateId: input.dishId,
        versionId: input.versionId,
        expectedRevision: input.expectedRevision,
        changedFields: ['categoryLabel', 'description', 'name', 'priceVnd'],
        context: input.context,
        mutate: async (transaction) => {
          await transaction.dishVersion.update({
            where: { id: input.versionId },
            data: content,
          });
        },
      });
    },

    publishDish(input) {
      return versions.publish({
        kind: 'DISH',
        aggregateId: input.dishId,
        versionId: input.versionId,
        expectedRevision: input.expectedRevision,
        context: input.context,
      });
    },

    changeDishLifecycle(input) {
      return versions.changeLifecycle({ kind: 'DISH', ...input });
    },

    async requireCurrentDishVersion(dishId) {
      const version = await prisma.dishVersion.findFirst({
        where: {
          dishId,
          state: 'PUBLISHED',
          currentFor: { is: { id: dishId, lifecycle: 'ACTIVE' } },
        },
      });
      if (version === null) throw new NotFoundError();
      return toDishSnapshot(version);
    },

    async resolveDishVersion(versionId) {
      const version = await prisma.dishVersion.findFirst({
        where: { id: versionId, state: { in: ['PUBLISHED', 'SUPERSEDED'] } },
      });
      if (version === null) throw new NotFoundError();
      return toDishSnapshot(version);
    },

    async createMenuPackage(input) {
      const content = validateMenuContent(input);
      const displayOrder = requireDisplayOrder(input.displayOrder);
      try {
        await prisma.$transaction(async (transaction) => {
          await transaction.menuPackage.create({
            data: {
              id: input.menuPackageId,
              displayOrder,
              createdByAccountId: input.context.actorId,
              updatedByAccountId: input.context.actorId,
            },
          });
          await transaction.menuPackageVersion.create({
            data: {
              id: input.versionId,
              menuPackageId: input.menuPackageId,
              name: content.name,
              description: content.description,
              priceVndPerTable: content.priceVndPerTable,
              createdByAccountId: input.context.actorId,
            },
          });
          await replaceMenuItems(transaction, input.versionId, content.items);
          await transaction.menuPackage.update({
            where: { id: input.menuPackageId },
            data: { draftVersionId: input.versionId },
          });
          await appendAudit(transaction, input.context, {
            action: 'catalog.menu-package-created',
            entityType: 'menu-package',
            entityId: input.menuPackageId,
            metadata: { draftVersionId: input.versionId },
          });
        });
      } catch (error: unknown) {
        throw mapDraftConflict(error);
      }
      return Object.freeze({ ...input, ...content, displayOrder, revision: 1 });
    },

    async cloneMenuPackageVersion(input) {
      try {
        await prisma.$transaction(async (transaction) => {
          const source = await transaction.menuPackageVersion.findFirst({
            where: {
              id: input.sourceVersionId,
              menuPackageId: input.menuPackageId,
              state: { in: ['PUBLISHED', 'SUPERSEDED'] },
            },
            include: { items: { orderBy: { displayOrder: 'asc' } } },
          });
          if (source === null) throw new MenuCatalogConflictError('CATALOG_DRAFT_CONFLICT');
          await transaction.menuPackageVersion.create({
            data: {
              id: input.versionId,
              menuPackageId: input.menuPackageId,
              name: source.name,
              description: source.description,
              priceVndPerTable: source.priceVndPerTable,
              createdByAccountId: input.context.actorId,
            },
          });
          await replaceMenuItems(transaction, input.versionId, source.items);
          const claimed = await transaction.menuPackage.updateMany({
            where: { id: input.menuPackageId, lifecycle: 'ACTIVE', draftVersionId: null },
            data: {
              draftVersionId: input.versionId,
              revision: { increment: 1 },
              updatedByAccountId: input.context.actorId,
            },
          });
          if (claimed.count !== 1) throw new MenuCatalogConflictError('CATALOG_DRAFT_CONFLICT');
          await appendCloneAudit(transaction, input.context, 'menu-package', input);
        });
      } catch (error: unknown) {
        throw mapDraftConflict(error);
      }
      return Object.freeze({ versionId: input.versionId, revision: 1 });
    },

    updateMenuPackageDraft(input) {
      const content = validateMenuContent(input);
      return versions.compareAndSwapDraft({
        kind: 'MENU_PACKAGE',
        aggregateId: input.menuPackageId,
        versionId: input.versionId,
        expectedRevision: input.expectedRevision,
        changedFields: ['description', 'items', 'name', 'priceVndPerTable'],
        context: input.context,
        mutate: async (transaction) => {
          await transaction.menuPackageVersion.update({
            where: { id: input.versionId },
            data: {
              name: content.name,
              description: content.description,
              priceVndPerTable: content.priceVndPerTable,
            },
          });
          await transaction.menuPackageItem.deleteMany({
            where: { menuPackageVersionId: input.versionId },
          });
          await replaceMenuItems(transaction, input.versionId, content.items);
        },
      });
    },

    publishMenuPackage(input) {
      return versions.publish({
        kind: 'MENU_PACKAGE',
        aggregateId: input.menuPackageId,
        versionId: input.versionId,
        expectedRevision: input.expectedRevision,
        context: input.context,
        validateDependencies: async (transaction) => {
          const rows = await transaction.$queryRaw<Array<{ total: number; valid: number }>>(
            Prisma.sql`
              SELECT COUNT(*)::integer AS "total",
                     COUNT(*) FILTER (
                       WHERE dish."lifecycle" = 'ACTIVE'
                         AND dish."currentPublishedVersionId" = item."dishVersionId"
                         AND version."state" = 'PUBLISHED'
                     )::integer AS "valid"
                FROM "MenuPackageItem" item
                LEFT JOIN "DishVersion" version ON version."id" = item."dishVersionId"
                LEFT JOIN "Dish" dish ON dish."id" = version."dishId"
               WHERE item."menuPackageVersionId" = ${input.versionId}::uuid
            `,
          );
          const counts = rows[0];
          if (counts === undefined || counts.total === 0 || counts.total !== counts.valid) {
            throw new MenuCatalogConflictError('CATALOG_DISH_REFERENCE_CONFLICT');
          }
        },
      });
    },

    changeMenuPackageLifecycle(input) {
      return versions.changeLifecycle({ kind: 'MENU_PACKAGE', ...input });
    },

    async requireCurrentMenuPackageVersion(menuPackageId) {
      const version = await prisma.menuPackageVersion.findFirst({
        where: {
          menuPackageId,
          state: 'PUBLISHED',
          currentFor: { is: { id: menuPackageId, lifecycle: 'ACTIVE' } },
        },
        include: menuPackageItemsInclude,
      });
      if (version === null) throw new NotFoundError();
      return toMenuSnapshot(version);
    },

    async resolveMenuPackageVersion(versionId) {
      const version = await prisma.menuPackageVersion.findFirst({
        where: { id: versionId, state: { in: ['PUBLISHED', 'SUPERSEDED'] } },
        include: menuPackageItemsInclude,
      });
      if (version === null) throw new NotFoundError();
      return toMenuSnapshot(version);
    },
  };
  return Object.freeze(service);
}

const menuPackageItemsInclude = {
  items: {
    orderBy: { displayOrder: 'asc' as const },
    include: { dishVersion: true },
  },
} as const;

function validateDishContent(input: DishVersionContent): DishVersionContent {
  return Object.freeze({
    name: validateCatalogName(input.name),
    description: validateCatalogDescription(input.description),
    categoryLabel: validateCatalogName(input.categoryLabel),
    priceVnd: input.priceVnd === null ? null : validateDishPriceVnd(input.priceVnd),
  });
}

function validateMenuContent(input: {
  readonly name: string;
  readonly description: string;
  readonly priceVndPerTable: number;
  readonly items: readonly MenuItemInput[];
}) {
  return Object.freeze({
    name: validateCatalogName(input.name),
    description: validateCatalogDescription(input.description),
    priceVndPerTable: validateMenuPriceVnd(input.priceVndPerTable),
    items: createImmutableMenuItems(input.items),
  });
}

async function replaceMenuItems(
  transaction: Transaction,
  versionId: string,
  items: readonly MenuItemInput[],
): Promise<void> {
  await transaction.menuPackageItem.createMany({
    data: items.map((item) => ({
      menuPackageVersionId: versionId,
      dishVersionId: item.dishVersionId,
      displayOrder: item.displayOrder,
    })),
  });
}

function toDishSnapshot(version: {
  id: string;
  dishId: string;
  versionNumber: number | null;
  state: CatalogVersionState;
  revision: number;
  name: string;
  description: string;
  categoryLabel: string;
  priceVnd: { toNumber(): number } | number | null;
}): DishVersionSnapshot {
  if (
    version.versionNumber === null ||
    (version.state !== 'PUBLISHED' && version.state !== 'SUPERSEDED')
  ) {
    throw new NotFoundError();
  }
  return Object.freeze({
    id: version.id,
    dishId: version.dishId,
    versionNumber: version.versionNumber,
    state: version.state,
    revision: version.revision,
    name: version.name,
    description: version.description,
    categoryLabel: version.categoryLabel,
    priceVnd: decimalToNumber(version.priceVnd),
  });
}

function toMenuSnapshot(version: {
  id: string;
  menuPackageId: string;
  versionNumber: number | null;
  state: CatalogVersionState;
  revision: number;
  name: string;
  description: string;
  priceVndPerTable: { toNumber(): number } | number;
  items: readonly {
    displayOrder: number;
    dishVersion: {
      id: string;
      dishId: string;
      versionNumber: number | null;
      name: string;
      description: string;
      categoryLabel: string;
      priceVnd: { toNumber(): number } | number | null;
    };
  }[];
}): MenuPackageSnapshot {
  if (
    version.versionNumber === null ||
    (version.state !== 'PUBLISHED' && version.state !== 'SUPERSEDED')
  ) {
    throw new NotFoundError();
  }
  return Object.freeze({
    id: version.id,
    menuPackageId: version.menuPackageId,
    versionNumber: version.versionNumber,
    state: version.state,
    revision: version.revision,
    name: version.name,
    description: version.description,
    priceVndPerTable: decimalToNumber(version.priceVndPerTable)!,
    items: Object.freeze(
      version.items.map(({ displayOrder, dishVersion }) => {
        if (dishVersion.versionNumber === null) throw new NotFoundError();
        return Object.freeze({
          dishId: dishVersion.dishId,
          dishVersionId: dishVersion.id,
          dishVersionNumber: dishVersion.versionNumber,
          displayOrder,
          name: dishVersion.name,
          description: dishVersion.description,
          categoryLabel: dishVersion.categoryLabel,
          priceVnd: decimalToNumber(dishVersion.priceVnd),
        });
      }),
    ),
  });
}

function decimalToNumber(value: { toNumber(): number } | number | null): number | null {
  return value === null ? null : typeof value === 'number' ? value : value.toNumber();
}

function requireDisplayOrder(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError('displayOrder must be a non-negative integer.');
  }
  return value;
}

function mapDraftConflict(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new MenuCatalogConflictError('CATALOG_DRAFT_CONFLICT');
  }
  return error;
}

async function appendCloneAudit(
  transaction: Transaction,
  context: CatalogMutationContext,
  entityType: 'dish' | 'menu-package',
  input: CloneVersionInput,
): Promise<void> {
  await appendAudit(transaction, context, {
    action: 'catalog.version-cloned',
    entityType: `${entityType}-version`,
    entityId: input.versionId,
    metadata: { sourceVersionId: input.sourceVersionId },
  });
}

async function appendAudit(
  transaction: Transaction,
  context: CatalogMutationContext,
  event: Readonly<{
    action: string;
    entityType: string;
    entityId: string;
    metadata: Prisma.InputJsonObject;
  }>,
): Promise<void> {
  await transaction.auditLog.create({
    data: {
      requestId: context.requestId,
      actorType: 'USER',
      actorId: context.actorId,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      metadata: event.metadata,
    },
  });
}
