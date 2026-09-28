import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createApp } from '../../src/app.js';
import {
  ConflictError,
  NotFoundError,
  ProviderError,
  RateLimitError,
} from '../../src/core/errors/app-error.js';
import { strictWriteSchema, validateRequest } from '../../src/core/http/validate.js';

const trustedRequestId = '24dcfaac-4408-4d42-8d66-456ed6ee7ea4';

function expectStandardError(
  response: request.Response,
  expected: { readonly status: number; readonly code: string; readonly message: string },
): void {
  expect(response.status).toBe(expected.status);
  expect(response.headers['x-request-id']).toBe(trustedRequestId);
  expect(response.body as unknown).toMatchObject({
    error: {
      code: expected.code,
      message: expected.message,
      requestId: trustedRequestId,
    },
  });
}

describe('common HTTP errors', () => {
  it.each([
    ['/not-found', new NotFoundError(), 404, 'NOT_FOUND', 'The requested resource was not found.'],
    [
      '/conflict',
      new ConflictError(),
      409,
      'CONFLICT',
      'The request conflicts with the current state.',
    ],
    ['/rate-limit', new RateLimitError(30), 429, 'RATE_LIMITED', 'Too many requests.'],
    [
      '/provider-error',
      new ProviderError('failure'),
      502,
      'PROVIDER_ERROR',
      'An upstream service returned an error.',
    ],
    [
      '/provider-unavailable',
      new ProviderError('unavailable'),
      503,
      'PROVIDER_UNAVAILABLE',
      'An upstream service is unavailable.',
    ],
    [
      '/provider-timeout',
      new ProviderError('timeout'),
      504,
      'PROVIDER_TIMEOUT',
      'An upstream service timed out.',
    ],
  ] as const)(
    'maps %s through the standard error envelope',
    async (path, applicationError, status, code, message) => {
      const app = createApp({
        isTrustedRequestId: () => true,
        registerRoutes: (router) => {
          router.get(path, () => {
            throw applicationError;
          });
        },
      });

      const response = await request(app).get(path).set('x-request-id', trustedRequestId);

      expectStandardError(response, { status, code, message });
      if (applicationError instanceof RateLimitError) {
        expect(response.headers['retry-after']).toBe('30');
      }
    },
  );

  it('returns a structured validation error with safe Zod issue details', async () => {
    const createWeddingSchema = {
      body: strictWriteSchema({ email: z.email('Email must be valid.') }),
    };
    const app = createApp({
      isTrustedRequestId: () => true,
      registerRoutes: (router) => {
        router.post('/weddings', validateRequest(createWeddingSchema), (_request, response) => {
          response.sendStatus(204);
        });
      },
    });

    const response = await request(app)
      .post('/weddings')
      .set('x-request-id', trustedRequestId)
      .send({ email: 'invalid' });

    expectStandardError(response, {
      status: 422,
      code: 'VALIDATION_ERROR',
      message: 'The request is invalid.',
    });
    expect(response.body as unknown).toMatchObject({
      error: {
        details: [{ path: 'email', code: 'invalid_format', message: 'Email must be valid.' }],
      },
    });
  });

  it('maps malformed JSON to 400 without exposing parser internals', async () => {
    const app = createApp({ isTrustedRequestId: () => true });

    const response = await request(app)
      .post('/weddings')
      .set('x-request-id', trustedRequestId)
      .set('content-type', 'application/json')
      .send('{"email":');

    expectStandardError(response, {
      status: 400,
      code: 'MALFORMED_JSON',
      message: 'The request body contains malformed JSON.',
    });
    expect(JSON.stringify(response.body)).not.toContain('SyntaxError');
  });

  it('uses the standard 404 contract for unknown routes', async () => {
    const app = createApp({ isTrustedRequestId: () => true });

    const response = await request(app).get('/missing-route').set('x-request-id', trustedRequestId);

    expectStandardError(response, {
      status: 404,
      code: 'NOT_FOUND',
      message: 'The requested resource was not found.',
    });
  });

  it('reports unexpected errors internally but never leaks their message or stack', async () => {
    const reportUnexpectedError = vi.fn();
    const internalError = new Error('database password=super-secret');
    const app = createApp({
      isTrustedRequestId: () => true,
      reportUnexpectedError,
      registerRoutes: (router) => {
        router.get('/unexpected', () => {
          throw internalError;
        });
      },
    });

    const response = await request(app).get('/unexpected').set('x-request-id', trustedRequestId);

    expectStandardError(response, {
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
    });
    expect(reportUnexpectedError).toHaveBeenCalledWith(internalError, expect.anything());
    expect(JSON.stringify(response.body)).not.toContain('super-secret');
    expect(JSON.stringify(response.body)).not.toContain('stack');
  });
});
