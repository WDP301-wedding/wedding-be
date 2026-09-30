import { randomUUID } from 'node:crypto';

import type { RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../app.js';
import { ProviderError, ValidationError } from '../errors/app-error.js';
import { createIdempotencyMiddleware } from './idempotency.middleware.js';
import { createIdempotencyNamespace, defineIdempotencyPolicy } from './idempotency.policy.js';
import type { IdempotencyRecord } from './idempotency.repository.js';
import type {
  IdempotencyClaimResult,
  IdempotencyService,
  StoreIdempotencyResultInput,
} from './idempotency.service.js';

function idempotencyRecord(overrides: Partial<IdempotencyRecord> = {}): IdempotencyRecord {
  const now = new Date('2026-09-29T01:00:00.000Z');

  return {
    id: randomUUID(),
    namespace: createIdempotencyNamespace({
      actorScope: 'user:user-1',
      method: 'POST',
      normalizedRoute: '/api/v1/bookings',
      operationVersion: 'v1',
    }),
    idempotencyKey: 'booking-intent-1',
    requestHash: 'a'.repeat(64),
    status: 'IN_PROGRESS',
    responseStatus: null,
    responseBody: null,
    resourceType: null,
    resourceId: null,
    lockedAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function serviceForClaim(claim: IdempotencyClaimResult): {
  readonly service: IdempotencyService;
  readonly claim: ReturnType<typeof vi.fn>;
  readonly markSucceeded: ReturnType<typeof vi.fn>;
  readonly markFailed: ReturnType<typeof vi.fn>;
} {
  const claimMock = vi.fn().mockResolvedValue(claim);
  const markSucceeded = vi
    .fn<(input: StoreIdempotencyResultInput) => Promise<IdempotencyRecord>>()
    .mockImplementation((input) =>
      Promise.resolve(
        idempotencyRecord({
          id: input.claimId,
          status: 'SUCCEEDED',
          responseStatus: input.responseStatus,
          responseBody: input.responseBody ?? null,
        }),
      ),
    );
  const markFailed = vi
    .fn<(input: StoreIdempotencyResultInput) => Promise<IdempotencyRecord>>()
    .mockImplementation((input) =>
      Promise.resolve(
        idempotencyRecord({
          id: input.claimId,
          status: 'FAILED',
          responseStatus: input.responseStatus,
          responseBody: input.responseBody ?? null,
        }),
      ),
    );

  return {
    service: {
      claim: claimMock,
      markSucceeded,
      markFailed,
    },
    claim: claimMock,
    markSucceeded,
    markFailed,
  };
}

function createProtectedApp(
  service: IdempotencyService,
  handler: RequestHandler,
  includeRetention = true,
) {
  return createApp({
    reportUnexpectedError: () => undefined,
    registerRoutes: (router) => {
      router.post(
        '/bookings',
        createIdempotencyMiddleware({
          service,
          policy: defineIdempotencyPolicy({
            actorScope: () => 'user:user-1',
            normalizedRoute: '/api/v1/bookings',
            operationVersion: 'v1',
            payload: (request_) => request_.body as unknown,
            ...(includeRetention ? { retentionMs: 60_000 } : {}),
            retryAfterSeconds: 3,
          }),
        }),
        handler,
      );
    },
  });
}

function post(app: ReturnType<typeof createApp>, key = 'booking-intent-1') {
  return request(app)
    .post('/bookings')
    .set('Idempotency-Key', key)
    .send({ amountMinor: 5_000_000 });
}

describe('idempotency HTTP middleware', () => {
  it('does not claim missing or invalid keys', async () => {
    const claimed = idempotencyRecord();
    const { service, claim } = serviceForClaim({ outcome: 'CLAIMED', record: claimed });
    const handler = vi.fn<RequestHandler>((_request, response) => {
      response.sendStatus(204);
    });
    const app = createProtectedApp(service, handler);

    const missing = await request(app).post('/bookings').send({ amountMinor: 5_000_000 });
    const invalid = await post(app, 'a'.repeat(129));

    expect(missing.body as unknown).toMatchObject({
      error: { code: 'IDEMPOTENCY_KEY_REQUIRED' },
    });
    expect(invalid.body as unknown).toMatchObject({
      error: { code: 'INVALID_IDEMPOTENCY_KEY' },
    });
    expect(claim).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([
    ['MISMATCH', 422, 'IDEMPOTENCY_KEY_REUSED'],
    ['IN_PROGRESS', 409, 'REQUEST_IN_PROGRESS'],
  ] as const)('maps %s without executing the handler', async (outcome, status, code) => {
    const record = idempotencyRecord();
    const { service } = serviceForClaim({ outcome, record });
    const handler = vi.fn<RequestHandler>((_request, response) => {
      response.sendStatus(204);
    });
    const app = createProtectedApp(service, handler);

    const response = await post(app);

    expect(response.status).toBe(status);
    expect(response.body as unknown).toMatchObject({ error: { code } });
    expect(handler).not.toHaveBeenCalled();
    if (outcome === 'IN_PROGRESS') {
      expect(response.headers['retry-after']).toBe('3');
    }
  });

  it.each(['SUCCEEDED', 'FAILED'] as const)(
    'replays a terminal %s record without executing the handler',
    async (outcome) => {
      const responseStatus = outcome === 'SUCCEEDED' ? 201 : 422;
      const responseBody =
        outcome === 'SUCCEEDED'
          ? { data: { id: randomUUID() } }
          : { error: { code: 'BOOKING_REJECTED', requestId: randomUUID() } };
      const record = idempotencyRecord({ status: outcome, responseStatus, responseBody });
      const { service } = serviceForClaim({ outcome, record });
      const handler = vi.fn<RequestHandler>((_request, response) => {
        response.sendStatus(204);
      });
      const app = createProtectedApp(service, handler);

      const response = await post(app);

      expect(response.status).toBe(responseStatus);
      expect(response.body as unknown).toMatchObject(
        outcome === 'SUCCEEDED'
          ? responseBody
          : { error: { code: 'BOOKING_REJECTED', requestId: response.headers['x-request-id'] } },
      );
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it('stores a successful JSON response before sending it', async () => {
    const record = idempotencyRecord();
    const { service, claim, markSucceeded, markFailed } = serviceForClaim({
      outcome: 'CLAIMED',
      record,
    });
    const resourceId = randomUUID();
    const app = createProtectedApp(service, (_request, response) => {
      response.status(201).send({ data: { id: resourceId } });
    });

    const response = await post(app);

    expect(response).toMatchObject({ status: 201, body: { data: { id: resourceId } } });
    expect(claim).toHaveBeenCalledWith({
      namespace: record.namespace,
      idempotencyKey: record.idempotencyKey,
      payload: { amountMinor: 5_000_000 },
      retentionMs: 60_000,
    });
    expect(markSucceeded).toHaveBeenCalledWith({
      claimId: record.id,
      responseStatus: 201,
      responseBody: { data: { id: resourceId } },
    });
    expect(markFailed).not.toHaveBeenCalled();
  });

  it('uses the service default retention when the route policy omits it', async () => {
    const record = idempotencyRecord();
    const { service, claim } = serviceForClaim({ outcome: 'CLAIMED', record });
    const app = createProtectedApp(
      service,
      (_request, response) => {
        response.status(201).json({ data: { id: randomUUID() } });
      },
      false,
    );

    await post(app);

    expect(claim).toHaveBeenCalledWith({
      namespace: record.namespace,
      idempotencyKey: record.idempotencyKey,
      payload: { amountMinor: 5_000_000 },
    });
  });

  it('stores deterministic application failures for replay', async () => {
    const record = idempotencyRecord();
    const { service, markSucceeded, markFailed } = serviceForClaim({
      outcome: 'CLAIMED',
      record,
    });
    const app = createProtectedApp(service, () => {
      throw new ValidationError();
    });

    const response = await post(app);

    expect(response.status).toBe(422);
    expect(markFailed).toHaveBeenCalledWith({
      claimId: record.id,
      responseStatus: 422,
      responseBody: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The request is invalid.',
          requestId: response.headers['x-request-id'],
        },
      },
    });
    expect(markSucceeded).not.toHaveBeenCalled();
  });

  it('keeps unknown 5xx outcomes in progress', async () => {
    const record = idempotencyRecord();
    const { service, markSucceeded, markFailed } = serviceForClaim({
      outcome: 'CLAIMED',
      record,
    });
    const app = createProtectedApp(service, () => {
      throw new ProviderError('timeout');
    });

    const response = await post(app);

    expect(response.status).toBe(504);
    expect(markSucceeded).not.toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
  });

  it('stores a direct no-content response as a successful null body', async () => {
    const record = idempotencyRecord();
    const { service, markSucceeded } = serviceForClaim({ outcome: 'CLAIMED', record });
    const app = createProtectedApp(service, (_request, response) => {
      response.status(204).end();
    });

    const response = await post(app);

    expect(response.status).toBe(204);
    expect(markSucceeded).toHaveBeenCalledWith({
      claimId: record.id,
      responseStatus: 204,
      responseBody: null,
    });
  });

  it('captures a JSON buffer response using a structured JSON media type', async () => {
    const record = idempotencyRecord();
    const { service, markSucceeded } = serviceForClaim({ outcome: 'CLAIMED', record });
    const app = createProtectedApp(service, (_request, response) => {
      response
        .status(201)
        .type('application/problem+json')
        .send(Buffer.from('{"data":{"accepted":true}}'));
    });

    const response = await post(app);

    expect(response.status).toBe(201);
    expect(markSucceeded).toHaveBeenCalledWith({
      claimId: record.id,
      responseStatus: 201,
      responseBody: { data: { accepted: true } },
    });
  });

  it('keeps the claim in progress when a non-JSON response cannot be replayed safely', async () => {
    const record = idempotencyRecord();
    const { service, markSucceeded, markFailed } = serviceForClaim({
      outcome: 'CLAIMED',
      record,
    });
    const app = createProtectedApp(service, (_request, response) => {
      response.type('text/plain').send('not replayable as JSON');
    });

    const response = await post(app);

    expect(response.status).toBe(500);
    expect(response.body as unknown).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
    expect(markSucceeded).not.toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
  });

  it('returns a safe 500 and keeps the claim in progress when completion persistence fails', async () => {
    const record = idempotencyRecord();
    const { service, markSucceeded } = serviceForClaim({ outcome: 'CLAIMED', record });
    markSucceeded.mockRejectedValueOnce(new Error('database credential leaked internally'));
    const app = createProtectedApp(service, (_request, response) => {
      response.status(201).json({ data: { id: randomUUID() } });
    });

    const response = await post(app);

    expect(response.status).toBe(500);
    expect(response.body as unknown).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
    expect(JSON.stringify(response.body)).not.toContain('credential');
  });

  it('returns a safe 500 for a corrupt terminal record', async () => {
    const record = idempotencyRecord({ status: 'SUCCEEDED', responseStatus: null });
    const { service } = serviceForClaim({ outcome: 'SUCCEEDED', record });
    const handler = vi.fn<RequestHandler>((_request, response) => {
      response.sendStatus(204);
    });
    const app = createProtectedApp(service, handler);

    const response = await post(app);

    expect(response.status).toBe(500);
    expect(response.body as unknown).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([204, 205])('replays a terminal %s response without a body', async (status) => {
    const record = idempotencyRecord({
      status: 'SUCCEEDED',
      responseStatus: status,
      responseBody: null,
    });
    const { service } = serviceForClaim({ outcome: 'SUCCEEDED', record });
    const app = createProtectedApp(service, (_request, response) => response.sendStatus(500));

    const response = await post(app);

    expect(response.status).toBe(status);
    expect(response.text).toBe('');
  });

  it('replays a primitive terminal body unchanged', async () => {
    const record = idempotencyRecord({
      status: 'SUCCEEDED',
      responseStatus: 200,
      responseBody: true,
    });
    const { service } = serviceForClaim({ outcome: 'SUCCEEDED', record });
    const app = createProtectedApp(service, (_request, response) => response.sendStatus(500));

    const response = await post(app);

    expect(response.status).toBe(200);
    expect(response.body).toBe(true);
  });

  it('does not rewrite an error-shaped field in a successful response', async () => {
    const originalRequestId = randomUUID();
    const record = idempotencyRecord({
      status: 'SUCCEEDED',
      responseStatus: 200,
      responseBody: { error: { code: 'DOMAIN_DATA', requestId: originalRequestId } },
    });
    const { service } = serviceForClaim({ outcome: 'SUCCEEDED', record });
    const app = createProtectedApp(service, (_request, response) => response.sendStatus(500));

    const response = await post(app);

    expect(response.status).toBe(200);
    expect(response.body as unknown).toEqual({
      error: { code: 'DOMAIN_DATA', requestId: originalRequestId },
    });
  });

  it.each([
    [null, null],
    [{ data: { rejected: true } }, { data: { rejected: true } }],
  ] as const)('replays a non-standard failed body without rewriting it', async (body, expected) => {
    const record = idempotencyRecord({
      status: 'FAILED',
      responseStatus: 422,
      responseBody: body,
    });
    const { service } = serviceForClaim({ outcome: 'FAILED', record });
    const app = createProtectedApp(service, (_request, response) => response.sendStatus(500));

    const response = await post(app);

    expect(response.status).toBe(422);
    expect(response.body as unknown).toEqual(expected);
  });
});
