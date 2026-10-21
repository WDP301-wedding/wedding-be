import type { ZodOpenApiObject } from 'zod-openapi';
import { z } from 'zod';
import * as s from './studio.schemas.js';
import { mediaAssetResponseSchema } from './media.schemas.js';
import * as jobs from '../domain/image-jobs.js';
const errors = Object.fromEntries(
  ['400', '401', '403', '404', '409', '422', '429', '500', '502', '503', '504'].map((status, i) => [
    status,
    {
      $ref: `#/components/responses/${['BadRequest', 'Unauthorized', 'Forbidden', 'NotFound', 'Conflict', 'UnprocessableEntity', 'TooManyRequests', 'InternalServerError', 'BadGateway', 'ServiceUnavailable', 'GatewayTimeout'][i]}`,
    },
  ]),
);
function operation(
  operationId: string,
  summary: string,
  response: z.ZodType,
  params: string[],
  body?: z.ZodType,
  status = '200',
  publicRead = false,
) {
  return {
    operationId,
    summary,
    tags: ['Invitation Studio'],
    security: publicRead ? [] : [{ bearerAuth: [] }],
    parameters: [
      ...params.map((name) => ({
        name,
        in: 'path' as const,
        required: true,
        schema: {
          type: 'string' as const,
          ...(name === 'slug' || name === 'intentDigest'
            ? { pattern: '^[a-f0-9]{64}$' }
            : { format: 'uuid' }),
        },
      })),
      ...(body === undefined ? [] : [{ $ref: '#/components/parameters/IdempotencyKey' }]),
    ],
    ...(body === undefined
      ? {}
      : { requestBody: { required: true, content: { 'application/json': { schema: body } } } }),
    responses: {
      [status]: {
        description: 'Validated response.',
        content: { 'application/json': { schema: response } },
      },
      ...errors,
    },
  };
}
function list(operationId: string, response: z.ZodType, query: z.ZodObject) {
  return {
    ...operation(operationId, 'Bounded current authorized list', response, []),
    requestParams: { query },
  };
}
export const invitationStudioOpenApiPaths = {
  '/bookings/{bookingId}/invitation-image-jobs': {
    post: {
      ...operation(
        'enqueueInvitationImageJob',
        'Owning FULL Couple enqueues generation and derive without waiting for AI',
        jobs.imageJobResponse,
        ['bookingId'],
        s.generationBody,
        '202',
      ),
      description:
        'Requires AI_IMAGE_JOBS_ENABLED=true. Same key/body returns current job without paid dispatch in this request. At most 2 unresolved jobs and 10 new jobs per rolling 24 hours per booking. Unknown effects require explicit recovery; no automatic paid retry. Legacy synchronous generation is unchanged.',
      responses: {
        ...operation('unused', '', jobs.imageJobResponse, [], undefined, '202').responses,
        '202': {
          description: 'Durable job accepted or replayed.',
          headers: {
            Location: { schema: { type: 'string' } },
            'Retry-After': { schema: { type: 'string' } },
          },
          content: { 'application/json': { schema: jobs.imageJobResponse } },
        },
      },
    },
    get: {
      ...operation(
        'listInvitationImageJobs',
        'Current owning FULL Couple or Manager lists all job states, newest first',
        jobs.imageJobListResponse,
        ['bookingId'],
      ),
      requestParams: { query: jobs.imageJobQuery },
    },
  },
  '/bookings/{bookingId}/invitation-image-jobs/{jobId}': {
    get: operation(
      'getInvitationImageJob',
      'Current owning FULL Couple or Manager reads job state and completed private result',
      jobs.imageJobResponse,
      ['bookingId', 'jobId'],
    ),
  },
  '/bookings/{bookingId}/invitation-image-jobs/{jobId}/reconciliation': {
    post: operation(
      'abandonInvitationImageJob',
      'Manager abandons an unresolved job with evidence, retaining paid output and history',
      jobs.imageJobResponse,
      ['bookingId', 'jobId'],
      s.generationReconcileBody,
    ),
  },
  '/bookings/{bookingId}/invitation-image-jobs/{jobId}/recovery': {
    post: {
      ...operation(
        'recoverInvitationImageJob',
        'Explicitly requeue unresolved work using the same durable generation intent',
        jobs.imageJobResponse,
        ['bookingId', 'jobId'],
        z.strictObject({}),
        '202',
      ),
      description:
        'Current owning FULL Couple or Manager. Retain Idempotency-Key on retries. Recovery never repeats an existing paid intent; a missing journal remains RECOVERY_REQUIRED. Input expires after 24 hours. Manager abandonment remains on the evidence-backed generation reconciliation API.',
    },
  },
  '/bookings/{bookingId}/printable-revisions/{printableRevisionId}/file': {
    get: {
      operationId: 'getPrintableInvitationFile',
      summary: 'Manager or owning FULL Couple previews/downloads the exact accepted A5 revision',
      description:
        'Two pages, 148x210 mm trim, 3 mm bleed, embedded Vietnamese fonts, raster placement at least 300 dpi, 30 mm vector generic QR with quiet zone. invitation-a5-v1 for existing invitations without Seating; invitation-a5-v2-seating renders retained fixed geometry, table labels and a textual Group/color legend. No current-design fallback or extra charge. 8 PNG assets/16 MiB images/12 MiB PDF; oversized or illegible content fails 422. Retained checksum failures fail 502/503. Existing confirmed-booking Invitation access policy applies.',
      tags: ['Invitation Studio'],
      security: [{ bearerAuth: [] }],
      requestParams: {
        query: z.strictObject({ disposition: z.enum(['inline', 'attachment']).default('inline') }),
      },
      parameters: ['bookingId', 'printableRevisionId'].map((name) => ({
        name,
        in: 'path' as const,
        required: true,
        schema: { type: 'string' as const, format: 'uuid' },
      })),
      responses: {
        '200': {
          description:
            'Immutable printable PDF bytes. Inline and attachment have identical content.',
          headers: {
            'Access-Control-Expose-Headers': {
              schema: { type: 'string', const: s.PRINT_FILE_EXPOSED_HEADERS },
            },
            'X-Content-SHA256': { schema: { type: 'string', pattern: '^[a-f0-9]{64}$' } },
            'X-Printable-Content-Digest': { schema: { type: 'string', pattern: '^[a-f0-9]{64}$' } },
            'X-Renderer-Version': {
              schema: { type: 'string', enum: ['invitation-a5-v1', 'invitation-a5-v2-seating'] },
            },
            'Content-Disposition': { schema: { type: 'string' } },
            'Cache-Control': { schema: { type: 'string', const: 'private, no-store' } },
          },
          content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
        },
        ...errors,
      },
    },
  },
  '/invitation-templates': {
    get: list('listInvitationTemplates', s.templateListResponse, s.templateQuery),
  },
  '/management/invitation-templates': {
    get: list('listManagedInvitationTemplates', s.templateListResponse, s.templateQuery),
    post: operation(
      'createInvitationTemplate',
      'Manager creates a versioned invitation template',
      s.templateResponse,
      [],
      s.templateBody,
      '201',
    ),
  },
  '/management/invitation-templates/{templateId}': {
    get: {
      ...operation(
        'getInvitationTemplate',
        'Manager reads current or immutable historical template',
        s.templateResponse,
        ['templateId'],
      ),
      requestParams: { query: z.strictObject({ versionId: z.uuid().optional() }) },
    },
    patch: operation(
      'reviseInvitationTemplate',
      'Manager revises or archives a template with CAS',
      s.templateResponse,
      ['templateId'],
      s.templateBody,
    ),
  },
  '/bookings/{bookingId}/invitations': {
    get: {
      ...list('listWeddingInvitations', s.designListResponse, s.pageQuery),
      parameters: operation('unused', '', s.designListResponse, ['bookingId']).parameters,
    },
    post: operation(
      'createWeddingInvitation',
      'Own FULL Couple creates structured design; Web editor only',
      s.designResponse,
      ['bookingId'],
      s.createDesignBody,
      '201',
    ),
  },
  '/bookings/{bookingId}/invitations/{designId}': {
    get: operation(
      'getWeddingInvitation',
      'Own FULL Couple or Manager reads current private design',
      s.designResponse,
      ['bookingId', 'designId'],
    ),
  },
  '/bookings/{bookingId}/invitations/{designId}/revisions': {
    post: operation(
      'reviseWeddingInvitation',
      'Immutable design revision with CAS; Android textFields only',
      s.designResponse,
      ['bookingId', 'designId'],
      s.editDesignBody,
      '201',
    ),
  },
  '/bookings/{bookingId}/invitations/{designId}/publication': {
    post: operation(
      'publishWeddingInvitation',
      'Explicit publication of exact current design and publication revisions',
      s.publicationResponse,
      ['bookingId', 'designId'],
      s.publishBody,
    ),
    delete: operation(
      'unpublishWeddingInvitation',
      'Conceal current publication and assets, retain immutable history',
      s.unpublicationResponse,
      ['bookingId', 'designId'],
      s.unpublishBody,
    ),
  },
  '/bookings/{bookingId}/invitation-image-generations': {
    get: {
      ...operation(
        'listPendingInvitationImageGenerations',
        'Manager reads bounded unresolved intents without prompts or credentials',
        s.generationPendingResponse,
        ['bookingId'],
      ),
      requestParams: { query: s.generationRecoveryQuery },
    },
    post: operation(
      'generateWeddingInvitationImage',
      'One private PNG from a bounded safe prompt; unknown effect requires reconciliation',
      mediaAssetResponseSchema,
      ['bookingId'],
      s.generationBody,
      '201',
    ),
  },
  '/bookings/{bookingId}/invitation-image-generations/{intentDigest}/reconciliation': {
    post: operation(
      'reconcileInvitationImageGeneration',
      'Manager abandons an unresolved effect with evidence; never retries the paid provider',
      s.generationReconcileResponse,
      ['bookingId', 'intentDigest'],
      s.generationReconcileBody,
    ),
  },
  '/bookings/{bookingId}/invitation-derived-assets': {
    post: operation(
      'deriveWeddingInvitationAsset',
      'Create separate metadata-stripped bounded PNG from an own private original',
      s.derivedResponse,
      ['bookingId'],
      s.deriveBody,
      '201',
    ),
  },
  '/public/invitations/{slug}': {
    get: operation(
      'getPublicInvitation',
      'Minimal explicitly published invitation; read-only public content',
      s.publicResponse,
      ['slug'],
      undefined,
      '200',
      true,
    ),
  },
  '/public/invitations/{slug}/render': {
    get: {
      ...operation(
        'renderPublicInvitation',
        'Escaped allowlisted public HTML',
        s.publicResponse,
        ['slug'],
        undefined,
        '200',
        true,
      ),
      responses: {
        '200': {
          description: 'Public HTML with restrictive CSP and no-store.',
          content: { 'text/html': { schema: z.string() } },
        },
        ...errors,
      },
    },
  },
  '/public/invitations/{slug}/qr': {
    get: {
      ...operation(
        'getPublicInvitationQr',
        'Stable generic QR PNG shared by every booking variant',
        s.publicResponse,
        ['slug'],
        undefined,
        '200',
        true,
      ),
      responses: {
        '200': {
          description: 'Generic QR PNG, no-store.',
          content: { 'image/png': { schema: z.string().meta({ format: 'binary' }) } },
        },
        ...errors,
      },
    },
  },
  '/public/invitation-assets/{slug}': {
    get: {
      ...operation(
        'getPublicInvitationAsset',
        'Only derived PNG referenced by a current publication',
        s.publicResponse,
        ['slug'],
        undefined,
        '200',
        true,
      ),
      responses: {
        '200': {
          description: 'Derived PNG, no-store.',
          content: { 'image/png': { schema: z.string().meta({ format: 'binary' }) } },
        },
        ...errors,
      },
    },
  },
} satisfies NonNullable<ZodOpenApiObject['paths']>;
export const invitationStudioOpenApiSchemas = {
  WeddingInvitation: s.designResponse,
  WeddingInvitationPublication: s.publicationResponse,
  PublicWeddingInvitation: s.publicResponse,
  InvitationTemplate: s.templateResponse,
  InvitationDerivedAsset: s.derivedResponse,
};
