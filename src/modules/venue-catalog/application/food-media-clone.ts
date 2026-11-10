import { ProviderError } from '../../../core/errors/app-error.js';
import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import {
  createStoredObject,
  createStorageObjectReference,
  type StorageProvider,
  type StoredObject,
} from '../../../integrations/storage/storage-provider.js';
import { storageContentTypeSchema } from '../../../integrations/storage/storage.schemas.js';
import type { CatalogMutationContext } from '../infrastructure/catalog-version.repository.js';

/** The destination lock covers copying and persistence, including competing idempotency keys.
 * Each copy belongs to its new version; replacing it cannot delete historical images.
 */
export async function withClonedFoodMedia(
  prisma: PrismaClient,
  storage: StorageProvider | undefined,
  resourceType: 'DISH_VERSION' | 'MENU_PACKAGE_VERSION',
  input: Readonly<{ sourceVersionId: string; versionId: string; context: CatalogMutationContext }>,
  persist: (
    transaction: Prisma.TransactionClient,
    assets: readonly Prisma.CatalogMediaAssetCreateManyInput[],
  ) => Promise<void>,
): Promise<void> {
  const copied: StoredObject[] = [];
  const assets: Prisma.CatalogMediaAssetCreateManyInput[] = [];
  try {
    await prisma.$transaction(
      async (transaction) => {
        await lockDestination(transaction, input.versionId);
        const sources = await transaction.catalogMediaAsset.findMany({
          where: { resourceType, resourceId: input.sourceVersionId, detachedAt: null },
          orderBy: { displayOrder: 'asc' },
        });
        for (const source of sources) {
          if (!storage?.read) throw new ProviderError('unavailable');
          const bytes = await storage.read(
            createStorageObjectReference({
              objectKey: source.objectKey,
              purpose: 'VENUE_CATALOG_MEDIA',
              resourceId: input.sourceVersionId,
            }),
          );
          const command = {
            bytes,
            contentType: storageContentTypeSchema.parse(source.contentType),
            purpose: 'VENUE_CATALOG_MEDIA' as const,
            resourceId: input.versionId,
            catalogResourceType: resourceType,
          };
          const expected = createStoredObject(command);
          if (
            expected.checksumSha256 !== source.checksumSha256 ||
            expected.sizeBytes !== source.sizeBytes
          ) {
            throw new ProviderError('failure');
          }
          // Track before put: a provider timeout may still have written the object.
          copied.push(expected);
          const stored = await storage.put(command);
          if (
            stored.objectKey !== expected.objectKey ||
            stored.resourceId !== input.versionId ||
            stored.checksumSha256 !== expected.checksumSha256 ||
            stored.sizeBytes !== expected.sizeBytes ||
            stored.contentType !== expected.contentType ||
            stored.purpose !== expected.purpose
          ) {
            throw new ProviderError('failure');
          }
          assets.push({
            resourceType,
            resourceId: input.versionId,
            objectKey: expected.objectKey,
            checksumSha256: expected.checksumSha256,
            contentType: expected.contentType,
            sizeBytes: expected.sizeBytes,
            alternativeText: source.alternativeText,
            displayOrder: source.displayOrder,
            createdByAccountId: input.context.actorId,
          });
        }
        await persist(transaction, assets);
      },
      { timeout: 60_000 },
    );
  } catch (error: unknown) {
    if (copied.length > 0 && storage) {
      try {
        await prisma.$transaction(
          async (transaction) => {
            await lockDestination(transaction, input.versionId);
            for (const object of copied) {
              // Recheck after taking the same lock: another attempt may have committed.
              const references = await transaction.catalogMediaAsset.count({
                where: { objectKey: object.objectKey },
              });
              if (references === 0) await storage.delete(object);
            }
          },
          { timeout: 60_000 },
        );
      } catch {
        // Keep the original failure; a later orphan cleanup can retry safely.
      }
    }
    throw error;
  }
}

async function lockDestination(
  transaction: Prisma.TransactionClient,
  versionId: string,
): Promise<void> {
  await transaction.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${'catalog-food-media:' + versionId}, 0))`,
  );
}
