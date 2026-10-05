import { AppError, NotFoundError } from '../../../core/errors/app-error.js';
import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import {
  createImmutableLayout,
  validateCatalogDescription,
  validateCatalogName,
  type CatalogVersionState,
  type ImmutableLayout,
  type LayoutTableInput,
} from '../domain/catalog-policy.js';
import {
  CatalogConflictError,
  createPrismaCatalogVersionRepository,
  type CatalogMutationContext,
  type CatalogVersionRepository,
} from '../infrastructure/catalog-version.repository.js';

export interface LayoutVersionSnapshot extends ImmutableLayout {
  readonly id: string;
  readonly templateId: string;
  readonly hallId: string;
  readonly versionNumber: number;
  readonly revision: number;
  readonly state: Exclude<CatalogVersionState, 'DRAFT'>;
  readonly name: string;
  readonly description: string;
}

export interface CreateLayoutTemplateInput {
  readonly templateId: string;
  readonly versionId: string;
  readonly hallId: string;
  readonly displayOrder: number;
  readonly name: string;
  readonly description: string;
  readonly minGuests: number;
  readonly maxGuests: number;
  readonly tables: readonly LayoutTableInput[];
  readonly context: CatalogMutationContext;
}

export interface UpdateLayoutDraftInput extends Omit<
  CreateLayoutTemplateInput,
  'hallId' | 'displayOrder'
> {
  readonly expectedRevision: number;
}

export interface LayoutService {
  createTemplate(
    input: CreateLayoutTemplateInput,
  ): Promise<Readonly<{ versionId: string; revision: number }>>;
  updateDraft(input: UpdateLayoutDraftInput): Promise<Readonly<{ revision: number }>>;
  cloneVersion(input: {
    readonly templateId: string;
    readonly sourceVersionId: string;
    readonly versionId: string;
    readonly context: CatalogMutationContext;
  }): Promise<Readonly<{ versionId: string; revision: number }>>;
  registerTable(input: {
    readonly templateId: string;
    readonly tableId: string;
    readonly context: CatalogMutationContext;
  }): Promise<void>;
  retireTable(input: {
    readonly templateId: string;
    readonly tableId: string;
    readonly context: CatalogMutationContext;
  }): Promise<void>;
  publish(input: {
    readonly templateId: string;
    readonly versionId: string;
    readonly expectedRevision: number;
    readonly context: CatalogMutationContext;
  }): ReturnType<CatalogVersionRepository['publish']>;
  changeLifecycle(input: {
    readonly aggregateId: string;
    readonly expectedRevision: number;
    readonly transition: 'RETIRE' | 'RESTORE';
    readonly context: CatalogMutationContext;
  }): ReturnType<CatalogVersionRepository['changeLifecycle']>;
  listCurrentVersionsForHall(hallId: string): Promise<readonly LayoutVersionSnapshot[]>;
  requireCurrentVersion(templateId: string): Promise<LayoutVersionSnapshot>;
  resolveVersion(versionId: string): Promise<LayoutVersionSnapshot>;
}

export class LayoutCatalogConflictError extends AppError {
  constructor() {
    super({
      status: 409,
      code: 'CATALOG_DRAFT_CONFLICT',
      message: 'The layout template already has a draft or its hall/source is invalid.',
    });
  }
}

type Transaction = Prisma.TransactionClient;

export function createLayoutService(
  prisma: PrismaClient,
  versions: CatalogVersionRepository = createPrismaCatalogVersionRepository(prisma),
): LayoutService {
  const service: LayoutService = {
    async createTemplate(input) {
      const displayOrder = requireDisplayOrder(input.displayOrder);
      const name = validateCatalogName(input.name);
      const description = validateCatalogDescription(input.description);
      try {
        await prisma.$transaction(async (transaction) => {
          const hall = await transaction.hall.findFirst({
            where: { id: input.hallId, lifecycle: 'ACTIVE' },
            select: { id: true, maxGuests: true },
          });
          if (hall === null) throw new NotFoundError();
          const layout = createImmutableLayout({
            hallMaximumGuests: hall.maxGuests,
            minGuests: input.minGuests,
            maxGuests: input.maxGuests,
            registeredTableIds: input.tables.map(({ tableId }) => tableId),
            retiredTableIds: [],
            tables: input.tables,
          });
          await transaction.layoutTemplate.create({
            data: {
              id: input.templateId,
              hallId: hall.id,
              displayOrder,
              createdByAccountId: input.context.actorId,
              updatedByAccountId: input.context.actorId,
            },
          });
          await transaction.layoutTemplateVersion.create({
            data: {
              id: input.versionId,
              layoutTemplateId: input.templateId,
              name,
              description,
              minGuests: layout.minGuests,
              maxGuests: layout.maxGuests,
              createdByAccountId: input.context.actorId,
            },
          });
          await transaction.layoutTableIdentity.createMany({
            data: layout.tables.map(({ tableId }) => ({
              id: tableId,
              layoutTemplateId: input.templateId,
              createdByAccountId: input.context.actorId,
            })),
          });
          await createGeometry(transaction, input.templateId, input.versionId, layout.tables);
          await transaction.layoutTemplate.update({
            where: { id: input.templateId },
            data: { draftVersionId: input.versionId },
          });
          await appendAudit(transaction, input.context, {
            action: 'catalog.layout-template-created',
            entityType: 'layout-template',
            entityId: input.templateId,
            metadata: { draftVersionId: input.versionId, hallId: input.hallId },
          });
        });
      } catch (error: unknown) {
        throw mapDraftConflict(error);
      }
      return Object.freeze({ versionId: input.versionId, revision: 1 });
    },

    async updateDraft(input) {
      const template = await findTemplateValidationState(prisma, input.templateId);
      const content = validateLayoutContent(input, template);
      return versions.compareAndSwapDraft({
        kind: 'LAYOUT_TEMPLATE',
        aggregateId: input.templateId,
        versionId: input.versionId,
        expectedRevision: input.expectedRevision,
        changedFields: ['description', 'geometry', 'maxGuests', 'minGuests', 'name'],
        context: input.context,
        mutate: async (transaction) => {
          await transaction.layoutTemplateVersion.update({
            where: { id: input.versionId },
            data: {
              name: content.name,
              description: content.description,
              minGuests: content.layout.minGuests,
              maxGuests: content.layout.maxGuests,
            },
          });
          await transaction.layoutTableGeometry.deleteMany({
            where: { layoutTemplateVersionId: input.versionId },
          });
          await createGeometry(
            transaction,
            input.templateId,
            input.versionId,
            content.layout.tables,
          );
        },
      });
    },

    async cloneVersion(input) {
      try {
        await prisma.$transaction(async (transaction) => {
          const template = await transaction.layoutTemplate.findFirst({
            where: { id: input.templateId, lifecycle: 'ACTIVE', hall: { lifecycle: 'ACTIVE' } },
            select: {
              id: true,
              hall: { select: { maxGuests: true } },
              tableIdentities: { select: { id: true, retiredAt: true } },
            },
          });
          const source = await transaction.layoutTemplateVersion.findFirst({
            where: {
              id: input.sourceVersionId,
              layoutTemplateId: input.templateId,
              state: { in: ['PUBLISHED', 'SUPERSEDED'] },
            },
            include: layoutGeometryInclude,
          });
          if (template === null || source === null) throw new LayoutCatalogConflictError();
          const content = validateLayoutContent(source, template);
          await transaction.layoutTemplateVersion.create({
            data: {
              id: input.versionId,
              layoutTemplateId: input.templateId,
              name: content.name,
              description: content.description,
              minGuests: content.layout.minGuests,
              maxGuests: content.layout.maxGuests,
              createdByAccountId: input.context.actorId,
            },
          });
          await createGeometry(
            transaction,
            input.templateId,
            input.versionId,
            content.layout.tables,
          );
          const claimed = await transaction.layoutTemplate.updateMany({
            where: { id: input.templateId, lifecycle: 'ACTIVE', draftVersionId: null },
            data: {
              draftVersionId: input.versionId,
              revision: { increment: 1 },
              updatedByAccountId: input.context.actorId,
            },
          });
          if (claimed.count !== 1) throw new LayoutCatalogConflictError();
          await appendAudit(transaction, input.context, {
            action: 'catalog.layout-version-cloned',
            entityType: 'layout-template-version',
            entityId: input.versionId,
            metadata: { sourceVersionId: input.sourceVersionId },
          });
        });
      } catch (error: unknown) {
        throw mapDraftConflict(error);
      }
      return Object.freeze({ versionId: input.versionId, revision: 1 });
    },

    registerTable(input) {
      return versions.registerLayoutTable({
        layoutTemplateId: input.templateId,
        tableId: input.tableId,
        context: input.context,
      });
    },

    async retireTable(input) {
      await prisma.$transaction(async (transaction) => {
        const retired = await transaction.layoutTableIdentity.updateMany({
          where: {
            id: input.tableId,
            layoutTemplateId: input.templateId,
            retiredAt: null,
          },
          data: { retiredAt: new Date() },
        });
        if (retired.count !== 1) {
          throw new CatalogConflictError('CATALOG_TABLE_IDENTITY_CONFLICT');
        }
        await appendAudit(transaction, input.context, {
          action: 'catalog.layout-table-retired',
          entityType: 'layout-table-identity',
          entityId: input.tableId,
          metadata: { layoutTemplateId: input.templateId },
        });
      });
    },

    publish(input) {
      return versions.publish({
        kind: 'LAYOUT_TEMPLATE',
        aggregateId: input.templateId,
        versionId: input.versionId,
        expectedRevision: input.expectedRevision,
        context: input.context,
        validateDependencies: async (transaction) => {
          const template = await transaction.layoutTemplate.findFirst({
            where: {
              id: input.templateId,
              lifecycle: 'ACTIVE',
              hall: { lifecycle: 'ACTIVE' },
              draftVersionId: input.versionId,
            },
            select: {
              hall: { select: { maxGuests: true } },
              tableIdentities: { select: { id: true, retiredAt: true } },
              draftVersion: {
                select: {
                  name: true,
                  description: true,
                  minGuests: true,
                  maxGuests: true,
                  geometry: { orderBy: { displayOrder: 'asc' } },
                },
              },
            },
          });
          if (template?.draftVersion === null || template?.draftVersion === undefined) {
            throw new LayoutCatalogConflictError();
          }
          validateLayoutContent(template.draftVersion, template);
        },
      });
    },

    changeLifecycle(input) {
      return versions.changeLifecycle({ kind: 'LAYOUT_TEMPLATE', ...input });
    },

    async listCurrentVersionsForHall(hallId) {
      const versionsForHall = await prisma.layoutTemplateVersion.findMany({
        where: {
          state: 'PUBLISHED',
          currentFor: {
            is: { lifecycle: 'ACTIVE', hallId, hall: { lifecycle: 'ACTIVE' } },
          },
        },
        include: layoutSnapshotInclude,
        orderBy: [{ currentFor: { displayOrder: 'asc' } }, { id: 'asc' }],
      });
      return Object.freeze(versionsForHall.map(toLayoutSnapshot));
    },

    async requireCurrentVersion(templateId) {
      const version = await prisma.layoutTemplateVersion.findFirst({
        where: {
          layoutTemplateId: templateId,
          state: 'PUBLISHED',
          currentFor: {
            is: { id: templateId, lifecycle: 'ACTIVE', hall: { lifecycle: 'ACTIVE' } },
          },
        },
        include: layoutSnapshotInclude,
      });
      if (version === null) throw new NotFoundError();
      return toLayoutSnapshot(version);
    },

    async resolveVersion(versionId) {
      const version = await prisma.layoutTemplateVersion.findFirst({
        where: { id: versionId, state: { in: ['PUBLISHED', 'SUPERSEDED'] } },
        include: layoutSnapshotInclude,
      });
      if (version === null) throw new NotFoundError();
      return toLayoutSnapshot(version);
    },
  };
  return Object.freeze(service);
}

const layoutGeometryInclude = {
  geometry: { orderBy: { displayOrder: 'asc' as const } },
} as const;

const layoutSnapshotInclude = {
  ...layoutGeometryInclude,
  layoutTemplate: { select: { hallId: true } },
} as const;

interface LayoutValidationState {
  readonly hall: Readonly<{ maxGuests: number }>;
  readonly tableIdentities: readonly Readonly<{ id: string; retiredAt: Date | null }>[];
}

async function findTemplateValidationState(
  prisma: PrismaClient,
  templateId: string,
): Promise<LayoutValidationState> {
  const template = await prisma.layoutTemplate.findFirst({
    where: { id: templateId, lifecycle: 'ACTIVE', hall: { lifecycle: 'ACTIVE' } },
    select: {
      hall: { select: { maxGuests: true } },
      tableIdentities: { select: { id: true, retiredAt: true } },
    },
  });
  if (template === null) throw new NotFoundError();
  return template;
}

function validateLayoutContent(
  input: {
    readonly name: string;
    readonly description: string;
    readonly minGuests: number;
    readonly maxGuests: number;
  } & (
    | Readonly<{ tables: readonly LayoutTableInput[] }>
    | Readonly<{ geometry: readonly LayoutTableInput[] }>
  ),
  template: LayoutValidationState,
) {
  const tables = 'tables' in input ? input.tables : input.geometry;
  return Object.freeze({
    name: validateCatalogName(input.name),
    description: validateCatalogDescription(input.description),
    layout: createImmutableLayout({
      hallMaximumGuests: template.hall.maxGuests,
      minGuests: input.minGuests,
      maxGuests: input.maxGuests,
      registeredTableIds: template.tableIdentities.map(({ id }) => id),
      retiredTableIds: template.tableIdentities
        .filter(({ retiredAt }) => retiredAt !== null)
        .map(({ id }) => id),
      tables,
    }),
  });
}

async function createGeometry(
  transaction: Transaction,
  templateId: string,
  versionId: string,
  tables: readonly LayoutTableInput[],
): Promise<void> {
  await transaction.layoutTableGeometry.createMany({
    data: tables.map((table) => ({
      layoutTemplateVersionId: versionId,
      layoutTemplateId: templateId,
      tableId: table.tableId,
      label: table.label,
      shape: table.shape,
      seatCapacity: table.seatCapacity,
      x: table.x,
      y: table.y,
      width: table.width,
      height: table.height,
      rotationDegrees: table.rotationDegrees,
      displayOrder: table.displayOrder,
    })),
  });
}

function toLayoutSnapshot(version: {
  id: string;
  layoutTemplateId: string;
  versionNumber: number | null;
  revision: number;
  state: CatalogVersionState;
  name: string;
  description: string;
  minGuests: number;
  maxGuests: number;
  layoutTemplate: { hallId: string };
  geometry: readonly LayoutTableInput[];
}): LayoutVersionSnapshot {
  if (
    version.versionNumber === null ||
    (version.state !== 'PUBLISHED' && version.state !== 'SUPERSEDED')
  ) {
    throw new NotFoundError();
  }
  const layout = createImmutableLayout({
    hallMaximumGuests: 10_000,
    minGuests: version.minGuests,
    maxGuests: version.maxGuests,
    registeredTableIds: version.geometry.map(({ tableId }) => tableId),
    retiredTableIds: [],
    tables: version.geometry,
  });
  return Object.freeze({
    id: version.id,
    templateId: version.layoutTemplateId,
    hallId: version.layoutTemplate.hallId,
    versionNumber: version.versionNumber,
    revision: version.revision,
    state: version.state,
    name: version.name,
    description: version.description,
    ...layout,
  });
}

function requireDisplayOrder(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError('displayOrder must be a non-negative integer.');
  }
  return value;
}

function mapDraftConflict(error: unknown): unknown {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2002' || error.code === 'P2003' || error.code === 'P2014')
  ) {
    return new LayoutCatalogConflictError();
  }
  return error;
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
