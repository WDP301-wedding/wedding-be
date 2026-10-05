import { AppError, NotFoundError } from '../../../core/errors/app-error.js';
import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import {
  CatalogPolicyError,
  transitionCatalogLifecycle,
  type CatalogLifecycle,
  type CatalogVersionState,
} from '../domain/catalog-policy.js';

export type CatalogVersionKind = 'DISH' | 'MENU_PACKAGE' | 'TIMELINE_TEMPLATE' | 'LAYOUT_TEMPLATE';

export interface CatalogMutationContext {
  readonly requestId: string;
  readonly actorId: string;
}

export interface CompareAndSwapDraftInput {
  readonly kind: CatalogVersionKind;
  readonly aggregateId: string;
  readonly versionId: string;
  readonly expectedRevision: number;
  readonly changedFields: readonly string[];
  readonly context: CatalogMutationContext;
  readonly mutate: (transaction: Prisma.TransactionClient) => Promise<void>;
}

interface PublishCatalogVersionBaseInput {
  readonly kind: CatalogVersionKind;
  readonly aggregateId: string;
  readonly versionId: string;
  readonly expectedRevision: number;
  readonly context: CatalogMutationContext;
}

export type PublishCatalogVersionInput = PublishCatalogVersionBaseInput &
  (
    | Readonly<{ kind: 'DISH'; validateDependencies?: never }>
    | Readonly<{
        kind: Exclude<CatalogVersionKind, 'DISH'>;
        validateDependencies: (transaction: Prisma.TransactionClient) => Promise<void>;
      }>
  );

export interface ChangeCatalogLifecycleInput {
  readonly kind: CatalogVersionKind;
  readonly aggregateId: string;
  readonly expectedRevision: number;
  readonly transition: 'RETIRE' | 'RESTORE';
  readonly context: CatalogMutationContext;
  readonly validateRestore?: (transaction: Prisma.TransactionClient) => Promise<void>;
}

export interface RegisterLayoutTableInput {
  readonly layoutTemplateId: string;
  readonly tableId: string;
  readonly context: CatalogMutationContext;
}

export interface CatalogVersionReference {
  readonly id: string;
  readonly aggregateId: string;
  readonly versionNumber: number;
  readonly state: Exclude<CatalogVersionState, 'DRAFT'>;
  readonly revision: number;
}

export interface CatalogVersionRepository {
  compareAndSwapDraft(input: CompareAndSwapDraftInput): Promise<Readonly<{ revision: number }>>;
  publish(input: PublishCatalogVersionInput): Promise<
    Readonly<{
      aggregateId: string;
      previousVersionId: string | null;
      versionId: string;
      versionNumber: number;
    }>
  >;
  changeLifecycle(
    input: ChangeCatalogLifecycleInput,
  ): Promise<Readonly<{ lifecycle: CatalogLifecycle; revision: number }>>;
  registerLayoutTable(input: RegisterLayoutTableInput): Promise<void>;
  resolveExactVersion(
    kind: CatalogVersionKind,
    versionId: string,
  ): Promise<CatalogVersionReference>;
  requireCurrentVersion(
    kind: CatalogVersionKind,
    aggregateId: string,
  ): Promise<CatalogVersionReference>;
}

export type CatalogConflictCode =
  | 'CATALOG_REVISION_CONFLICT'
  | 'CATALOG_PUBLISH_CONFLICT'
  | 'CATALOG_LIFECYCLE_CONFLICT'
  | 'CATALOG_RESTORE_CONFLICT'
  | 'CATALOG_TABLE_IDENTITY_CONFLICT';

export class CatalogConflictError extends AppError {
  constructor(code: CatalogConflictCode) {
    super({
      status: 409,
      code,
      message: conflictMessages[code],
    });
  }
}

interface CatalogTableSpec {
  readonly aggregateTable: string;
  readonly versionTable: string;
  readonly aggregateIdColumn: string;
  readonly entityType: string;
}

interface AggregateLockRow {
  readonly currentPublishedVersionId: string | null;
  readonly draftVersionId: string | null;
  readonly lifecycle: CatalogLifecycle;
}

interface DraftLockRow {
  readonly revision: number;
  readonly state: CatalogVersionState;
}

interface VersionRow {
  readonly id: string;
  readonly aggregateId: string;
  readonly versionNumber: number | null;
  readonly state: CatalogVersionState;
  readonly revision: number;
}

const conflictMessages: Readonly<Record<CatalogConflictCode, string>> = {
  CATALOG_REVISION_CONFLICT: 'The catalog draft changed after it was loaded.',
  CATALOG_PUBLISH_CONFLICT: 'The catalog version can no longer be published.',
  CATALOG_LIFECYCLE_CONFLICT: 'The catalog lifecycle changed after it was loaded.',
  CATALOG_RESTORE_CONFLICT: 'The catalog aggregate conflicts with an active replacement.',
  CATALOG_TABLE_IDENTITY_CONFLICT: 'The stable table identity is already registered.',
};

const tableSpecs: Readonly<Record<CatalogVersionKind, CatalogTableSpec>> = {
  DISH: {
    aggregateTable: 'Dish',
    versionTable: 'DishVersion',
    aggregateIdColumn: 'dishId',
    entityType: 'dish',
  },
  MENU_PACKAGE: {
    aggregateTable: 'MenuPackage',
    versionTable: 'MenuPackageVersion',
    aggregateIdColumn: 'menuPackageId',
    entityType: 'menu-package',
  },
  TIMELINE_TEMPLATE: {
    aggregateTable: 'TimelineTemplate',
    versionTable: 'TimelineTemplateVersion',
    aggregateIdColumn: 'timelineTemplateId',
    entityType: 'timeline-template',
  },
  LAYOUT_TEMPLATE: {
    aggregateTable: 'LayoutTemplate',
    versionTable: 'LayoutTemplateVersion',
    aggregateIdColumn: 'layoutTemplateId',
    entityType: 'layout-template',
  },
};

export function createPrismaCatalogVersionRepository(
  prisma: PrismaClient,
  now: () => Date = () => new Date(),
): CatalogVersionRepository {
  return Object.freeze({
    compareAndSwapDraft(input: CompareAndSwapDraftInput) {
      const changedFields = normalizeChangedFields(input.changedFields);
      return withSerializableRetry(prisma, async (transaction) => {
        await lockAggregate(transaction, input.kind, input.aggregateId);
        const spec = tableSpecs[input.kind];
        const rows = await transaction.$queryRaw<Array<{ revision: number }>>(Prisma.sql`
          UPDATE ${identifier(spec.versionTable)}
             SET "revision" = "revision" + 1,
                 "updatedAt" = ${now()}
           WHERE "id" = ${input.versionId}::uuid
             AND ${identifier(spec.aggregateIdColumn)} = ${input.aggregateId}::uuid
             AND "state" = 'DRAFT'
             AND "revision" = ${input.expectedRevision}
          RETURNING "revision"
        `);
        const winner = rows[0];
        if (winner === undefined) {
          throw new CatalogConflictError('CATALOG_REVISION_CONFLICT');
        }

        await input.mutate(transaction);
        await appendAudit(transaction, now(), input.context, {
          action: 'catalog.draft-updated',
          entityType: `${spec.entityType}-version`,
          entityId: input.versionId,
          metadata: { aggregateId: input.aggregateId, changedFields, kind: input.kind },
        });
        return Object.freeze({ revision: winner.revision });
      });
    },

    publish(input: PublishCatalogVersionInput) {
      return publishWithRetry(prisma, input, now);
    },

    changeLifecycle(input: ChangeCatalogLifecycleInput) {
      return changeLifecycleWithRetry(prisma, input, now);
    },

    async registerLayoutTable(input: RegisterLayoutTableInput) {
      try {
        await prisma.$transaction(async (transaction) => {
          await transaction.layoutTableIdentity.create({
            data: {
              id: input.tableId,
              layoutTemplateId: input.layoutTemplateId,
              createdByAccountId: input.context.actorId,
            },
          });
          await appendAudit(transaction, now(), input.context, {
            action: 'catalog.layout-table-registered',
            entityType: 'layout-table-identity',
            entityId: input.tableId,
            metadata: { layoutTemplateId: input.layoutTemplateId },
          });
        });
      } catch (error: unknown) {
        if (isKnownRequestError(error, 'P2002') || isKnownRequestError(error, 'P2003')) {
          throw new CatalogConflictError('CATALOG_TABLE_IDENTITY_CONFLICT');
        }
        throw error;
      }
    },

    resolveExactVersion(kind: CatalogVersionKind, versionId: string) {
      return prisma.$transaction(async (transaction) => {
        const version = await findVersion(
          transaction,
          kind,
          Prisma.sql`
          "id" = ${versionId}::uuid
          AND "state" IN ('PUBLISHED', 'SUPERSEDED')
        `,
        );
        if (version === undefined) {
          throw new NotFoundError();
        }
        return toVersionReference(version);
      });
    },

    requireCurrentVersion(kind: CatalogVersionKind, aggregateId: string) {
      return withSerializableRetry(prisma, async (transaction) => {
        await advisoryLock(transaction, kind, aggregateId);
        const spec = tableSpecs[kind];
        const rows = await transaction.$queryRaw<VersionRow[]>(Prisma.sql`
          SELECT version."id",
                 version.${identifier(spec.aggregateIdColumn)} AS "aggregateId",
                 version."versionNumber",
                 version."state",
                 version."revision"
            FROM ${identifier(spec.aggregateTable)} aggregate
            JOIN ${identifier(spec.versionTable)} version
              ON version."id" = aggregate."currentPublishedVersionId"
             AND version.${identifier(spec.aggregateIdColumn)} = aggregate."id"
           WHERE aggregate."id" = ${aggregateId}::uuid
             AND aggregate."lifecycle" = 'ACTIVE'
             AND version."state" = 'PUBLISHED'
        `);
        const version = rows[0];
        if (version === undefined) {
          throw new NotFoundError();
        }
        return toVersionReference(version);
      });
    },
  });
}

async function publishWithRetry(
  prisma: PrismaClient,
  input: PublishCatalogVersionInput,
  now: () => Date,
): Promise<
  Readonly<{
    aggregateId: string;
    previousVersionId: string | null;
    versionId: string;
    versionNumber: number;
  }>
> {
  return withSerializableRetry(prisma, async (transaction) => {
    const spec = tableSpecs[input.kind];
    await advisoryLock(transaction, input.kind, input.aggregateId);
    const aggregateRows = await transaction.$queryRaw<AggregateLockRow[]>(Prisma.sql`
      SELECT "currentPublishedVersionId", "draftVersionId", "lifecycle"
        FROM ${identifier(spec.aggregateTable)}
       WHERE "id" = ${input.aggregateId}::uuid
       FOR UPDATE
    `);
    const aggregate = aggregateRows[0];
    if (aggregate === undefined || aggregate.draftVersionId !== input.versionId) {
      throw new CatalogConflictError('CATALOG_PUBLISH_CONFLICT');
    }

    const draftRows = await transaction.$queryRaw<DraftLockRow[]>(Prisma.sql`
      SELECT "revision", "state"
        FROM ${identifier(spec.versionTable)}
       WHERE "id" = ${input.versionId}::uuid
         AND ${identifier(spec.aggregateIdColumn)} = ${input.aggregateId}::uuid
       FOR UPDATE
    `);
    const draft = draftRows[0];
    if (
      draft === undefined ||
      draft.state !== 'DRAFT' ||
      draft.revision !== input.expectedRevision
    ) {
      throw new CatalogConflictError('CATALOG_REVISION_CONFLICT');
    }

    if (input.kind !== 'DISH') {
      await input.validateDependencies(transaction);
    }
    const nextRows = await transaction.$queryRaw<Array<{ nextVersionNumber: number }>>(Prisma.sql`
      SELECT COALESCE(MAX("versionNumber"), 0)::integer + 1 AS "nextVersionNumber"
        FROM ${identifier(spec.versionTable)}
       WHERE ${identifier(spec.aggregateIdColumn)} = ${input.aggregateId}::uuid
         AND "state" IN ('PUBLISHED', 'SUPERSEDED')
    `);
    const versionNumber = nextRows[0]?.nextVersionNumber;
    if (versionNumber === undefined) {
      throw new CatalogConflictError('CATALOG_PUBLISH_CONFLICT');
    }
    const occurredAt = now();
    const previousVersionId = aggregate.currentPublishedVersionId;
    if (previousVersionId !== null) {
      const superseded = await transaction.$executeRaw(Prisma.sql`
        UPDATE ${identifier(spec.versionTable)}
           SET "state" = 'SUPERSEDED', "updatedAt" = ${occurredAt}
         WHERE "id" = ${previousVersionId}::uuid
           AND ${identifier(spec.aggregateIdColumn)} = ${input.aggregateId}::uuid
           AND "state" = 'PUBLISHED'
      `);
      if (superseded !== 1) {
        throw new CatalogConflictError('CATALOG_PUBLISH_CONFLICT');
      }
    }

    const published = await transaction.$executeRaw(Prisma.sql`
      UPDATE ${identifier(spec.versionTable)}
         SET "state" = 'PUBLISHED',
             "versionNumber" = ${versionNumber},
             "publishedAt" = ${occurredAt},
             "updatedAt" = ${occurredAt},
             "revision" = "revision" + 1
       WHERE "id" = ${input.versionId}::uuid
         AND ${identifier(spec.aggregateIdColumn)} = ${input.aggregateId}::uuid
         AND "state" = 'DRAFT'
         AND "revision" = ${input.expectedRevision}
    `);
    const pointerUpdated = await transaction.$executeRaw(Prisma.sql`
      UPDATE ${identifier(spec.aggregateTable)}
         SET "currentPublishedVersionId" = ${input.versionId}::uuid,
             "draftVersionId" = NULL,
             "revision" = "revision" + 1,
             "updatedAt" = ${occurredAt},
             "updatedByAccountId" = ${input.context.actorId}::uuid
       WHERE "id" = ${input.aggregateId}::uuid
         AND "draftVersionId" = ${input.versionId}::uuid
    `);
    if (published !== 1 || pointerUpdated !== 1) {
      throw new CatalogConflictError('CATALOG_PUBLISH_CONFLICT');
    }

    if (previousVersionId !== null) {
      await appendAudit(transaction, occurredAt, input.context, {
        action: 'catalog.version-superseded',
        entityType: `${spec.entityType}-version`,
        entityId: previousVersionId,
        metadata: { aggregateId: input.aggregateId, kind: input.kind },
      });
    }
    await appendAudit(transaction, occurredAt, input.context, {
      action: 'catalog.version-published',
      entityType: `${spec.entityType}-version`,
      entityId: input.versionId,
      metadata: { aggregateId: input.aggregateId, kind: input.kind, versionNumber },
    });

    return Object.freeze({
      aggregateId: input.aggregateId,
      previousVersionId,
      versionId: input.versionId,
      versionNumber,
    });
  });
}

async function changeLifecycleWithRetry(
  prisma: PrismaClient,
  input: ChangeCatalogLifecycleInput,
  now: () => Date,
): Promise<Readonly<{ lifecycle: CatalogLifecycle; revision: number }>> {
  try {
    return await withSerializableRetry(prisma, async (transaction) => {
      const spec = tableSpecs[input.kind];
      await advisoryLock(transaction, input.kind, input.aggregateId);
      const currentRows = await transaction.$queryRaw<
        Array<{ lifecycle: CatalogLifecycle; revision: number }>
      >(Prisma.sql`
        SELECT "lifecycle", "revision"
          FROM ${identifier(spec.aggregateTable)}
         WHERE "id" = ${input.aggregateId}::uuid
         FOR UPDATE
      `);
      const current = currentRows[0];
      if (current === undefined || current.revision !== input.expectedRevision) {
        throw new CatalogConflictError('CATALOG_LIFECYCLE_CONFLICT');
      }
      let lifecycle: CatalogLifecycle;
      try {
        lifecycle = transitionCatalogLifecycle(current.lifecycle, input.transition);
      } catch (error: unknown) {
        if (error instanceof CatalogPolicyError) {
          throw new CatalogConflictError('CATALOG_LIFECYCLE_CONFLICT');
        }
        throw error;
      }
      if (input.transition === 'RESTORE') {
        await input.validateRestore?.(transaction);
      }
      const occurredAt = now();
      const updatedRows = await transaction.$queryRaw<Array<{ revision: number }>>(Prisma.sql`
        UPDATE ${identifier(spec.aggregateTable)}
           SET "lifecycle" = ${lifecycle},
               "retiredAt" = ${lifecycle === 'RETIRED' ? occurredAt : null},
               "revision" = "revision" + 1,
               "updatedAt" = ${occurredAt},
               "updatedByAccountId" = ${input.context.actorId}::uuid
         WHERE "id" = ${input.aggregateId}::uuid
           AND "revision" = ${input.expectedRevision}
           AND "lifecycle" = ${current.lifecycle}
        RETURNING "revision"
      `);
      const updated = updatedRows[0];
      if (updated === undefined) {
        throw new CatalogConflictError('CATALOG_LIFECYCLE_CONFLICT');
      }
      await appendAudit(transaction, occurredAt, input.context, {
        action: lifecycle === 'RETIRED' ? 'catalog.retired' : 'catalog.restored',
        entityType: spec.entityType,
        entityId: input.aggregateId,
        metadata: { kind: input.kind, lifecycle },
      });
      return Object.freeze({ lifecycle, revision: updated.revision });
    });
  } catch (error: unknown) {
    if (input.transition === 'RESTORE' && isKnownRequestError(error, 'P2002')) {
      throw new CatalogConflictError('CATALOG_RESTORE_CONFLICT');
    }
    throw error;
  }
}

async function findVersion(
  transaction: Prisma.TransactionClient,
  kind: CatalogVersionKind,
  condition: Prisma.Sql,
): Promise<VersionRow | undefined> {
  const spec = tableSpecs[kind];
  const rows = await transaction.$queryRaw<VersionRow[]>(Prisma.sql`
    SELECT "id",
           ${identifier(spec.aggregateIdColumn)} AS "aggregateId",
           "versionNumber",
           "state",
           "revision"
      FROM ${identifier(spec.versionTable)}
     WHERE ${condition}
  `);
  return rows[0];
}

function toVersionReference(version: VersionRow): CatalogVersionReference {
  if (
    version.versionNumber === null ||
    (version.state !== 'PUBLISHED' && version.state !== 'SUPERSEDED')
  ) {
    throw new NotFoundError();
  }
  return Object.freeze({
    id: version.id,
    aggregateId: version.aggregateId,
    versionNumber: version.versionNumber,
    state: version.state,
    revision: version.revision,
  });
}

async function lockAggregate(
  transaction: Prisma.TransactionClient,
  kind: CatalogVersionKind,
  aggregateId: string,
): Promise<void> {
  await advisoryLock(transaction, kind, aggregateId);
}

async function advisoryLock(
  transaction: Prisma.TransactionClient,
  kind: CatalogVersionKind,
  aggregateId: string,
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${`${kind}:${aggregateId}`}))
  `;
}

async function appendAudit(
  transaction: Prisma.TransactionClient,
  occurredAt: Date,
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
      occurredAt,
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

async function withSerializableRetry<T>(
  prisma: PrismaClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  attempt = 0,
): Promise<T> {
  try {
    return await prisma.$transaction(operation, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  } catch (error: unknown) {
    if (isKnownRequestError(error, 'P2034') && attempt < 2) {
      return withSerializableRetry(prisma, operation, attempt + 1);
    }
    throw error;
  }
}

function normalizeChangedFields(changedFields: readonly string[]): readonly string[] {
  const normalized = [...new Set(changedFields)].sort();
  if (
    normalized.length > 20 ||
    normalized.some((field) => !/^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(field))
  ) {
    throw new TypeError('Catalog changedFields must contain bounded field names.');
  }
  return Object.freeze(normalized);
}

function identifier(value: string): Prisma.Sql {
  return Prisma.raw(`"${value}"`);
}

function isKnownRequestError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}
