import { z } from 'zod';

import { ValidationError } from '../../core/errors/app-error.js';

export const MAX_STORAGE_OBJECT_BYTES = 25 * 1024 * 1024;
export const storagePurposeSchema = z.enum(['PRIVATE_WEDDING_MEDIA', 'VENUE_CATALOG_MEDIA']);
export const storageContentTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp']);
const resourceIdSchema = z.uuid().transform((resourceId) => resourceId.toLowerCase());

export const putObjectCommandSchema = z
  .strictObject({
    bytes: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength > 0, 'File is empty.'),
    contentType: storageContentTypeSchema,
    purpose: storagePurposeSchema,
    resourceId: resourceIdSchema,
  })
  .superRefine((command, context) => {
    if (command.bytes.byteLength > MAX_STORAGE_OBJECT_BYTES) {
      context.addIssue({
        code: 'custom',
        message: `File exceeds the ${String(MAX_STORAGE_OBJECT_BYTES)} byte storage limit.`,
        path: ['bytes'],
      });
    }

    if (!hasExpectedMagicBytes(command.bytes, command.contentType)) {
      context.addIssue({
        code: 'custom',
        message: 'File content does not match the declared MIME type.',
        path: ['bytes'],
      });
    }
  });

const objectKeyPattern =
  /^(?:private-wedding-media|venue-catalog-media)\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[a-f\d]{64}\.(?:jpg|png|webp)$/u;

export const storageObjectKeySchema = z
  .string()
  .regex(objectKeyPattern)
  .brand<'StorageObjectKey'>();

export const storageObjectReferenceSchema = z
  .object({
    objectKey: storageObjectKeySchema,
    purpose: storagePurposeSchema,
    resourceId: resourceIdSchema,
  })
  .superRefine((reference, context) => {
    const expectedPrefix = `${purposePrefix(reference.purpose)}/${reference.resourceId}/`;
    if (!reference.objectKey.startsWith(expectedPrefix)) {
      context.addIssue({
        code: 'custom',
        message: 'Object key does not belong to the supplied purpose and resource.',
        path: ['objectKey'],
      });
    }
  });

export const signedReadTtlSchema = z.number().int().min(1).max(3600);

export const providerUploadResponseSchema = z.object({
  data: z.object({ path: z.string() }).nullable(),
  error: z.unknown().nullable(),
});

export const providerInfoResponseSchema = z.object({
  data: z
    .object({
      contentType: storageContentTypeSchema,
      metadata: z.object({
        checksumSha256: z.string().regex(/^[a-f\d]{64}$/u),
        purpose: storagePurposeSchema,
        resourceId: resourceIdSchema,
        sizeBytes: z.number().int().positive(),
      }),
      size: z.number().int().positive(),
    })
    .nullable(),
  error: z.unknown().nullable(),
});

export const providerSignedUrlResponseSchema = z.object({
  data: z.object({ signedUrl: z.url() }).nullable(),
  error: z.unknown().nullable(),
});

export const providerRemoveResponseSchema = z.object({
  data: z.array(z.object({ name: z.string() })).nullable(),
  error: z.unknown().nullable(),
});

export type StorageContentType = z.infer<typeof storageContentTypeSchema>;
export type StorageObjectKey = z.infer<typeof storageObjectKeySchema>;
export type StoragePurpose = z.infer<typeof storagePurposeSchema>;

export function parseStorageInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }

  throw new ValidationError(
    result.error.issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      path: issue.path.join('.'),
    })),
  );
}

export function extensionForContentType(contentType: StorageContentType): 'jpg' | 'png' | 'webp' {
  switch (contentType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
  }
}

export function purposePrefix(
  purpose: StoragePurpose,
): 'private-wedding-media' | 'venue-catalog-media' {
  switch (purpose) {
    case 'PRIVATE_WEDDING_MEDIA':
      return 'private-wedding-media';
    case 'VENUE_CATALOG_MEDIA':
      return 'venue-catalog-media';
  }
}

function hasExpectedMagicBytes(bytes: Uint8Array, contentType: StorageContentType): boolean {
  switch (contentType) {
    case 'image/jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case 'image/png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/webp':
      return (
        startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && matchesAt(bytes, 8, [0x57, 0x45, 0x42, 0x50])
      );
  }
}

function startsWith(bytes: Uint8Array, expected: readonly number[]): boolean {
  return matchesAt(bytes, 0, expected);
}

function matchesAt(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((byte, index) => bytes[offset + index] === byte);
}
