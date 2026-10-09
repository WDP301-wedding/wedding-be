import { z } from 'zod';
import {
  id,
  revision,
  designContentSchema,
  designViewSchema,
  textFieldsSchema,
} from '../domain/studio-policy.js';
import { generateAiImageCommandSchema } from '../../../integrations/ai-image/ai-image.schemas.js';
import { publicInvitationSchema } from '../domain/public-invitation.js';
export {
  generationIntentDigest,
  generationRecoveryQuery,
  generationReconcileBody,
  generationPendingResponse,
  generationReconcileResponse,
} from '../domain/generation-recovery.js';
export const createDesignBody = z
  .strictObject({ templateId: id.optional(), content: designContentSchema.optional() })
  .refine((v) => (v.templateId === undefined) !== (v.content === undefined));
export const editDesignBody = z
  .strictObject({
    expectedRevision: revision,
    content: designContentSchema.optional(),
    textFields: textFieldsSchema.optional(),
  })
  .refine((v) => (v.content === undefined) !== (v.textFields === undefined));
export const templateBody = z.strictObject({
  expectedRevision: z.int().nonnegative(),
  active: z.boolean(),
  content: designContentSchema,
});
export const publishBody = z.strictObject({
  expectedRevision: revision,
  designRevisionId: id,
  expectedPublicationRevision: z.int().nonnegative(),
});
export const unpublishBody = z.strictObject({ expectedRevision: revision });
export const deriveBody = z.strictObject({ mediaAssetId: id, expectedRevision: revision });
export const generationBody = generateAiImageCommandSchema;
export const pageQuery = z.strictObject({
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const templateQuery = pageQuery.extend({
  bookingId: id.optional(),
  includeArchived: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default(false),
});
export const templateView = designContentSchema.safeExtend({
  templateId: id,
  versionId: id,
  revisionNumber: revision,
  active: z.boolean().optional(),
});
export const designResponse = z.strictObject({ data: designViewSchema });
export const designListResponse = z.strictObject({
  data: z.strictObject({ items: z.array(designViewSchema).max(100), nextCursor: id.nullable() }),
});
export const templateResponse = z.strictObject({ data: templateView });
export const templateListResponse = z.strictObject({
  data: z.strictObject({ items: z.array(templateView).max(100), nextCursor: id.nullable() }),
});
export const publicationResponse = z.strictObject({
  data: z.strictObject({
    publicInvitationId: id,
    publicSlug: z.string().regex(/^[a-f0-9]{64}$/u),
    publishedRevisionId: id,
    publicationRevision: revision,
    genericQrPayload: z.url(),
  }),
});
export const unpublicationResponse = z.strictObject({
  data: z.strictObject({
    publicInvitationId: id,
    publicationRevision: revision,
    published: z.literal(false),
  }),
});
export const derivedResponse = z.strictObject({
  data: z.strictObject({
    derivedAssetId: id,
    width: z.int().min(1).max(2048),
    height: z.int().min(1).max(2048),
    contentType: z.literal('image/png'),
  }),
});
export const publicResponse = z.strictObject({ data: publicInvitationSchema });
