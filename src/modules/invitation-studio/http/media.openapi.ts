import { z } from 'zod';
import type { ZodOpenApiObject, ZodOpenApiResponseObject } from 'zod-openapi';
import { errorResponseSchema } from '../../../core/http/common.schemas.js';
import {
  mediaAssetResponseSchema,
  mediaPreviewResponseSchema,
  mediaPolicyResponseSchema,
  mediaUploadFieldsSchema,
  mediaMetadataBodySchema,
  mediaDetachBodySchema,
  mediaCutoffBodySchema,
} from './media.schemas.js';

const noStore = {
  'Cache-Control': { schema: { type: 'string', const: 'no-store' } },
  'x-request-id': { $ref: '#/components/headers/RequestId' },
} as const;
const success = (schema: z.ZodType): ZodOpenApiResponseObject => ({
  description:
    'Authorized private media result. Preview URLs are issued separately and expire after 900 seconds.',
  headers: noStore,
  content: { 'application/json': { schema } },
});
const errors = {
  '400': { $ref: '#/components/responses/BadRequest' },
  '401': { $ref: '#/components/responses/Unauthorized' },
  '404': { $ref: '#/components/responses/NotFound' },
  '408': {
    description:
      'REQUEST_TIMEOUT after the configured server request deadline; reconcile an interrupted write with the same key/body.',
    content: { 'application/json': { schema: errorResponseSchema } },
  },
  '409': {
    description:
      'REQUEST_IN_PROGRESS (Retry-After: 1), MEDIA_REVISION_STALE, MEDIA_POLICY_STALE, MEDIA_CUTOFF_REACHED or MEDIA_QUOTA_EXCEEDED. Retry a pending operation with the same key and body.',
    headers: { ...noStore, 'Retry-After': { $ref: '#/components/headers/RetryAfter' } },
    content: { 'application/json': { schema: errorResponseSchema } },
  },
  '413': {
    description: 'The global JSON or complete multipart body exceeds its limit.',
    content: { 'application/json': { schema: errorResponseSchema } },
  },
  '422': {
    description:
      'Invalid input/image, multiple files, unknown fields/query, missing replacement revision or IDEMPOTENCY_KEY_REUSED. An oversized file reported by the multipart parser is also invalid input.',
    content: { 'application/json': { schema: errorResponseSchema } },
  },
  '429': { $ref: '#/components/responses/TooManyRequests' },
  '500': { $ref: '#/components/responses/InternalServerError' },
  '502': { $ref: '#/components/responses/BadGateway' },
  '503': {
    description:
      'PROVIDER_UNAVAILABLE when Storage is disabled/unavailable, or SERVICE_UNAVAILABLE when a required owner is unavailable.',
    content: { 'application/json': { schema: errorResponseSchema } },
  },
  '504': { $ref: '#/components/responses/GatewayTimeout' },
} satisfies Record<string, ZodOpenApiResponseObject | { $ref: string }>;
const booking = {
  name: 'bookingId',
  in: 'path' as const,
  required: true,
  schema: { type: 'string' as const, format: 'uuid' },
};
const asset = {
  name: 'assetId',
  in: 'path' as const,
  required: true,
  schema: { type: 'string' as const, format: 'uuid' },
};
const key = { $ref: '#/components/parameters/IdempotencyKey' };
const common = { tags: ['Invitation Media'], security: [{ bearerAuth: [] }] };
const file = z.string().meta({
  format: 'binary',
  description:
    'One fully decoded JPEG/PNG/WebP, at most 25MiB; edges at most 12000 and total decoded frame pixels at most 40 million. Original bytes are retained privately.',
});
const upload = mediaUploadFieldsSchema.extend({ file });
const replacement = mediaUploadFieldsSchema.required({ expectedRevision: true }).extend({ file });

export const invitationMediaOpenApiPaths = {
  '/bookings/{bookingId}/media': {
    post: {
      ...common,
      operationId: 'uploadWeddingMedia',
      summary: 'Upload a private wedding original before cutoff',
      description:
        'Couple with current own FULL access and CONFIRMED booking. Maximum 100 active images / 1GiB per booking. Default cutoff is approved event start minus 72 hours. Multipart request including fields/headers is bounded by 25MiB + 64KiB; at most two uploads process concurrently per server. previewPath points to an authorized read and contains no bearer credential.',
      parameters: [booking, key],
      requestBody: { required: true, content: { 'multipart/form-data': { schema: upload } } },
      responses: { '201': success(mediaAssetResponseSchema), ...errors },
    },
  },
  '/bookings/{bookingId}/media/{assetId}': {
    get: {
      ...common,
      operationId: 'getWeddingMediaOriginal',
      summary: 'Get a private original preview/download URL',
      description:
        'Current own FULL Couple or Manager access to a CONFIRMED booking. Manager may read after cutoff. Detached assets are concealed. No query parameters accepted; URL is private and expires after 900 seconds.',
      parameters: [booking, asset],
      responses: { '200': success(mediaPreviewResponseSchema), ...errors },
    },
    patch: {
      ...common,
      operationId: 'updateWeddingMedia',
      summary: 'Change alt text or replace the original before cutoff',
      parameters: [booking, asset, key],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: mediaMetadataBodySchema },
          'multipart/form-data': { schema: replacement },
        },
      },
      responses: { '200': success(mediaAssetResponseSchema), ...errors },
    },
    delete: {
      ...common,
      operationId: 'detachWeddingMedia',
      summary: 'Detach an active image before cutoff while retaining history',
      parameters: [booking, asset, key],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: mediaDetachBodySchema } },
      },
      responses: { '200': success(mediaAssetResponseSchema), ...errors },
    },
  },
  '/management/bookings/{bookingId}/media-policy': {
    patch: {
      ...common,
      operationId: 'changeWeddingMediaCutoff',
      summary: 'Manager changes the media cutoff with before/after audit',
      description:
        'Requires a CONFIRMED booking and current Manager role. expectedRevision is zero for the initial default policy; subsequent updates require the current revision.',
      parameters: [booking, key],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: mediaCutoffBodySchema } },
      },
      responses: { '200': success(mediaPolicyResponseSchema), ...errors },
    },
  },
} satisfies NonNullable<ZodOpenApiObject['paths']>;

export const invitationMediaOpenApiSchemas = {
  WeddingMediaAssetResponse: mediaAssetResponseSchema,
  WeddingMediaPreviewResponse: mediaPreviewResponseSchema,
  WeddingMediaPolicyResponse: mediaPolicyResponseSchema,
};
