import type { z } from 'zod';
import { bookingLookupQuerySchema, bookingLookupResponseSchema } from './booking-lookup.schemas.js';
import {
  activationParams,
  activationStatusQuery,
  activationBody,
  activationResponse,
  activationSentResponse,
} from './activation.schemas.js';
import type { ZodOpenApiObject, ZodOpenApiOperationObject } from 'zod-openapi';
import {
  changeOtpRequestSchema,
  otpCompletionSchema,
  otpCompletionResponseSchema,
  otpRequestResponseSchema,
  resetOtpRequestSchema,
} from '../../identity-access/password-otp/password-otp.schemas.js';
import {
  consultationRequestBodySchema,
  intakeAcknowledgementSchema,
  intakeActionSchema,
  intakeListSchema,
  intakeQuerySchema,
  consultationWorkspaceParamsSchema,
  consultationWorkspaceResponseSchema,
  consultationCustomerQuerySchema,
  consultationCustomersResponseSchema,
  overviewResponseSchema,
  updateBookingAliasBodySchema,
  updateBookingAliasResponseSchema,
} from './experience.schemas.js';
import {
  passwordChangeSchema,
  passwordChangedResponseSchema,
  profileResponseSchema,
  profileWriteSchema,
} from '../../identity-access/account/settings.schemas.js';

function operation(
  operationId: string,
  schema: z.ZodType,
  options: {
    body?: z.ZodType;
    public?: boolean;
    accepted?: boolean;
    paged?: boolean;
    android?: boolean;
    description?: string;
    id?: boolean;
    bookingId?: boolean;
  } = {},
): ZodOpenApiOperationObject {
  return {
    operationId,
    tags: ['Product experience'],
    ...(options.description ? { description: options.description } : {}),
    security: options.public ? [] : [{ bearerAuth: [] }],
    ...(options.body
      ? {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: options.body } },
          },
        }
      : {}),
    parameters: [
      ...(options.id
        ? [
            {
              name: 'id',
              in: 'path' as const,
              required: true,
              schema: { type: 'string' as const, format: 'uuid' },
            },
          ]
        : []),
      ...(options.bookingId
        ? [
            {
              name: 'bookingId',
              in: 'path' as const,
              required: true,
              schema: { type: 'string' as const, format: 'uuid' },
            },
          ]
        : []),
      ...(options.paged
        ? [
            {
              name: 'cursor',
              in: 'query' as const,
              schema: { type: 'string' as const, format: 'uuid' },
            },
            {
              name: 'limit',
              in: 'query' as const,
              schema: { type: 'integer' as const, minimum: 1, maximum: 50, default: 20 },
            },
          ]
        : []),
      ...(options.android
        ? [
            {
              name: 'client',
              in: 'query' as const,
              schema: { type: 'string' as const, enum: ['WEB', 'ANDROID'], default: 'WEB' },
            },
          ]
        : []),
    ],
    responses: {
      [options.accepted ? '202' : '200']: {
        description: 'Successful operation',
        content: { 'application/json': { schema } },
      },
      '401': { $ref: '#/components/responses/Unauthorized' },
      '403': { $ref: '#/components/responses/Forbidden' },
      '404': { $ref: '#/components/responses/NotFound' },
      '409': { $ref: '#/components/responses/Conflict' },
      '422': { $ref: '#/components/responses/UnprocessableEntity' },
      '429': { $ref: '#/components/responses/TooManyRequests' },
    },
  };
}
export const experienceOpenApiPaths: NonNullable<ZodOpenApiObject['paths']> = {
  '/management/booking-lookups': {
    get: {
      ...operation('lookupManagedBookings', bookingLookupResponseSchema),
      requestParams: { query: bookingLookupQuerySchema },
      description:
        'Owning Manager only; private no-store. Supply q (2–120 characters: exact HY code, name, alias, intake phone or legacy UUID) or ids (at most 20 comma-separated UUIDs). Returns at most 20 current booking identities. Foreign resources are omitted. This read does not modify assignments or bookings.',
    },
  },
  '/management/consultations/{consultationId}/workspace': {
    get: {
      ...operation('getConsultationWorkspace', consultationWorkspaceResponseSchema),
      requestParams: { path: consultationWorkspaceParamsSchema },
      description:
        'Owning Manager only; private no-store. Resolves the current consultation and its existing booking before resuming work. Foreign resources are concealed.',
    },
  },
  '/management/consultation-customers': {
    get: {
      ...operation('searchConsultationCustomers', consultationCustomersResponseSchema),
      requestParams: { query: consultationCustomerQuerySchema },
      description:
        'Search only the Manager own consultation contacts by name, email or intake phone. At most 15 distinct emails. Reusing contact details never grants account access or reuses a booking.',
    },
  },
  '/management/consultations/{consultationId}/activation-status': {
    get: {
      ...operation('getConsultationActivationStatus', activationResponse),
      requestParams: { path: activationParams, query: activationStatusQuery },
      description:
        'Owning Manager only. Concealed foreign resources. Optional includeAccountState=true separates recipient account readiness from access to this consultation. Without it, the legacy response shape is preserved. Existing accounts accept invitations with their current password; no duplicate account or automatic grant is created. Private no-store.',
    },
  },
  '/management/consultations/{consultationId}/activation-invitations': {
    post: {
      ...operation('sendConsultationActivationInvitation', activationSentResponse, {
        body: activationBody,
        accepted: true,
      }),
      requestParams: { path: activationParams },
      parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
      description:
        'Owning Manager. Expected consultation revision and Idempotency-Key required. Explicit send/reissue, using existing lifetime and reissue limits. A replacement invalidates the previous link. Activated/revoked resources cannot be reissued. Unknown delivery retries retain the same key. No password or token is returned.',
    },
  },
  '/auth/password-otp-requests': {
    post: operation('requestPasswordResetOtp', otpRequestResponseSchema, {
      body: resetOtpRequestSchema,
      public: true,
      accepted: true,
    }),
  },
  '/auth/password-otp-completions': {
    post: operation('completePasswordResetOtp', otpCompletionResponseSchema, {
      body: otpCompletionSchema,
      public: true,
    }),
  },
  '/auth/password-change-otp-requests': {
    post: operation('requestPasswordChangeOtp', otpRequestResponseSchema, {
      body: changeOtpRequestSchema,
      accepted: true,
    }),
  },
  '/consultation-requests': {
    post: operation('submitConsultationRequest', intakeAcknowledgementSchema, {
      body: consultationRequestBodySchema,
      public: true,
      accepted: true,
    }),
  },
  '/management/consultation-requests': {
    get: {
      ...operation('listConsultationRequests', intakeListSchema),
      requestParams: { query: intakeQuerySchema },
      description:
        'Manager intake search, status filter and stable sorting across the full retained dataset. Counts apply to the search across all statuses; totalMatches applies to the selected status. Cursor belongs to the same filter/sort; a changed cursor returns 409. Private no-store.',
    },
  },
  '/management/consultation-requests/{id}/conversion': {
    post: operation('convertConsultationRequest', intakeActionSchema, { id: true }),
  },
  '/management/consultation-requests/{id}/closure': {
    post: operation('closeConsultationRequest', intakeActionSchema, { id: true }),
  },
  '/couple/bookings': {
    get: operation('listOwnBookings', overviewResponseSchema, {
      paged: true,
      android: true,
      description:
        'Lists only bookings for the authenticated account consultation grants, with identical Web and Android scope and pagination. Includes RESTRICTED DRAFT/AWAITING_DEPOSIT bookings as well as confirmed and terminal history. client is a compatibility hint, never authorization. COUPLE is an account role, not deposit evidence; use accessLevel and phase to gate actions.',
    }),
  },
  '/couple/bookings/{bookingId}/alias': {
    patch: operation('updateBookingAlias', updateBookingAliasResponseSchema, {
      bookingId: true,
      body: updateBookingAliasBodySchema,
      description: 'Update human-readable alias or eventType of booking for Couple or Manager.',
    }),
  },
  '/auth/profile': {
    get: operation('getOwnProfile', profileResponseSchema),
    patch: operation('updateOwnProfile', profileResponseSchema, { body: profileWriteSchema }),
  },
  '/auth/password-changes': {
    post: operation('changeOwnPassword', passwordChangedResponseSchema, {
      body: passwordChangeSchema,
    }),
  },
} satisfies NonNullable<ZodOpenApiObject['paths']>;
export const experienceOpenApiSchemas = {
  PasswordOtpRequestResponse: otpRequestResponseSchema,
  PasswordOtpCompletionBody: otpCompletionSchema,
  ConsultationRequestBody: consultationRequestBodySchema,
  ConsultationRequestList: intakeListSchema,
  ConsultationWorkspaceResponse: consultationWorkspaceResponseSchema,
  ConsultationCustomersResponse: consultationCustomersResponseSchema,
  CoupleOverviewResponse: overviewResponseSchema,
  UpdateBookingAliasBody: updateBookingAliasBodySchema,
  UpdateBookingAliasResponse: updateBookingAliasResponseSchema,
  ProfileResponse: profileResponseSchema,
  ProfileWriteBody: profileWriteSchema,
  PasswordChangeBody: passwordChangeSchema,
};
