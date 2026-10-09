import { z } from 'zod';

import { AppError, ValidationError } from '../../../core/errors/app-error.js';
import { validatePutObjectCommand } from '../../../integrations/storage/storage-provider.js';
import {
  parseStorageInput,
  storageContentTypeSchema,
} from '../../../integrations/storage/storage.schemas.js';
import type { MediaImageInspector, MediaState } from '../application/media.contracts.js';

export const MEDIA_LIMITS = Object.freeze({
  fileBytes: 25 * 1024 * 1024,
  activeFiles: 100,
  activeBytes: 1024 * 1024 * 1024,
  maxDimension: 12_000,
  maxPixels: 40_000_000,
  cutoffLeadMs: 72 * 60 * 60 * 1000,
  signedReadSeconds: 15 * 60,
});
// Match Core Storage/PostgreSQL UUID canonicalisation before digest/lock/map keys.
export const mediaUuidSchema = z.uuid().transform((id) => id.toLowerCase());

export const mediaUploadSchema = z
  .strictObject({
    bookingId: mediaUuidSchema,
    assetId: mediaUuidSchema.optional(),
    expectedRevision: z.number().int().positive().optional(),
    bytes: z.instanceof(Uint8Array),
    contentType: storageContentTypeSchema,
    altText: z.string().min(1).max(250),
    idempotencyKey: z.string().min(1).max(128),
  })
  .refine(
    (x) => (x.assetId === undefined) === (x.expectedRevision === undefined),
    'Replacement requires both assetId and expectedRevision.',
  );

export function mediaConflict(code: string): AppError {
  return new AppError({
    status: 409,
    code,
    message: 'The media command conflicts with current state.',
  });
}

export async function inspectMedia(
  input: z.infer<typeof mediaUploadSchema>,
  inspector: MediaImageInspector,
): Promise<{ readonly width: number; readonly height: number }> {
  validatePutObjectCommand({
    bytes: input.bytes,
    contentType: input.contentType,
    purpose: 'PRIVATE_WEDDING_MEDIA',
    resourceId: input.bookingId,
  });
  const dimensions = await inspector.inspect(input.bytes, MEDIA_LIMITS);
  const result = z
    .strictObject({
      contentType: storageContentTypeSchema,
      width: z.number().int().min(1).max(MEDIA_LIMITS.maxDimension),
      height: z.number().int().min(1).max(MEDIA_LIMITS.maxDimension),
    })
    .safeParse(dimensions);
  if (
    !result.success ||
    dimensions.contentType !== input.contentType ||
    dimensions.width * dimensions.height > MEDIA_LIMITS.maxPixels
  )
    throw new ValidationError();
  return { width: dimensions.width, height: dimensions.height };
}

export function claimMediaQuota(
  state: MediaState,
  newBytes: number,
  replacedAssetId?: string,
): void {
  let files = 1;
  let bytes = newBytes;
  for (const asset of state.assets.values()) {
    if (asset.detachedAt !== null || asset.id === replacedAssetId) continue;
    const current = state.files.get(asset.currentFileRevisionId);
    if (current === undefined) throw new Error('Missing accepted media revision.');
    files++;
    bytes += current.object.sizeBytes;
  }
  if (files > MEDIA_LIMITS.activeFiles || bytes > MEDIA_LIMITS.activeBytes) {
    throw mediaConflict('MEDIA_QUOTA_EXCEEDED');
  }
}

export function parseMediaInput<T>(schema: z.ZodType<T>, value: unknown): T {
  return parseStorageInput(schema, value);
}
