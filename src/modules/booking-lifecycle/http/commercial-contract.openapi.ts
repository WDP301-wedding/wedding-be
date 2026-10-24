import type { ZodOpenApiObject } from 'zod-openapi';
import {
  contractDraftSchema,
  contractDecisionSchema,
  contractWithdrawalSchema,
  contractsResponseSchema,
  contractResponseSchema,
  contractPreviewResponseSchema,
} from '../domain/commercial-contract.js';

const security = [{ bearerAuth: [] }];
const parameters = [
  {
    name: 'bookingId',
    in: 'path' as const,
    required: true,
    schema: { type: 'string' as const, format: 'uuid' },
  },
];
const revisionParameter = {
  name: 'revisionId',
  in: 'path' as const,
  required: true,
  schema: { type: 'string' as const, format: 'uuid' },
};
const errors = {
  '400': { $ref: '#/components/responses/IdempotencyKeyRequired' },
  '401': { $ref: '#/components/responses/Unauthorized' },
  '404': { $ref: '#/components/responses/NotFound' },
  '409': { $ref: '#/components/responses/Conflict' },
  '422': { $ref: '#/components/responses/UnprocessableEntity' },
};
const success = {
  description: 'Exact immutable commercial revision and current Booking revision.',
  content: { 'application/json': { schema: contractResponseSchema } },
};
export const commercialContractOpenApiPaths = {
  '/bookings/{bookingId}/contracts/preview': {
    parameters,
    post: {
      operationId: 'previewCommercialContract',
      tags: ['Booking lifecycle'],
      security,
      description:
        'Read-only server-priced draft preview for the owning Manager/Couple. Same revision, predecessor, phase, payment-pin and catalog eligibility guards as draft creation. No saved revision, approval, invoice or financial write. Private no-store. Saving revalidates independently.',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: contractDraftSchema } },
      },
      responses: {
        '200': {
          description: 'Unsaved preview; amounts are integer VND.',
          content: { 'application/json': { schema: contractPreviewResponseSchema } },
        },
        ...errors,
      },
    },
  },
  '/bookings/{bookingId}/contracts': {
    parameters,
    get: {
      operationId: 'listCommercialContracts',
      tags: ['Booking lifecycle'],
      security,
      description:
        'Own Manager or consultation account, including restricted prospect. Staff and cross-scope reads are concealed. Private no-store, newest revisions first, up to 50 per page. eligibleForDeposit expresses commercial/timeline approval readiness; slot/account/payment eligibility is rechecked at reservation.',
      parameters: [{ name: 'cursor', in: 'query', schema: { type: 'string', format: 'uuid' } }],
      responses: {
        '200': {
          description: 'Commercial history; no legacy automatic conversion.',
          content: { 'application/json': { schema: contractsResponseSchema } },
        },
        ...errors,
      },
    },
    post: {
      operationId: 'createCommercialContractRevision',
      tags: ['Booking lifecycle'],
      security,
      description:
        'Explicit FULL_CONTRACT_V1 conversion for uncharged/unsettled legacy drafts, or successor replacing the current revision. expectedRevision is the Booking revision. Null predecessor only for the first draft. Server freezes current catalog/profile/venue/timeline facts and checked totals; MENU quantities are tables, PRINT copies. No inherited approvals. Reject monetary history or active/unknown pins.',
      parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: contractDraftSchema } },
      },
      responses: { '201': success, ...errors },
    },
  },
  ...Object.fromEntries(
    (
      [
        [
          'submissions',
          'submitCommercialContract',
          contractDecisionSchema,
          'Revalidate current selections and exact draft digest. Catalog/profile changes require explicit successor/reselection. Both names required. Submits for two approvals; never silently reprices.',
        ],
        [
          'approvals',
          'approveCommercialContract',
          contractDecisionSchema,
          'Approve current submitted revision as trusted own Manager or Couple party. Two distinct actors on the same digest. Final approval retains a private PDF. Never read catalog prices again after submission. Current timeline required.',
        ],
        [
          'withdrawals',
          'withdrawCommercialContractApproval',
          contractWithdrawalSchema,
          'Withdraw own approval before deposit by creating a successor DRAFT with no approvals; reason retained in atomic audit/outbox. Old approvals and approved PDF remain immutable. Active/unknown/settled deposit blocks changes.',
        ],
      ] as const
    ).map(([action, operationId, schema, description]) => [
      '/bookings/{bookingId}/contracts/{revisionId}/' + action,
      {
        parameters: [...parameters, revisionParameter],
        post: {
          operationId,
          description,
          tags: ['Booking lifecycle'],
          security,
          parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
          requestBody: { required: true, content: { 'application/json': { schema } } },
          responses: { '200': success, ...errors },
        },
      },
    ]),
  ),
  '/bookings/{bookingId}/contracts/{revisionId}/pdf': {
    parameters: [...parameters, revisionParameter],
    get: {
      operationId: 'downloadCommercialContractPdf',
      tags: ['Booking lifecycle'],
      security,
      description:
        'Private exact-version Vietnamese PDF. Approved bytes and SHA-256 are retained, including after supersession. Draft previews are identified as drafts. Snapshot digest differs from PDF byte digest. Does not imply digital signature.',
      responses: {
        '200': {
          description: 'PDF attachment; Cache-Control: no-store.',
          headers: { 'X-Content-SHA256': { schema: { type: 'string' } } },
          content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
        },
        ...errors,
      },
    },
  },
} satisfies NonNullable<ZodOpenApiObject['paths']>;
