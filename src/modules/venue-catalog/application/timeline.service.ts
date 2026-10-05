import { randomUUID } from 'node:crypto';

import { AppError, NotFoundError } from '../../../core/errors/app-error.js';
import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import {
  createImmutableTimelineItems,
  validateCatalogDescription,
  validateCatalogName,
  type CatalogVersionState,
  type TimelineItemInput,
} from '../domain/catalog-policy.js';
import {
  createPrismaCatalogVersionRepository,
  type CatalogMutationContext,
  type CatalogVersionRepository,
} from '../infrastructure/catalog-version.repository.js';

export interface TimelineTemplateSnapshot {
  readonly id: string;
  readonly templateId: string;
  readonly versionNumber: number;
  readonly revision: number;
  readonly state: Exclude<CatalogVersionState, 'DRAFT'>;
  readonly name: string;
  readonly description: string;
  readonly items: readonly Readonly<TimelineItemInput>[];
}

export interface CreateTimelineTemplateInput {
  readonly templateId: string;
  readonly versionId: string;
  readonly displayOrder: number;
  readonly name: string;
  readonly description: string;
  readonly items: readonly TimelineItemInput[];
  readonly context: CatalogMutationContext;
}

export interface UpdateTimelineDraftInput extends Omit<
  CreateTimelineTemplateInput,
  'displayOrder'
> {
  readonly expectedRevision: number;
}

export interface TimelineService {
  createTemplate(
    input: CreateTimelineTemplateInput,
  ): Promise<Readonly<{ versionId: string; revision: number }>>;
  updateDraft(input: UpdateTimelineDraftInput): Promise<Readonly<{ revision: number }>>;
  cloneVersion(input: {
    readonly templateId: string;
    readonly sourceVersionId: string;
    readonly versionId: string;
    readonly context: CatalogMutationContext;
  }): Promise<Readonly<{ versionId: string; revision: number }>>;
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
  requireCurrentVersion(templateId: string): Promise<TimelineTemplateSnapshot>;
  resolveVersion(versionId: string): Promise<TimelineTemplateSnapshot>;
}

export class TimelineCatalogConflictError extends AppError {
  constructor() {
    super({
      status: 409,
      code: 'CATALOG_DRAFT_CONFLICT',
      message: 'The timeline template already has a draft or the source version is invalid.',
    });
  }
}

type Transaction = Prisma.TransactionClient;

export function createTimelineService(
  prisma: PrismaClient,
  versions: CatalogVersionRepository = createPrismaCatalogVersionRepository(prisma),
  createId: () => string = randomUUID,
): TimelineService {
  const service: TimelineService = {
    async createTemplate(input) {
      const content = validateTimelineContent(input);
      const displayOrder = requireDisplayOrder(input.displayOrder);
      try {
        await prisma.$transaction(async (transaction) => {
          await transaction.timelineTemplate.create({
            data: {
              id: input.templateId,
              displayOrder,
              createdByAccountId: input.context.actorId,
              updatedByAccountId: input.context.actorId,
            },
          });
          await transaction.timelineTemplateVersion.create({
            data: {
              id: input.versionId,
              timelineTemplateId: input.templateId,
              name: content.name,
              description: content.description,
              createdByAccountId: input.context.actorId,
            },
          });
          await createItems(transaction, input.versionId, content.items);
          await transaction.timelineTemplate.update({
            where: { id: input.templateId },
            data: { draftVersionId: input.versionId },
          });
          await appendAudit(transaction, input.context, {
            action: 'catalog.timeline-template-created',
            entityType: 'timeline-template',
            entityId: input.templateId,
            metadata: { draftVersionId: input.versionId },
          });
        });
      } catch (error: unknown) {
        throw mapDraftConflict(error);
      }
      return Object.freeze({ versionId: input.versionId, revision: 1 });
    },

    updateDraft(input) {
      const content = validateTimelineContent(input);
      return versions.compareAndSwapDraft({
        kind: 'TIMELINE_TEMPLATE',
        aggregateId: input.templateId,
        versionId: input.versionId,
        expectedRevision: input.expectedRevision,
        changedFields: ['description', 'items', 'name'],
        context: input.context,
        mutate: async (transaction) => {
          await transaction.timelineTemplateVersion.update({
            where: { id: input.versionId },
            data: { name: content.name, description: content.description },
          });
          await transaction.timelineTemplateItem.deleteMany({
            where: { timelineTemplateVersionId: input.versionId },
          });
          await createItems(transaction, input.versionId, content.items);
        },
      });
    },

    async cloneVersion(input) {
      try {
        await prisma.$transaction(async (transaction) => {
          const source = await transaction.timelineTemplateVersion.findFirst({
            where: {
              id: input.sourceVersionId,
              timelineTemplateId: input.templateId,
              state: { in: ['PUBLISHED', 'SUPERSEDED'] },
            },
            include: { items: { orderBy: { displayOrder: 'asc' } } },
          });
          if (source === null) throw new TimelineCatalogConflictError();
          const clonedItems = createImmutableTimelineItems(
            source.items.map((item) => ({
              id: createId(),
              title: item.title,
              description: item.description,
              offsetMinutes: item.offsetMinutes,
              durationMinutes: item.durationMinutes,
              displayOrder: item.displayOrder,
            })),
          );
          await transaction.timelineTemplateVersion.create({
            data: {
              id: input.versionId,
              timelineTemplateId: input.templateId,
              name: source.name,
              description: source.description,
              createdByAccountId: input.context.actorId,
            },
          });
          await createItems(transaction, input.versionId, clonedItems);
          const claimed = await transaction.timelineTemplate.updateMany({
            where: { id: input.templateId, lifecycle: 'ACTIVE', draftVersionId: null },
            data: {
              draftVersionId: input.versionId,
              revision: { increment: 1 },
              updatedByAccountId: input.context.actorId,
            },
          });
          if (claimed.count !== 1) throw new TimelineCatalogConflictError();
          await appendAudit(transaction, input.context, {
            action: 'catalog.timeline-version-cloned',
            entityType: 'timeline-template-version',
            entityId: input.versionId,
            metadata: { sourceVersionId: input.sourceVersionId },
          });
        });
      } catch (error: unknown) {
        throw mapDraftConflict(error);
      }
      return Object.freeze({ versionId: input.versionId, revision: 1 });
    },

    publish(input) {
      return versions.publish({
        kind: 'TIMELINE_TEMPLATE',
        aggregateId: input.templateId,
        versionId: input.versionId,
        expectedRevision: input.expectedRevision,
        context: input.context,
        validateDependencies: async (transaction) => {
          const items = await transaction.timelineTemplateItem.findMany({
            where: { timelineTemplateVersionId: input.versionId },
            orderBy: { displayOrder: 'asc' },
          });
          createImmutableTimelineItems(items);
        },
      });
    },

    changeLifecycle(input) {
      return versions.changeLifecycle({ kind: 'TIMELINE_TEMPLATE', ...input });
    },

    async requireCurrentVersion(templateId) {
      const version = await prisma.timelineTemplateVersion.findFirst({
        where: {
          timelineTemplateId: templateId,
          state: 'PUBLISHED',
          currentFor: { is: { id: templateId, lifecycle: 'ACTIVE' } },
        },
        include: timelineItemsInclude,
      });
      if (version === null) throw new NotFoundError();
      return toTimelineSnapshot(version);
    },

    async resolveVersion(versionId) {
      const version = await prisma.timelineTemplateVersion.findFirst({
        where: { id: versionId, state: { in: ['PUBLISHED', 'SUPERSEDED'] } },
        include: timelineItemsInclude,
      });
      if (version === null) throw new NotFoundError();
      return toTimelineSnapshot(version);
    },
  };
  return Object.freeze(service);
}

const timelineItemsInclude = {
  items: { orderBy: { displayOrder: 'asc' as const } },
} as const;

function validateTimelineContent(input: {
  readonly name: string;
  readonly description: string;
  readonly items: readonly TimelineItemInput[];
}) {
  return Object.freeze({
    name: validateCatalogName(input.name),
    description: validateCatalogDescription(input.description),
    items: createImmutableTimelineItems(input.items),
  });
}

async function createItems(
  transaction: Transaction,
  versionId: string,
  items: readonly TimelineItemInput[],
): Promise<void> {
  await transaction.timelineTemplateItem.createMany({
    data: items.map((item) => ({
      id: item.id,
      timelineTemplateVersionId: versionId,
      title: item.title,
      description: item.description,
      offsetMinutes: item.offsetMinutes,
      durationMinutes: item.durationMinutes,
      displayOrder: item.displayOrder,
    })),
  });
}

function toTimelineSnapshot(version: {
  id: string;
  timelineTemplateId: string;
  versionNumber: number | null;
  revision: number;
  state: CatalogVersionState;
  name: string;
  description: string;
  items: readonly TimelineItemInput[];
}): TimelineTemplateSnapshot {
  if (
    version.versionNumber === null ||
    (version.state !== 'PUBLISHED' && version.state !== 'SUPERSEDED')
  ) {
    throw new NotFoundError();
  }
  return Object.freeze({
    id: version.id,
    templateId: version.timelineTemplateId,
    versionNumber: version.versionNumber,
    revision: version.revision,
    state: version.state,
    name: version.name,
    description: version.description,
    items: createImmutableTimelineItems(version.items),
  });
}

function requireDisplayOrder(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError('displayOrder must be a non-negative integer.');
  }
  return value;
}

function mapDraftConflict(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new TimelineCatalogConflictError();
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
