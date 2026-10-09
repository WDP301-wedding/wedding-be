import { z } from 'zod';

export const mediaParamsSchema = z.strictObject({
  bookingId: z.uuid(),
  assetId: z.uuid().optional(),
});
export const mediaUploadFieldsSchema = z.strictObject({
  altText: z.string().min(1).max(250),
  expectedRevision: z
    .string()
    .regex(/^[1-9]\d*$/u)
    .transform(Number)
    .pipe(z.number().int().positive())
    .optional(),
});
export const mediaMetadataBodySchema = z.strictObject({
  altText: z.string().min(1).max(250),
  expectedRevision: z.number().int().positive(),
});
export const mediaDetachBodySchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
});
export const mediaCutoffBodySchema = z.strictObject({
  cutoffAt: z.iso.datetime(),
  expectedRevision: z.number().int().nonnegative(),
});
export const mediaAssetViewSchema = z.strictObject({
  mediaAssetId: z.uuid(),
  revision: z.number().int().positive(),
  detachedAt: z.iso.datetime().nullable(),
  previewPath: z.string().regex(/^\/api\/v1\/bookings\/[a-f0-9-]+\/media\/[a-f0-9-]+$/u),
});
export const mediaAssetResponseSchema = z.strictObject({ data: mediaAssetViewSchema });
export const mediaPreviewResponseSchema = z.strictObject({
  data: z.strictObject({
    asset: mediaAssetViewSchema,
    altText: z.string().min(1).max(250),
    signedUrl: z.url(),
    expiresInSeconds: z.literal(900),
  }),
});
export const mediaPolicyResponseSchema = z.strictObject({
  data: z.strictObject({ revision: z.number().int().positive(), cutoffAt: z.iso.datetime() }),
});
