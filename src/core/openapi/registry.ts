import type { ZodOpenApiObject, ZodOpenApiResponseObject } from 'zod-openapi';
import type { z } from 'zod';

import {
  errorDetailSchema,
  errorResponseSchema,
  paginationMetadataSchema,
  requestIdSchema,
} from '../http/common.schemas.js';
import {
  healthLiveResponseSchema,
  healthReadyResponseSchema,
  healthUnavailableResponseSchema,
} from '../http/health.schemas.js';
import { idempotencyKeySchema } from '../idempotency/idempotency.schemas.js';
import {
  accountSummarySchema,
  androidRefreshBodySchema,
  currentUserResponseSchema,
  emptyWriteBodySchema,
  identityLoginBodySchema,
  invitationAcceptanceBodySchema,
  issuedSessionResponseSchema,
  passwordResetCompletionBodySchema,
  passwordResetCompletionResponseSchema,
  passwordResetRequestBodySchema,
  passwordResetRequestResponseSchema,
  refreshedSessionResponseSchema,
  sessionInventoryResponseSchema,
  sessionSummarySchema,
} from '../../modules/identity-access/identity.schemas.js';

function errorResponse(
  description: string,
  example: Readonly<{
    code: string;
    message: string;
    details?: readonly Readonly<{ path: string; code: string; message: string }>[];
  }>,
  options: { readonly retryAfter?: boolean } = {},
): ZodOpenApiResponseObject {
  return {
    description,
    content: {
      'application/json': {
        schema: errorResponseSchema,
        example: {
          error: {
            ...example,
            requestId: '24dcfaac-4408-4d42-8d66-456ed6ee7ea4',
          },
        },
      },
    },
    headers: {
      'x-request-id': { $ref: '#/components/headers/RequestId' },
      ...(options.retryAfter ? { 'Retry-After': { $ref: '#/components/headers/RetryAfter' } } : {}),
    },
  };
}

const commonResponses = {
  BadRequest: errorResponse('The request is malformed or misses a required header.', {
    code: 'MALFORMED_JSON',
    message: 'The request body contains malformed JSON.',
  }),
  Unauthorized: errorResponse('Authentication is missing or invalid.', {
    code: 'UNAUTHORIZED',
    message: 'Authentication is required.',
  }),
  Forbidden: errorResponse('The authenticated actor is not permitted to perform this action.', {
    code: 'FORBIDDEN',
    message: 'The request is forbidden.',
  }),
  NotFound: errorResponse('The resource is absent or intentionally concealed.', {
    code: 'NOT_FOUND',
    message: 'The requested resource was not found.',
  }),
  Conflict: errorResponse('The request conflicts with the current state.', {
    code: 'CONFLICT',
    message: 'The request conflicts with the current state.',
  }),
  UnprocessableEntity: errorResponse('The request fails schema or business validation.', {
    code: 'VALIDATION_ERROR',
    message: 'The request is invalid.',
    details: [{ path: 'email', code: 'invalid_format', message: 'Email must be valid.' }],
  }),
  TooManyRequests: errorResponse(
    'The caller exceeded an enforced request limit.',
    { code: 'RATE_LIMITED', message: 'Too many requests.' },
    { retryAfter: true },
  ),
  InternalServerError: errorResponse('An unexpected internal error occurred.', {
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred.',
  }),
  BadGateway: errorResponse('An upstream service returned an error.', {
    code: 'PROVIDER_ERROR',
    message: 'An upstream service returned an error.',
  }),
  ServiceUnavailable: errorResponse('The service or an upstream dependency is unavailable.', {
    code: 'SERVICE_UNAVAILABLE',
    message: 'The service is not ready.',
  }),
  GatewayTimeout: errorResponse('An upstream service timed out.', {
    code: 'PROVIDER_TIMEOUT',
    message: 'An upstream service timed out.',
  }),
} satisfies Record<string, ZodOpenApiResponseObject>;

const idempotencyResponses = {
  IdempotencyKeyRequired: errorResponse('The operation requires an Idempotency-Key header.', {
    code: 'IDEMPOTENCY_KEY_REQUIRED',
    message: 'An Idempotency-Key header is required.',
  }),
  InvalidIdempotencyKey: errorResponse('The supplied Idempotency-Key is invalid.', {
    code: 'INVALID_IDEMPOTENCY_KEY',
    message: 'The Idempotency-Key header is invalid.',
  }),
  IdempotencyKeyReused: errorResponse(
    'The Idempotency-Key was previously claimed with a different request payload.',
    {
      code: 'IDEMPOTENCY_KEY_REUSED',
      message: 'The Idempotency-Key was already used for a different request.',
    },
  ),
  RequestInProgress: errorResponse(
    'An identical request is still being processed and must not be re-executed.',
    {
      code: 'REQUEST_IN_PROGRESS',
      message: 'A request with this Idempotency-Key is still in progress.',
    },
    { retryAfter: true },
  ),
} satisfies Record<string, ZodOpenApiResponseObject>;

export const openApiRegistry = {
  openapi: '3.1.0',
  info: {
    title: 'Wedding Management API',
    version: '0.1.0',
    description: 'Canonical HTTP contract for the wedding management backend.',
  },
  tags: [
    { name: 'Health', description: 'Process liveness and dependency readiness.' },
    { name: 'Identity', description: 'Authentication and caller-owned session lifecycle.' },
  ],
  paths: {
    '/health/live': {
      get: {
        operationId: 'getHealthLive',
        summary: 'Check process liveness',
        tags: ['Health'],
        responses: {
          '200': {
            description: 'The process is alive.',
            content: {
              'application/json': {
                schema: healthLiveResponseSchema,
                example: {
                  data: {
                    status: 'live',
                    requestId: '24dcfaac-4408-4d42-8d66-456ed6ee7ea4',
                  },
                },
              },
            },
            headers: { 'x-request-id': { $ref: '#/components/headers/RequestId' } },
          },
          '500': { $ref: '#/components/responses/InternalServerError' },
        },
      },
    },
    '/health/ready': {
      get: {
        operationId: 'getHealthReady',
        summary: 'Check service readiness',
        tags: ['Health'],
        responses: {
          '200': {
            description: 'The service and its required dependencies are ready.',
            content: {
              'application/json': {
                schema: healthReadyResponseSchema,
                example: {
                  data: {
                    status: 'ready',
                    requestId: '24dcfaac-4408-4d42-8d66-456ed6ee7ea4',
                  },
                },
              },
            },
            headers: { 'x-request-id': { $ref: '#/components/headers/RequestId' } },
          },
          '503': {
            description: 'The service is not ready.',
            content: {
              'application/json': {
                schema: healthUnavailableResponseSchema,
                example: {
                  error: {
                    code: 'SERVICE_UNAVAILABLE',
                    message: 'The service is not ready.',
                    requestId: '24dcfaac-4408-4d42-8d66-456ed6ee7ea4',
                  },
                },
              },
            },
            headers: { 'x-request-id': { $ref: '#/components/headers/RequestId' } },
          },
          '500': { $ref: '#/components/responses/InternalServerError' },
        },
      },
    },
    '/auth/web-sessions': {
      post: {
        operationId: 'createWebSession',
        summary: 'Create a Web session',
        description:
          'Unsafe to retry automatically because a successful response issues new credentials.',
        tags: ['Identity'],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: identityLoginBodySchema } },
        },
        responses: {
          '201': identitySuccessResponse(
            'A Web session was created and the refresh credential was set only as a secure host cookie.',
            issuedSessionResponseSchema,
          ),
          '401': { $ref: '#/components/responses/Unauthorized' },
          '422': { $ref: '#/components/responses/UnprocessableEntity' },
          '429': { $ref: '#/components/responses/TooManyRequests' },
          '500': { $ref: '#/components/responses/InternalServerError' },
        },
      },
    },
    '/auth/password-reset-requests': {
      post: {
        operationId: 'requestPasswordReset',
        summary: 'Request a password reset',
        description:
          'Enumeration-safe and unsafe to retry automatically; every eligible request creates a new single-use credential.',
        tags: ['Identity'],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: passwordResetRequestBodySchema } },
        },
        responses: {
          '202': identitySuccessResponse(
            'The request was accepted regardless of account eligibility.',
            passwordResetRequestResponseSchema,
          ),
          '422': { $ref: '#/components/responses/UnprocessableEntity' },
          '429': { $ref: '#/components/responses/TooManyRequests' },
          '500': { $ref: '#/components/responses/InternalServerError' },
          '502': { $ref: '#/components/responses/BadGateway' },
          '503': { $ref: '#/components/responses/ServiceUnavailable' },
          '504': { $ref: '#/components/responses/GatewayTimeout' },
        },
      },
    },
    '/auth/password-reset-completions': {
      post: {
        operationId: 'completePasswordReset',
        summary: 'Complete a password reset',
        description:
          'Unsafe to replay after an unknown outcome; a consumed credential directs the user to normal login.',
        tags: ['Identity'],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: passwordResetCompletionBodySchema } },
        },
        responses: {
          '200': identitySuccessResponse(
            'The password was changed and all existing sessions were revoked.',
            passwordResetCompletionResponseSchema,
          ),
          '401': { $ref: '#/components/responses/Unauthorized' },
          '422': { $ref: '#/components/responses/UnprocessableEntity' },
          '429': { $ref: '#/components/responses/TooManyRequests' },
          '500': { $ref: '#/components/responses/InternalServerError' },
        },
      },
    },
    '/workspace-invitation-acceptances': {
      post: {
        operationId: 'acceptWorkspaceInvitation',
        summary: 'Accept a workspace invitation',
        description:
          'Unsafe to replay after an unknown outcome; success consumes the invitation and creates one restricted Web session.',
        tags: ['Identity'],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: invitationAcceptanceBodySchema } },
        },
        responses: {
          '201': identitySuccessResponse(
            'The invitation was consumed and a restricted Web session was created.',
            issuedSessionResponseSchema,
          ),
          '401': { $ref: '#/components/responses/Unauthorized' },
          '422': { $ref: '#/components/responses/UnprocessableEntity' },
          '429': { $ref: '#/components/responses/TooManyRequests' },
          '500': { $ref: '#/components/responses/InternalServerError' },
        },
      },
    },
    '/auth/android-sessions': {
      post: {
        operationId: 'createAndroidSession',
        summary: 'Create an Android session',
        description:
          'Unsafe to retry automatically because a successful response issues new credentials.',
        tags: ['Identity'],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: identityLoginBodySchema } },
        },
        responses: {
          '201': identitySuccessResponse(
            'An Android session was created and both credentials are returned once.',
            issuedSessionResponseSchema,
          ),
          '401': { $ref: '#/components/responses/Unauthorized' },
          '422': { $ref: '#/components/responses/UnprocessableEntity' },
          '429': { $ref: '#/components/responses/TooManyRequests' },
          '500': { $ref: '#/components/responses/InternalServerError' },
        },
      },
    },
    '/auth/web-session-refreshes': {
      post: {
        operationId: 'refreshWebSession',
        summary: 'Rotate a Web refresh credential',
        description: 'Unsafe to replay after an unknown outcome; clients must fall back to login.',
        tags: ['Identity'],
        parameters: [{ $ref: '#/components/parameters/WebRefreshCookie' }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: emptyWriteBodySchema } },
        },
        responses: {
          '200': identitySuccessResponse(
            'The Web refresh credential was rotated in the host cookie.',
            refreshedSessionResponseSchema,
          ),
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '422': { $ref: '#/components/responses/UnprocessableEntity' },
          '429': { $ref: '#/components/responses/TooManyRequests' },
          '500': { $ref: '#/components/responses/InternalServerError' },
        },
      },
    },
    '/auth/android-session-refreshes': {
      post: {
        operationId: 'refreshAndroidSession',
        summary: 'Rotate an Android refresh credential',
        description: 'Unsafe to replay after an unknown outcome; clients must fall back to login.',
        tags: ['Identity'],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: androidRefreshBodySchema } },
        },
        responses: {
          '200': identitySuccessResponse(
            'The Android credentials were rotated and returned once.',
            refreshedSessionResponseSchema,
          ),
          '401': { $ref: '#/components/responses/Unauthorized' },
          '422': { $ref: '#/components/responses/UnprocessableEntity' },
          '429': { $ref: '#/components/responses/TooManyRequests' },
          '500': { $ref: '#/components/responses/InternalServerError' },
        },
      },
    },
    '/auth/sessions/current': {
      delete: {
        operationId: 'deleteCurrentSession',
        summary: 'Log out the current session',
        description:
          'Idempotent; retries keep the session revoked and clear any Web refresh cookie.',
        tags: ['Identity'],
        security: [{ bearerAuth: [] }],
        responses: {
          '204': identityNoContentResponse('The current session is revoked.'),
          '401': { $ref: '#/components/responses/Unauthorized' },
          '500': { $ref: '#/components/responses/InternalServerError' },
        },
      },
    },
    '/auth/me': {
      get: {
        operationId: 'getCurrentUser',
        summary: 'Read the current authenticated user',
        tags: ['Identity'],
        security: [{ bearerAuth: [] }],
        responses: {
          '200': identitySuccessResponse(
            'The current account and session summary.',
            currentUserResponseSchema,
          ),
          '401': { $ref: '#/components/responses/Unauthorized' },
          '500': { $ref: '#/components/responses/InternalServerError' },
        },
      },
    },
    '/auth/sessions': {
      get: {
        operationId: 'listSessions',
        summary: 'List caller-owned sessions',
        tags: ['Identity'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
          {
            name: 'cursor',
            in: 'query',
            required: false,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': identitySuccessResponse(
            'A bounded cursor page of safe session summaries.',
            sessionInventoryResponseSchema,
          ),
          '401': { $ref: '#/components/responses/Unauthorized' },
          '422': { $ref: '#/components/responses/UnprocessableEntity' },
          '500': { $ref: '#/components/responses/InternalServerError' },
        },
      },
    },
    '/auth/sessions/{sessionId}': {
      delete: {
        operationId: 'deleteOwnedSession',
        summary: 'Revoke a caller-owned session',
        description:
          'Idempotent for an owned session; a foreign or absent session is concealed as not found.',
        tags: ['Identity'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'sessionId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '204': identityNoContentResponse('The owned session is revoked.'),
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
          '422': { $ref: '#/components/responses/UnprocessableEntity' },
          '500': { $ref: '#/components/responses/InternalServerError' },
        },
      },
    },
  },
  components: {
    schemas: {
      ErrorDetail: errorDetailSchema,
      ErrorResponse: errorResponseSchema,
      HealthLiveResponse: healthLiveResponseSchema,
      HealthReadyResponse: healthReadyResponseSchema,
      HealthUnavailableResponse: healthUnavailableResponseSchema,
      IdempotencyKey: idempotencyKeySchema,
      AccountSummary: accountSummarySchema,
      AndroidRefreshBody: androidRefreshBodySchema,
      CurrentUserResponse: currentUserResponseSchema,
      IdentityLoginBody: identityLoginBodySchema,
      InvitationAcceptanceBody: invitationAcceptanceBodySchema,
      IssuedSessionResponse: issuedSessionResponseSchema,
      PasswordResetCompletionBody: passwordResetCompletionBodySchema,
      PasswordResetCompletionResponse: passwordResetCompletionResponseSchema,
      PasswordResetRequestBody: passwordResetRequestBodySchema,
      PasswordResetRequestResponse: passwordResetRequestResponseSchema,
      PaginationMetadata: paginationMetadataSchema,
      RefreshedSessionResponse: refreshedSessionResponseSchema,
      RequestId: requestIdSchema,
      SessionInventoryResponse: sessionInventoryResponseSchema,
      SessionSummary: sessionSummarySchema,
    },
    parameters: {
      IdempotencyKey: {
        name: 'Idempotency-Key',
        in: 'header',
        required: true,
        description: 'Required on operations documented as idempotent.',
        schema: { $ref: '#/components/schemas/IdempotencyKey' },
      },
      RequestId: {
        name: 'x-request-id',
        in: 'header',
        required: false,
        description:
          'Trusted callers may supply a UUID request ID; otherwise the service generates one.',
        schema: { $ref: '#/components/schemas/RequestId' },
      },
      WebRefreshCookie: {
        name: '__Host-wedding-refresh',
        in: 'cookie',
        required: true,
        description:
          'HttpOnly, Secure, SameSite=Lax refresh credential. An allowed Origin header is also required.',
        schema: { type: 'string', pattern: '^wir_[A-Za-z0-9_-]{43}$' },
      },
    },
    headers: {
      RequestId: {
        description: 'Request correlation identifier.',
        schema: { $ref: '#/components/schemas/RequestId' },
      },
      RetryAfter: {
        description: 'Positive integer number of seconds before the caller should retry.',
        schema: { type: 'string', pattern: '^[1-9][0-9]*$', example: '1' },
      },
    },
    responses: { ...commonResponses, ...idempotencyResponses },
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'opaque' },
    },
  },
} satisfies ZodOpenApiObject;

function identitySuccessResponse(description: string, schema: z.ZodType): ZodOpenApiResponseObject {
  return {
    description,
    content: { 'application/json': { schema } },
    headers: {
      'Cache-Control': { schema: { type: 'string' as const, const: 'no-store' } },
      'x-request-id': { $ref: '#/components/headers/RequestId' },
    },
  };
}

function identityNoContentResponse(description: string): ZodOpenApiResponseObject {
  return {
    description,
    headers: {
      'Cache-Control': { schema: { type: 'string' as const, const: 'no-store' } },
      'x-request-id': { $ref: '#/components/headers/RequestId' },
    },
  };
}
