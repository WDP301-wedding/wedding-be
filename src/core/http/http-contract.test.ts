import { Writable } from 'node:stream';

import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createApp } from '../../app.js';
import {
  ConflictError,
  IdempotencyKeyRequiredError,
  IdempotencyKeyReusedError,
  InvalidIdempotencyKeyError,
  NotFoundError,
  ProviderError,
  RateLimitError,
  RequestInProgressError,
  ValidationError,
} from '../errors/app-error.js';
import { createErrorHandler } from '../errors/error-handler.js';
import { createLogger } from '../logging/logger.js';
import { strictWriteSchema, validateRequest, validatedRequest } from './validate.js';

describe('request context', () => {
  it('propagates a valid request ID from a trusted upstream', async () => {
    const trustedRequestId = '24dcfaac-4408-4d42-8d66-456ed6ee7ea4';
    const app = createApp({
      isTrustedRequestId: () => true,
      registerRoutes: (router) => {
        router.get('/context', (request_, response) => {
          response.json({ requestId: request_.requestId });
        });
      },
    });

    const response = await request(app).get('/context').set('x-request-id', trustedRequestId);

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBe(trustedRequestId);
    expect(response.body).toEqual({ requestId: trustedRequestId });
  });

  it.each([
    ['an invalid request ID', 'not-a-uuid', true],
    ['an untrusted request ID', '24dcfaac-4408-4d42-8d66-456ed6ee7ea4', false],
  ])('generates a UUID for %s', async (_case, suppliedRequestId, trusted) => {
    const app = createApp({
      isTrustedRequestId: () => trusted,
      registerRoutes: (router) => {
        router.get('/context', (request_, response) => {
          response.json({ requestId: request_.requestId });
        });
      },
    });

    const response = await request(app).get('/context').set('x-request-id', suppliedRequestId);
    const generatedRequestId = response.headers['x-request-id'];

    expect(response.status).toBe(200);
    expect(generatedRequestId).not.toBe(suppliedRequestId);
    expect(typeof generatedRequestId).toBe('string');
    expect(z.uuid().safeParse(generatedRequestId).success).toBe(true);
    expect(response.body).toEqual({ requestId: generatedRequestId });
  });

  it('keeps a generated request ID when the trust policy fails', async () => {
    const app = createApp({
      isTrustedRequestId: () => {
        throw new Error('trust policy unavailable');
      },
      reportUnexpectedError: () => undefined,
    });

    const response = await request(app)
      .get('/context')
      .set('x-request-id', '24dcfaac-4408-4d42-8d66-456ed6ee7ea4');
    const requestId = response.headers['x-request-id'];

    expect(response.status).toBe(500);
    expect(z.uuid().safeParse(requestId).success).toBe(true);
    expect(response.body as unknown).toMatchObject({ error: { requestId } });
  });

  it('keeps the error contract when trust evaluation fails before request logging is attached', async () => {
    const app = createApp({
      isTrustedRequestId: () => {
        throw new Error('trust policy unavailable');
      },
    });

    const firstResponse = await request(app)
      .get('/context')
      .set('x-request-id', '24dcfaac-4408-4d42-8d66-456ed6ee7ea4');
    const secondResponse = await request(app)
      .get('/context')
      .set('x-request-id', 'f61e102b-35e2-4502-b0a5-f0ae802cc653');

    expect(firstResponse.status).toBe(500);
    expect(secondResponse.status).toBe(500);
    expect(firstResponse.body as unknown).toMatchObject({
      error: { code: 'INTERNAL_ERROR', requestId: firstResponse.headers['x-request-id'] },
    });
    expect(secondResponse.body as unknown).toMatchObject({
      error: { code: 'INTERNAL_ERROR', requestId: secondResponse.headers['x-request-id'] },
    });
  });
});

describe('application errors', () => {
  it('exposes stable status, code, and safe messages for common failures', () => {
    expect(new ValidationError()).toMatchObject({
      status: 422,
      code: 'VALIDATION_ERROR',
      message: 'The request is invalid.',
    });
    expect(new NotFoundError()).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      message: 'The requested resource was not found.',
    });
    expect(new ConflictError()).toMatchObject({
      status: 409,
      code: 'CONFLICT',
      message: 'The request conflicts with the current state.',
    });
    expect(new RateLimitError(12)).toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      headers: { 'Retry-After': '12' },
    });
    expect(new IdempotencyKeyRequiredError()).toMatchObject({
      status: 400,
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    });
    expect(new InvalidIdempotencyKeyError()).toMatchObject({
      status: 422,
      code: 'INVALID_IDEMPOTENCY_KEY',
    });
    expect(new IdempotencyKeyReusedError()).toMatchObject({
      status: 422,
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
    expect(new RequestInProgressError(4)).toMatchObject({
      status: 409,
      code: 'REQUEST_IN_PROGRESS',
      headers: { 'Retry-After': '4' },
    });
  });

  it.each([
    ['failure', 502, 'PROVIDER_ERROR'],
    ['unavailable', 503, 'PROVIDER_UNAVAILABLE'],
    ['timeout', 504, 'PROVIDER_TIMEOUT'],
  ] as const)('maps provider %s errors to a stable HTTP contract', (kind, status, code) => {
    expect(new ProviderError(kind)).toMatchObject({ status, code });
  });

  it('preserves provider causes internally without changing the public contract', () => {
    const cause = new Error('provider credential leaked internally');

    const error = new ProviderError('failure', cause);

    expect(error.cause).toBe(cause);
    expect(error.message).toBe('An upstream service returned an error.');
  });

  it.each([0, 1.5, Number.POSITIVE_INFINITY])(
    'rejects an invalid Retry-After value of %s',
    (retryAfterSeconds) => {
      expect(() => new RateLimitError(retryAfterSeconds)).toThrow(RangeError);
    },
  );

  it.each([0, 1.5, Number.POSITIVE_INFINITY])(
    'rejects an invalid idempotency Retry-After value of %s',
    (retryAfterSeconds) => {
      expect(() => new RequestInProgressError(retryAfterSeconds)).toThrow(RangeError);
    },
  );
});

describe('request validation', () => {
  it('returns typed parsed input to the route handler', async () => {
    const schemas = {
      body: strictWriteSchema({ name: z.string().trim().min(1) }),
      params: z.object({ weddingId: z.uuid() }),
    };
    const app = express();
    app.use(express.json());
    app.post('/weddings/:weddingId', validateRequest(schemas), (_request, response) => {
      const input = validatedRequest(response, schemas);
      response.json({ data: input });
    });

    const response = await request(app)
      .post('/weddings/24dcfaac-4408-4d42-8d66-456ed6ee7ea4')
      .send({ name: '  An & Binh  ' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: {
        body: { name: 'An & Binh' },
        params: { weddingId: '24dcfaac-4408-4d42-8d66-456ed6ee7ea4' },
      },
    });
  });

  it('rejects unknown write fields instead of silently stripping them', async () => {
    const schemas = {
      body: strictWriteSchema({ name: z.string().min(1) }),
    };
    const app = createApp({
      registerRoutes: (router) => {
        router.post('/weddings', validateRequest(schemas), (_request, response) => {
          response.sendStatus(204);
        });
      },
    });

    const response = await request(app)
      .post('/weddings')
      .send({ name: 'An & Binh', isAdmin: true });

    expect(response.status).toBe(422);
    expect(response.body as unknown).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'The request is invalid.',
        details: [
          {
            path: 'isAdmin',
            code: 'unrecognized_keys',
            message: 'Unrecognized key: "isAdmin"',
          },
        ],
      },
    });
  });

  it('validates query and header boundaries and guards access before validation', async () => {
    const schemas = {
      query: z.object({ page: z.coerce.number().int().positive() }),
      headers: z.object({ 'x-client-version': z.string().min(1) }).passthrough(),
    };
    const app = express();
    app.get('/weddings', validateRequest(schemas), (_request, response) => {
      response.json({ data: validatedRequest(response, schemas) });
    });
    app.get('/unvalidated', (_request, response) => {
      expect(() => validatedRequest(response, schemas)).toThrow(
        'The request has not passed through validateRequest.',
      );
      response.sendStatus(204);
    });

    const validatedResponse = await request(app)
      .get('/weddings?page=2')
      .set('x-client-version', '1.0.0');
    const unvalidatedResponse = await request(app).get('/unvalidated');

    expect(validatedResponse.status).toBe(200);
    expect(validatedResponse.body as unknown).toMatchObject({
      data: {
        query: { page: 2 },
        headers: { 'x-client-version': '1.0.0' },
      },
    });
    expect(unvalidatedResponse.status).toBe(204);
  });
});

describe('error handler safeguards', () => {
  it('delegates when a response has already started', () => {
    const next = vi.fn();
    const error = new Error('late stream failure');
    const response = { headersSent: true } as Response;

    createErrorHandler()(error, {} as Request, response, next);

    expect(next).toHaveBeenCalledWith(error);
  });

  it.each([
    [new Error('password=must-not-be-logged'), 'Error'],
    ['token=must-not-be-logged', 'NonErrorThrownValue'],
  ])('reports only the safe %s classification by default', async (thrownValue, errorName) => {
    const logLines: string[] = [];
    const logger = createLogger({
      destination: new Writable({
        write(chunk, _encoding, callback) {
          logLines.push(String(chunk));
          callback();
        },
      }),
      level: 'info',
      runtimeEnvironment: 'test',
    });
    const app = createApp({
      logger,
      registerRoutes: (router) => {
        router.get('/unexpected', (_request, _response, next) => {
          next(thrownValue);
        });
      },
    });

    const response = await request(app).get('/unexpected');

    expect(response.status).toBe(500);
    expect(logLines.join('')).toContain(`"errorName":"${errorName}"`);
    expect(logLines.join('')).toContain(`"requestId":"${response.headers['x-request-id']}"`);
    expect(logLines.join('')).not.toContain('must-not-be-logged');
  });

  it('preserves the error contract when an unexpected-error reporter fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = createApp({
      reportUnexpectedError: () => {
        throw new Error('reporter unavailable');
      },
      registerRoutes: (router) => {
        router.get('/unexpected', () => {
          throw new Error('request failed');
        });
      },
    });

    try {
      const response = await request(app).get('/unexpected');

      expect(response.status).toBe(500);
      expect(response.body as unknown).toMatchObject({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred.',
          requestId: response.headers['x-request-id'],
        },
      });
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain('reporter unavailable');
    } finally {
      consoleError.mockRestore();
    }
  });

  it.each([
    [422, 'entity.parse.failed'],
    [400, 'different-parser-error'],
  ])('does not trust a SyntaxError with status %s and type %s', async (status, type) => {
    const parserLookalike = Object.assign(new SyntaxError('internal parser detail'), {
      status,
      type,
    });
    const app = createApp({
      reportUnexpectedError: () => undefined,
      registerRoutes: (router) => {
        router.get('/parser-lookalike', () => {
          throw parserLookalike;
        });
      },
    });

    const response = await request(app).get('/parser-lookalike');

    expect(response.status).toBe(500);
    expect(response.body as unknown).toMatchObject({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
      },
    });
  });
});
