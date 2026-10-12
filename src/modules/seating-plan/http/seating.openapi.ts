import { z } from 'zod';
import type { ZodOpenApiObject } from 'zod-openapi';
import {
  confirmationInput,
  exceptionInput,
  revisionInput,
  selectInput,
} from '../domain/seating-policy.js';
import { planViewSchema } from '../application/seating.service.js';
import { optionsSchema } from './seating.router.js';
type Operation = NonNullable<NonNullable<NonNullable<ZodOpenApiObject['paths']>[string]>['get']>;
const parameter = (name: string) => ({
  name,
  in: 'path' as const,
  required: true,
  schema: { type: 'string' as const, format: 'uuid' },
});
const op = (
  operationId: string,
  schema: z.ZodType,
  body?: z.ZodType,
  example?: unknown,
): Operation => ({
  operationId,
  tags: ['Seating plan'],
  security: [{ bearerAuth: [] }],
  description:
    'Confirmed Booking, Manager or owning FULL Couple; exceptions require Manager. Independent planning count; zero named Guests and check-in NONE are supported. Fixed venue geometry and Group labels only. Every write requires Idempotency-Key; revisions and print history are immutable. Unknown query/body keys are rejected. Stale revisions, retired layouts, unavailable Groups/tables, range/physical-capacity conflicts return 409; foreign bookings return concealed 404.',
  ...(body === undefined
    ? {}
    : {
        parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: body, ...(example === undefined ? {} : { example }) },
          },
        },
      }),
  responses: {
    [body === undefined ? '200' : '201']: {
      description: 'Private immutable snapshot; Cache-Control: no-store.',
      content: { 'application/json': { schema: z.strictObject({ data: schema }) } },
    },
    '400': { $ref: '#/components/responses/IdempotencyKeyRequired' },
    '401': { $ref: '#/components/responses/Unauthorized' },
    '404': { $ref: '#/components/responses/NotFound' },
    '409': { $ref: '#/components/responses/Conflict' },
    '422': { $ref: '#/components/responses/UnprocessableEntity' },
  },
});
const booking = parameter('bookingId'),
  plan = parameter('planId');
export const seatingOpenApiPaths: NonNullable<ZodOpenApiObject['paths']> = {
  '/bookings/{bookingId}/seating-layout-options': {
    parameters: [booking],
    get: op('listSeatingLayoutOptions', optionsSchema),
  },
  '/bookings/{bookingId}/seating-plans': {
    parameters: [booking],
    post: op('selectSeatingLayout', planViewSchema, selectInput, {
      layoutTemplateVersionId: '10000000-0000-4000-8000-000000000001',
      expectedBookingRevision: 1,
    }),
  },
  '/bookings/{bookingId}/seating-plans/{planId}': {
    parameters: [booking, plan],
    get: op('readSeatingPlan', planViewSchema),
  },
  '/bookings/{bookingId}/seating-plans/{planId}/revisions': {
    parameters: [booking, plan],
    post: op('reviseSeatingPlan', planViewSchema, revisionInput, {
      expectedRevision: 1,
      labels: [],
    }),
  },
  '/bookings/{bookingId}/seating-plans/{planId}/confirmation': {
    parameters: [booking, plan],
    post: op('confirmSeatingPlan', planViewSchema, confirmationInput, {
      expectedRevision: 2,
      expectedBookingRevision: 1,
    }),
  },
  '/management/seating-plans/{planId}/exceptions': {
    parameters: [plan],
    post: op('approveSeatingException', planViewSchema, exceptionInput, {
      expectedRevision: 2,
      expectedBookingRevision: 1,
      reason: 'Trong sức chứa vật lý của sảnh',
    }),
  },
};
