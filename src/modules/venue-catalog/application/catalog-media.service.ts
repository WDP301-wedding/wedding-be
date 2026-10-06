import { AppError, NotFoundError, ValidationError } from '../../../core/errors/app-error.js';
import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import {
  createStorageObjectReference,
  type StorageProvider,
  type StoredObject,
} from '../../../integrations/storage/storage-provider.js';
import type { StorageContentType } from '../../../integrations/storage/storage.schemas.js';
import {
  CATALOG_LIMITS,
  CATALOG_PLATFORM_POLICY,
  validateMediaAlternativeText,
} from '../domain/catalog-policy.js';
import type { CatalogMutationContext } from '../infrastructure/catalog-version.repository.js';

const catalogMediaResourceTypes = [
  'RESTAURANT_PROFILE',
  'HALL',
  'DISH_VERSION',
  'MENU_PACKAGE_VERSION',
  'TIMELINE_TEMPLATE_VERSION',
  'LAYOUT_TEMPLATE_VERSION',
] as const;

export type CatalogMediaResourceType = (typeof catalogMediaResourceTypes)[number];

export interface CatalogMediaView {
  readonly id: string;
  readonly resourceType: CatalogMediaResourceType;
  readonly resourceId: string;
  readonly contentType: StorageContentType;
  readonly sizeBytes: number;
  readonly alternativeText: string;
  readonly displayOrder: number;
  readonly signedUrl: string;
  readonly signedUrlExpiresInSeconds: number;
}

export interface UploadCatalogMediaInput {
  readonly assetId: string;
  readonly resourceType: CatalogMediaResourceType;
  readonly resourceId: string;
  readonly bytes: Uint8Array;
  readonly contentType: StorageContentType;
  readonly alternativeText: string;
  readonly context: CatalogMutationContext;
}

export interface CatalogMediaService {
  upload(input: UploadCatalogMediaInput): Promise<CatalogMediaView>;
  replace(
    input: UploadCatalogMediaInput & Readonly<{ oldAssetId: string }>,
  ): Promise<CatalogMediaView>;
  reorder(input: {
    readonly resourceType: CatalogMediaResourceType;
    readonly resourceId: string;
    readonly assetIds: readonly string[];
    readonly expectedRevision?: number;
    readonly context: CatalogMutationContext;
  }): Promise<void>;
  listSigned(
    resourceType: CatalogMediaResourceType,
    resourceId: string,
  ): Promise<readonly CatalogMediaView[]>;
}

export class CatalogMediaConflictError extends AppError {
  constructor(
    code:
      | 'CATALOG_MEDIA_LIMIT_REACHED'
      | 'CATALOG_MEDIA_OWNERSHIP_CONFLICT'
      | 'CATALOG_REVISION_CONFLICT',
  ) {
    super({
      status: 409,
      code,
      message:
        code === 'CATALOG_MEDIA_LIMIT_REACHED'
          ? 'The catalog resource already has the maximum number of media assets.'
          : code === 'CATALOG_REVISION_CONFLICT'
            ? 'The catalog resource changed after it was loaded.'
            : 'The catalog media asset does not belong to the supplied resource or order.',
    });
  }
}

type Transaction = Prisma.TransactionClient;
type MediaRow = Readonly<{
  id: string;
  resourceType: CatalogMediaResourceType;
  resourceId: string;
  objectKey: string;
  checksumSha256: string;
  contentType: string;
  sizeBytes: number;
  alternativeText: string;
  displayOrder: number;
}>;

export function createCatalogMediaService(
  prisma: PrismaClient,
  storage: StorageProvider,
): CatalogMediaService {
  const service: CatalogMediaService = {
    async upload(input) {
      const validated = validateUploadInput(input);
      await requireResource(prisma, validated.resourceType, validated.resourceId);
      const stored = await storage.put(storageCommand(validated));
      try {
        const asset = await prisma.$transaction(async (transaction) => {
          await requireResource(transaction, validated.resourceType, validated.resourceId);
          const attachedCount = await transaction.catalogMediaAsset.count({
            where: {
              resourceType: validated.resourceType,
              resourceId: validated.resourceId,
              detachedAt: null,
            },
          });
          if (attachedCount >= CATALOG_LIMITS.mediaPerResource.max) {
            throw new CatalogMediaConflictError('CATALOG_MEDIA_LIMIT_REACHED');
          }
          const created = await transaction.catalogMediaAsset.create({
            data: mediaData(validated, stored, attachedCount + 1),
          });
          await appendAudit(transaction, validated.context, {
            action: 'catalog.media-attached',
            entityId: validated.assetId,
            metadata: {
              resourceId: validated.resourceId,
              resourceType: validated.resourceType,
            },
          });
          return created;
        });
        return signAsset(storage, asset);
      } catch (error: unknown) {
        await deleteOrphan(prisma, storage, stored);
        throw mapMediaConflict(error);
      }
    },

    async replace(input) {
      const validated = validateUploadInput(input);
      await requireResource(prisma, validated.resourceType, validated.resourceId);
      const stored = await storage.put(storageCommand(validated));
      let detached: MediaRow | undefined;
      try {
        const replacement = await prisma.$transaction(async (transaction) => {
          await requireResource(transaction, validated.resourceType, validated.resourceId);
          const oldAsset = await transaction.catalogMediaAsset.findFirst({
            where: {
              id: input.oldAssetId,
              resourceType: validated.resourceType,
              resourceId: validated.resourceId,
              detachedAt: null,
            },
          });
          if (oldAsset === null) {
            throw new CatalogMediaConflictError('CATALOG_MEDIA_OWNERSHIP_CONFLICT');
          }
          const detachedAt = new Date();
          const created = await transaction.catalogMediaAsset.create({
            data: {
              ...mediaData(validated, stored, oldAsset.displayOrder),
              detachedAt,
            },
          });
          await transaction.catalogMediaAsset.update({
            where: { id: oldAsset.id },
            data: { detachedAt },
          });
          const attached = await transaction.catalogMediaAsset.update({
            where: { id: created.id },
            data: { detachedAt: null },
          });
          await appendAudit(transaction, validated.context, {
            action: 'catalog.media-replaced',
            entityId: created.id,
            metadata: {
              detachedAssetId: oldAsset.id,
              resourceId: validated.resourceId,
              resourceType: validated.resourceType,
            },
          });
          detached = oldAsset;
          return attached;
        });
        if (detached !== undefined) {
          await deleteIfUnreferenced(prisma, storage, detached);
        }
        return signAsset(storage, replacement);
      } catch (error: unknown) {
        await deleteOrphan(prisma, storage, stored);
        throw mapMediaConflict(error);
      }
    },

    async reorder(input) {
      const resourceType = validateResourceType(input.resourceType);
      if (new Set(input.assetIds).size !== input.assetIds.length) {
        throw new CatalogMediaConflictError('CATALOG_MEDIA_OWNERSHIP_CONFLICT');
      }
      await prisma.$transaction(
        async (transaction) => {
          if (input.expectedRevision !== undefined) {
            await claimResourceRevision(
              transaction,
              resourceType,
              input.resourceId,
              input.expectedRevision,
              input.context.actorId,
            );
          }
          await requireResource(transaction, resourceType, input.resourceId);
          const attached = await transaction.catalogMediaAsset.findMany({
            where: { resourceType, resourceId: input.resourceId, detachedAt: null },
            orderBy: { displayOrder: 'asc' },
          });
          const attachedIds = new Set(attached.map(({ id }) => id));
          if (
            attached.length !== input.assetIds.length ||
            input.assetIds.some((assetId) => !attachedIds.has(assetId))
          ) {
            throw new CatalogMediaConflictError('CATALOG_MEDIA_OWNERSHIP_CONFLICT');
          }
          const transitionAt = new Date();
          const detachedResult = await transaction.catalogMediaAsset.updateMany({
            where: { resourceType, resourceId: input.resourceId, detachedAt: null },
            data: { detachedAt: transitionAt },
          });
          if (detachedResult.count !== attached.length) {
            throw new CatalogMediaConflictError('CATALOG_MEDIA_OWNERSHIP_CONFLICT');
          }
          for (const [index, assetId] of input.assetIds.entries()) {
            await transaction.catalogMediaAsset.update({
              where: { id: assetId },
              data: { displayOrder: index + 1 },
            });
          }
          const attachedResult = await transaction.catalogMediaAsset.updateMany({
            where: {
              resourceType,
              resourceId: input.resourceId,
              detachedAt: transitionAt,
              id: { in: [...input.assetIds] },
            },
            data: { detachedAt: null },
          });
          if (attachedResult.count !== attached.length) {
            throw new CatalogMediaConflictError('CATALOG_MEDIA_OWNERSHIP_CONFLICT');
          }
          await appendAudit(transaction, input.context, {
            action: 'catalog.media-reordered',
            entityId: input.resourceId,
            metadata: { resourceId: input.resourceId, resourceType },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    },

    async listSigned(resourceTypeInput, resourceId) {
      const resourceType = validateResourceType(resourceTypeInput);
      await requireResource(prisma, resourceType, resourceId);
      const assets = await prisma.catalogMediaAsset.findMany({
        where: { resourceType, resourceId, detachedAt: null },
        orderBy: { displayOrder: 'asc' },
      });
      return Object.freeze(await Promise.all(assets.map((asset) => signAsset(storage, asset))));
    },
  };
  return Object.freeze(service);
}

async function claimResourceRevision(
  transaction: Transaction,
  resourceType: CatalogMediaResourceType,
  resourceId: string,
  expectedRevision: number,
  actorId: string,
): Promise<void> {
  const data = { revision: { increment: 1 }, updatedByAccountId: actorId } as const;
  let count: number;
  switch (resourceType) {
    case 'RESTAURANT_PROFILE':
      count = (
        await transaction.restaurantProfile.updateMany({
          where: { id: resourceId, revision: expectedRevision },
          data,
        })
      ).count;
      break;
    case 'HALL':
      count = (
        await transaction.hall.updateMany({
          where: { id: resourceId, revision: expectedRevision },
          data,
        })
      ).count;
      break;
    case 'DISH_VERSION':
      count = (
        await transaction.dishVersion.updateMany({
          where: { id: resourceId, revision: expectedRevision, state: 'DRAFT' },
          data: { revision: { increment: 1 } },
        })
      ).count;
      break;
    case 'MENU_PACKAGE_VERSION':
      count = (
        await transaction.menuPackageVersion.updateMany({
          where: { id: resourceId, revision: expectedRevision, state: 'DRAFT' },
          data: { revision: { increment: 1 } },
        })
      ).count;
      break;
    case 'TIMELINE_TEMPLATE_VERSION':
      count = (
        await transaction.timelineTemplateVersion.updateMany({
          where: { id: resourceId, revision: expectedRevision, state: 'DRAFT' },
          data: { revision: { increment: 1 } },
        })
      ).count;
      break;
    case 'LAYOUT_TEMPLATE_VERSION':
      count = (
        await transaction.layoutTemplateVersion.updateMany({
          where: { id: resourceId, revision: expectedRevision, state: 'DRAFT' },
          data: { revision: { increment: 1 } },
        })
      ).count;
      break;
  }
  if (count !== 1) throw new CatalogMediaConflictError('CATALOG_REVISION_CONFLICT');
}

function validateUploadInput(input: UploadCatalogMediaInput): UploadCatalogMediaInput {
  return Object.freeze({
    ...input,
    resourceType: validateResourceType(input.resourceType),
    alternativeText: validateMediaAlternativeText(input.alternativeText),
  });
}

function validateResourceType(value: CatalogMediaResourceType): CatalogMediaResourceType {
  if (!catalogMediaResourceTypes.includes(value)) {
    throw new ValidationError([
      {
        path: 'resourceType',
        code: 'invalid_value',
        message: 'Catalog media resource type is not allowlisted.',
      },
    ]);
  }
  return value;
}

function storageCommand(input: UploadCatalogMediaInput) {
  return {
    bytes: input.bytes,
    contentType: input.contentType,
    purpose: CATALOG_PLATFORM_POLICY.storagePurpose,
    resourceId: input.resourceId,
  } as const;
}

function mediaData(input: UploadCatalogMediaInput, stored: StoredObject, displayOrder: number) {
  return {
    id: input.assetId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    objectKey: stored.objectKey,
    checksumSha256: stored.checksumSha256,
    contentType: stored.contentType,
    sizeBytes: stored.sizeBytes,
    alternativeText: input.alternativeText,
    displayOrder,
    createdByAccountId: input.context.actorId,
  } as const;
}

async function signAsset(storage: StorageProvider, asset: MediaRow): Promise<CatalogMediaView> {
  const reference = createStorageObjectReference({
    objectKey: asset.objectKey,
    purpose: CATALOG_PLATFORM_POLICY.storagePurpose,
    resourceId: asset.resourceId,
  });
  const signedUrl = await storage.createSignedReadUrl(
    reference,
    CATALOG_PLATFORM_POLICY.signedReadTtlSeconds,
  );
  if (
    asset.contentType !== 'image/jpeg' &&
    asset.contentType !== 'image/png' &&
    asset.contentType !== 'image/webp'
  ) {
    throw new ValidationError();
  }
  return Object.freeze({
    id: asset.id,
    resourceType: asset.resourceType,
    resourceId: asset.resourceId,
    contentType: asset.contentType,
    sizeBytes: asset.sizeBytes,
    alternativeText: asset.alternativeText,
    displayOrder: asset.displayOrder,
    signedUrl,
    signedUrlExpiresInSeconds: CATALOG_PLATFORM_POLICY.signedReadTtlSeconds,
  });
}

async function requireResource(
  prisma: PrismaClient | Transaction,
  resourceType: CatalogMediaResourceType,
  resourceId: string,
): Promise<void> {
  let count: number;
  switch (resourceType) {
    case 'RESTAURANT_PROFILE':
      count = await prisma.restaurantProfile.count({ where: { id: resourceId } });
      break;
    case 'HALL':
      count = await prisma.hall.count({ where: { id: resourceId } });
      break;
    case 'DISH_VERSION':
      count = await prisma.dishVersion.count({ where: { id: resourceId } });
      break;
    case 'MENU_PACKAGE_VERSION':
      count = await prisma.menuPackageVersion.count({ where: { id: resourceId } });
      break;
    case 'TIMELINE_TEMPLATE_VERSION':
      count = await prisma.timelineTemplateVersion.count({ where: { id: resourceId } });
      break;
    case 'LAYOUT_TEMPLATE_VERSION':
      count = await prisma.layoutTemplateVersion.count({ where: { id: resourceId } });
      break;
  }
  if (count !== 1) throw new NotFoundError();
}

async function deleteOrphan(
  prisma: PrismaClient,
  storage: StorageProvider,
  object: StoredObject,
): Promise<void> {
  try {
    await deleteIfUnreferenced(prisma, storage, object);
  } catch {
    // Keep the original transaction/provider failure authoritative. A referenced object
    // is never deleted, and a failed cleanup remains available to a later orphan job.
  }
}

async function deleteIfUnreferenced(
  prisma: PrismaClient,
  storage: StorageProvider,
  object: Readonly<{ objectKey: string; resourceId: string }>,
): Promise<void> {
  const references = await prisma.catalogMediaAsset.count({
    where: { objectKey: object.objectKey, detachedAt: null },
  });
  if (references === 0) {
    await storage.delete(
      createStorageObjectReference({
        objectKey: object.objectKey,
        purpose: CATALOG_PLATFORM_POLICY.storagePurpose,
        resourceId: object.resourceId,
      }),
    );
  }
}

function mapMediaConflict(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new CatalogMediaConflictError('CATALOG_MEDIA_OWNERSHIP_CONFLICT');
  }
  return error;
}

async function appendAudit(
  transaction: Transaction,
  context: CatalogMutationContext,
  event: Readonly<{
    action: string;
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
      entityType: 'catalog-media-asset',
      entityId: event.entityId,
      metadata: event.metadata,
    },
  });
}
