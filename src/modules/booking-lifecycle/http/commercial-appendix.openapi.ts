import type { ZodOpenApiObject } from 'zod-openapi';
import type { z } from 'zod';
import {
  appendixDraftSchema,
  appendixDecisionSchema,
  appendixCancellationSchema,
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
    description:
      description +
      ' MENU quantities are table counts. Maximum 10 guests per table; minimum tables and maximum published active hall-layout tables are rechecked at creation, submission and both approvals. Capacity conflicts return 409 BOOKING_TABLES_INSUFFICIENT, BOOKING_LAYOUT_TABLE_LIMIT, BOOKING_LAYOUT_UNAVAILABLE or BOOKING_HALL_CAPACITY_EXCEEDED.',
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
      'CONFIRMED paid full contract only, before event completion. Exact effective predecessor, reason and selections. Server computes signed delta; original contract/deposit remain frozen. Unresolved payments and finalized invoices block changes.',
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
      'Two distinct own Manager/Couple actors approve one digest. Second approval atomically activates revision, posts signed delta once and creates or synchronizes production orders for retained print requests. Quantity/removal changes affect only APPROVED orders; production history is immutable. Historical catalogue allocations retain their original safeguards.',
      appendixDecisionSchema,
      '200',
    ),
  },
  '/bookings/{bookingId}/contract-appendices/{revisionId}/cancellations': {
    parameters: [booking, revision],
    post: write(
      'cancelCommercialAppendix',
      'Own Manager or FULL Couple. CONFIRMED, or COMPLETED solely to discard an unapplied legacy proposal. Cancel the current DRAFT/AWAITING_APPROVAL proposal with expected Booking revision and reason. Retain approvals, content, audit and effective agreement; no ledger changes. Legacy pending print purchases use their existing withdrawal flow.',
      appendixCancellationSchema,
      '200',
    ),
  },
} satisfies ZodOpenApiObject['paths'];
