import { z } from 'zod';
import type {
  ZodOpenApiObject,
  ZodOpenApiOperationObject,
  ZodOpenApiResponseObject,
} from 'zod-openapi';

import {
  proposalResponseSchema,
  holdResponseSchema,
  timelineResultResponseSchema,
  cancellationRequestResponseSchema,
} from './booking-lifecycle.responses.js';

import {
  approvalBodySchema,
  bookingResponseSchema,
  cancellationBodySchema,
  cancellationDecisionBodySchema,
  changeRequestBodySchema,
  consultationResponseSchema,
  createBookingBodySchema,
  createConsultationBodySchema,
  expectedRevisionBodySchema,
  timelineRevisionBodySchema,
  withdrawalBodySchema,
  workspaceInvitationBodySchema,
} from './booking-lifecycle.schemas.js';

type Paths = NonNullable<ZodOpenApiObject['paths']>;

const uuid = z.uuid();
const revision = z.int().positive();
const invitationResponse = z.strictObject({
  data: z.strictObject({
    consultationId: uuid,
    invitationId: uuid,
    status: z.literal('ISSUED'),
    replayed: z.boolean(),
  }),
});
const availabilityResponse = z.strictObject({
  data: z.strictObject({
    available: z.boolean(),
    activeHold: z.strictObject({ holdId: uuid, expiresAt: z.iso.datetime() }).nullable(),
  }),
});
const phaseResponse = z.strictObject({
  data: z.strictObject({
    phase: z.enum(['CANCELLED', 'COMPLETED']),
    bookingRevision: revision,
  }),
});

const bearer = [{ bearerAuth: [] }];
const path = (name: string) => ({
  name,
  in: 'path' as const,
  required: true,
  schema: { type: 'string' as const, format: 'uuid' },
});
const errors = {
  '400': { $ref: '#/components/responses/IdempotencyKeyRequired' },
  '401': { $ref: '#/components/responses/Unauthorized' },
  '403': { $ref: '#/components/responses/Forbidden' },
  '404': { $ref: '#/components/responses/NotFound' },
  '409': { $ref: '#/components/responses/Conflict' },
  '422': { $ref: '#/components/responses/UnprocessableEntity' },
  '500': { $ref: '#/components/responses/InternalServerError' },
  '503': { $ref: '#/components/responses/ServiceUnavailable' },
} as const;

function jsonBody(schema: z.ZodType) {
  return { required: true, content: { 'application/json': { schema } } };
}

function success(description: string, schema: z.ZodType): ZodOpenApiResponseObject {
  return {
    description,
    content: { 'application/json': { schema } },
    headers: { 'x-request-id': { $ref: '#/components/headers/RequestId' } },
  };
}

function mutation(
  operationId: string,
  summary: string,
  body: z.ZodType,
  responseSchema: z.ZodType,
  options: Readonly<{
    created?: boolean;
    accepted?: boolean;
    parameters?: ZodOpenApiOperationObject['parameters'];
  }> = {},
) {
  return {
    operationId,
    summary,
    tags: ['Booking Lifecycle'],
    security: bearer,
    parameters: [...(options.parameters ?? []), { $ref: '#/components/parameters/IdempotencyKey' }],
    requestBody: jsonBody(body),
    responses: {
      [options.accepted ? '202' : options.created ? '201' : '200']: success(
        'The booking lifecycle command completed.',
        responseSchema,
      ),
      ...errors,
    },
  };
}

export const bookingLifecycleOpenApiPaths: Paths = {
  '/management/consultations': {
    post: mutation(
      'createConsultation',
      'Create a consultation',
      createConsultationBodySchema,
      consultationResponseSchema,
      { created: true },
    ),
  },
  '/management/consultations/{consultationId}/workspace-invitations': {
    post: mutation(
      'requestWorkspaceInvitation',
      'Request a restricted workspace invitation',
      workspaceInvitationBodySchema,
      invitationResponse,
      { accepted: true, parameters: [path('consultationId')] },
    ),
  },
  '/management/availability': {
    get: {
      operationId: 'getBookingAvailability',
      summary: 'Inspect a wedding slot',
      tags: ['Booking Lifecycle'],
      security: bearer,
      parameters: [
        { name: 'hallId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
        {
          name: 'eventDate',
          in: 'query',
          required: true,
          schema: { type: 'string', format: 'date' },
        },
        {
          name: 'shiftCode',
          in: 'query',
          required: true,
          schema: { type: 'string', enum: ['LUNCH', 'DINNER'] },
        },
      ],
      responses: {
        '200': success('The current slot availability.', availabilityResponse),
        ...errors,
      },
    },
  },
  '/bookings': {
    post: mutation(
      'createBooking',
      'Create a booking proposal',
      createBookingBodySchema,
      bookingResponseSchema,
      {
        created: true,
      },
    ),
  },
  '/bookings/{bookingId}/slot-holds': {
    post: mutation(
      'acquireBookingSlotHold',
      'Acquire a 15 minute slot hold',
      expectedRevisionBodySchema,
      holdResponseSchema,
      { created: true, parameters: [path('bookingId')] },
    ),
  },
  '/bookings/{bookingId}/proposal': {
    get: {
      operationId: 'getBookingProposal',
      summary: 'Read a safe booking proposal workspace',
      tags: ['Booking Lifecycle'],
      security: bearer,
      parameters: [path('bookingId')],
      responses: {
        '200': success('The authorized proposal workspace.', proposalResponseSchema),
        ...errors,
      },
    },
  },
  '/bookings/{bookingId}/timeline-revisions': {
    post: mutation(
      'createBookingTimelineRevision',
      'Create an immutable timeline revision',
      timelineRevisionBodySchema,
      timelineResultResponseSchema,
      { created: true, parameters: [path('bookingId')] },
    ),
  },
  '/bookings/{bookingId}/timeline-revisions/{revisionId}/approvals': {
    post: mutation(
      'approveBookingTimelineRevision',
      'Approve the exact current timeline',
      approvalBodySchema,
      timelineResultResponseSchema,
      {
        parameters: [path('bookingId'), path('revisionId')],
      },
    ),
  },
  '/bookings/{bookingId}/timeline-revisions/{revisionId}/withdrawals': {
    post: mutation(
      'withdrawBookingTimelineApproval',
      'Withdraw the actor approval',
      withdrawalBodySchema,
      timelineResultResponseSchema,
      {
        parameters: [path('bookingId'), path('revisionId')],
      },
    ),
  },
  '/bookings/{bookingId}/change-requests': {
    post: mutation(
      'requestBookingTimelineChange',
      'Propose a post deposit timeline replacement',
      changeRequestBodySchema,
      timelineResultResponseSchema,
      {
        created: true,
        parameters: [path('bookingId')],
      },
    ),
  },
  '/bookings/{bookingId}/cancellation-requests': {
    post: mutation(
      'requestBookingCancellation',
      'Request booking cancellation',
      cancellationBodySchema,
      cancellationRequestResponseSchema,
      {
        accepted: true,
        parameters: [path('bookingId')],
      },
    ),
  },
  '/management/bookings/{bookingId}/cancellation': {
    post: mutation(
      'cancelBooking',
      'Cancel a booking as its Manager',
      cancellationBodySchema,
      phaseResponse,
      {
        parameters: [path('bookingId')],
      },
    ),
  },
  '/management/bookings/{bookingId}/cancellation-requests/{requestId}/decision': {
    post: mutation(
      'decideBookingCancellation',
      'Approve or reject a pending cancellation request',
      cancellationDecisionBodySchema,
      z.strictObject({
        data: z.strictObject({
          phase: z.enum(['DRAFT', 'AWAITING_DEPOSIT', 'CONFIRMED', 'CANCELLED', 'COMPLETED']),
          bookingRevision: revision,
        }),
      }),
      { parameters: [path('bookingId'), path('requestId')] },
    ),
  },
  '/management/bookings/{bookingId}/completion': {
    post: mutation(
      'completeBooking',
      'Complete a due confirmed booking',
      expectedRevisionBodySchema,
      phaseResponse,
      {
        parameters: [path('bookingId')],
      },
    ),
  },
};

export const bookingLifecycleOpenApiSchemas = {
  BookingCreateBody: createBookingBodySchema,
  BookingResponse: bookingResponseSchema,
  ConsultationCreateBody: createConsultationBodySchema,
  ConsultationResponse: consultationResponseSchema,
  TimelineRevisionBody: timelineRevisionBodySchema,
  BookingProposalResponse: proposalResponseSchema,
};
