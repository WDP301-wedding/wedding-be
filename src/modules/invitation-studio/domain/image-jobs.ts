import { z } from 'zod';
import { id } from './studio-policy.js';

export const imageJobQuery = z.strictObject({
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const imageJobResult = z.strictObject({
  mediaAssetId: id,
  derivedAssetId: id,
  previewPath: z.string().startsWith('/api/v1/bookings/'),
});
const common = {
  jobId: id,
  intentDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  statusPath: z.string().startsWith('/api/v1/bookings/'),
};
export const imageJobView = z.discriminatedUnion('status', [
  z.strictObject({
    ...common,
    status: z.enum(['QUEUED', 'RUNNING']),
    retryAfterSeconds: z.literal(3),
    result: z.null(),
    errorCode: z.null(),
  }),
  z.strictObject({
    ...common,
    status: z.literal('SUCCEEDED'),
    retryAfterSeconds: z.null(),
    result: imageJobResult,
    errorCode: z.null(),
  }),
  z.strictObject({
    ...common,
    status: z.enum(['RECOVERY_REQUIRED', 'FAILED']),
    retryAfterSeconds: z.null(),
    result: z.null(),
    errorCode: z.string().regex(/^[A-Z][A-Z0-9_]*$/u),
  }),
]);
export const imageJobResponse = z.strictObject({ data: imageJobView });
export const imageJobListResponse = z.strictObject({
  data: z.strictObject({ items: z.array(imageJobView).max(100), nextCursor: id.nullable() }),
});
