import type { z } from 'zod';
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
  overviewResponseSchema,
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
export const experienceOpenApiPaths = {
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
    get: operation('listConsultationRequests', intakeListSchema, { paged: true }),
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
  CoupleOverviewResponse: overviewResponseSchema,
  ProfileResponse: profileResponseSchema,
  ProfileWriteBody: profileWriteSchema,
  PasswordChangeBody: passwordChangeSchema,
};
