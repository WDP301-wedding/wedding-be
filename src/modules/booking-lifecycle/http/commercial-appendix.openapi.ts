import type { ZodOpenApiObject } from 'zod-openapi';
import type { z } from 'zod';
import {
  appendixDraftSchema,
  appendixDecisionSchema,
  appendixResponseSchema,
  appendicesResponseSchema,
} from '../domain/commercial-appendix.js';
const security = [{ bearerAuth: [] }];
const booking = {
  name: 'bookingId',
  in: 'path' as const,
  required: true,
  schema: { type: 'string' as const, format: 'uuid' },
};
const revision = { ...booking, name: 'revisionId' };
const errors = Object.fromEntries(
  [
    ['400', 'IdempotencyKeyRequired'],
    ['401', 'Unauthorized'],
    ['404', 'NotFound'],
    ['409', 'Conflict'],
    ['422', 'UnprocessableEntity'],
  ].map(([status, name]) => [status!, { $ref: `#/components/responses/${name}` }] as const),
);
const success = {
  description: 'Immutable appendix and current Booking revision.',
  content: { 'application/json': { schema: appendixResponseSchema } },
};
function write(operationId: string, description: string, schema: z.ZodType, status: string) {
  return {
    operationId,
    description,
    tags: ['Booking lifecycle'],
    security,
    parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
    requestBody: { required: true, content: { 'application/json': { schema } } },
    responses: { [status]: success, ...errors },
  };
}
export const commercialAppendixOpenApiPaths = {
  '/bookings/{bookingId}/contract-appendices': {
    parameters: [booking],
    get: {
      operationId: 'listCommercialAppendices',
      security,
      tags: ['Booking lifecycle'],
      description:
        'Own Manager or FULL Couple. Private no-store; immutable history and effective total. No legacy conversion.',
      parameters: [{ name: 'cursor', in: 'query', schema: { type: 'string', format: 'uuid' } }],
      responses: {
        '200': {
          description: 'Up to 50 revisions, newest first.',
          content: { 'application/json': { schema: appendicesResponseSchema } },
        },
        ...errors,
      },
    },
    post: write(
      'createCommercialAppendix',
      'Confirmed/completed paid full contract. Exact effective predecessor, reason and selections. Server computes signed delta; original contract/deposit remain frozen. Unresolved payments and finalized invoices block changes.',
      appendixDraftSchema,
      '201',
    ),
  },
  '/bookings/{bookingId}/contract-appendices/{revisionId}/submissions': {
    parameters: [booking, revision],
    post: write(
      'submitCommercialAppendix',
      'Revalidate changed catalog selections before submission. Unchanged frozen facts remain usable.',
      appendixDecisionSchema,
      '200',
    ),
  },
  '/bookings/{bookingId}/contract-appendices/{revisionId}/approvals': {
    parameters: [booking, revision],
    post: write(
      'approveCommercialAppendix',
      'Two distinct own Manager/Couple actors approve one digest. Second approval atomically activates revision and posts signed delta once. Active print allocations retain their source revision, unit price and minimum allocated quantity; conflicting changes return 409 CONTRACT_PRINT_SOURCE_ALLOCATED or CONTRACT_PRINT_QUANTITY_ALLOCATED.',
      appendixDecisionSchema,
      '200',
    ),
  },
} satisfies ZodOpenApiObject['paths'];
