import type { ZodOpenApiObject, ZodOpenApiResponseObject } from 'zod-openapi';

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
  tags: [{ name: 'Health', description: 'Process liveness and dependency readiness.' }],
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
  },
  components: {
    schemas: {
      ErrorDetail: errorDetailSchema,
      ErrorResponse: errorResponseSchema,
      HealthLiveResponse: healthLiveResponseSchema,
      HealthReadyResponse: healthReadyResponseSchema,
      HealthUnavailableResponse: healthUnavailableResponseSchema,
      IdempotencyKey: idempotencyKeySchema,
      PaginationMetadata: paginationMetadataSchema,
      RequestId: requestIdSchema,
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
  },
} satisfies ZodOpenApiObject;
