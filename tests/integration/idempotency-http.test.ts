import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createApp } from '../../src/app.js';
import { createPrismaClient } from '../../src/core/database/prisma.js';
import { ProviderError, ValidationError } from '../../src/core/errors/app-error.js';
import {
  strictWriteSchema,
  validateRequest,
  validatedRequest,
} from '../../src/core/http/validate.js';
import { createIdempotencyMiddleware } from '../../src/core/idempotency/idempotency.middleware.js';
import {
  createIdempotencyNamespace,
  defineIdempotencyPolicy,
} from '../../src/core/idempotency/idempotency.policy.js';
import { createPrismaIdempotencyRepository } from '../../src/core/idempotency/idempotency.repository.js';
import { createIdempotencyService } from '../../src/core/idempotency/idempotency.service.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
const describeWithDatabase =
  databaseUrl === undefined || databaseUrl === '' ? describe.skip : describe;
const testDatabaseUrl = databaseUrl ?? 'postgresql://unused:unused@127.0.0.1:1/unused';
const databaseTestTimeoutMs = 30_000;

const trustedRequestId = '24dcfaac-4408-4d42-8d66-456ed6ee7ea4';
const replayRequestId = 'f61e102b-35e2-4502-b0a5-f0ae802cc653';
const requestSchemas = {
  body: strictWriteSchema({
    action: z.enum(['SUCCESS', 'FAILURE', 'TIMEOUT']),
    amountMinor: z.number().int().positive(),
  }),
};

type ProtectedHandler = (
  request: Request,
  response: Response,
  next: NextFunction,
) => void | Promise<void>;

describeWithDatabase('idempotency HTTP claim and replay', () => {
  const prisma = createPrismaClient(testDatabaseUrl);
  const service = createIdempotencyService(createPrismaIdempotencyRepository(prisma));

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function createProtectedApp(actorScope: string, handler: ProtectedHandler) {
    return createApp({
      isTrustedRequestId: () => true,
      reportUnexpectedError: () => undefined,
      registerRoutes: (router) => {
        router.post(
          '/api/v1/idempotency-test',
          validateRequest(requestSchemas),
          createIdempotencyMiddleware({
            service,
            policy: defineIdempotencyPolicy({
              actorScope: () => actorScope,
              normalizedRoute: '/api/v1/idempotency-test',
              operationVersion: 'v1',
              payload: (_request, response) => validatedRequest(response, requestSchemas).body,
              retryAfterSeconds: 1,
            }),
          }),
          handler as RequestHandler,
        );
      },
    });
  }

  async function deleteNamespace(namespace: string): Promise<void> {
    await prisma.idempotencyRecord.deleteMany({ where: { namespace } });
  }

  function namespaceFor(actorScope: string): string {
    return createIdempotencyNamespace({
      actorScope,
      method: 'POST',
      normalizedRoute: '/api/v1/idempotency-test',
      operationVersion: 'v1',
    });
  }

  it(
    'rejects missing and malformed keys with stable errors before claiming',
    async () => {
      const actorScope = `http-key-validation-${randomUUID()}`;
      const namespace = namespaceFor(actorScope);
      let executions = 0;
      const app = createProtectedApp(actorScope, (_request, response) => {
        executions += 1;
        response.status(201).json({ data: { id: randomUUID() } });
      });

      try {
        const missing = await request(app)
          .post('/api/v1/idempotency-test')
          .set('x-request-id', trustedRequestId)
          .send({ action: 'SUCCESS', amountMinor: 5_000_000 });
        const malformed = await request(app)
          .post('/api/v1/idempotency-test')
          .set('x-request-id', trustedRequestId)
          .set('Idempotency-Key', 'a'.repeat(129))
          .send({ action: 'SUCCESS', amountMinor: 5_000_000 });

        expect(missing).toMatchObject({
          status: 400,
          body: {
            error: {
              code: 'IDEMPOTENCY_KEY_REQUIRED',
              message: 'An Idempotency-Key header is required.',
              requestId: trustedRequestId,
            },
          },
        });
        expect(malformed).toMatchObject({
          status: 422,
          body: {
            error: {
              code: 'INVALID_IDEMPOTENCY_KEY',
              message: 'The Idempotency-Key header is invalid.',
              requestId: trustedRequestId,
            },
          },
        });
        expect(executions).toBe(0);
        await expect(prisma.idempotencyRecord.count({ where: { namespace } })).resolves.toBe(0);
      } finally {
        await deleteNamespace(namespace);
      }
    },
    databaseTestTimeoutMs,
  );

  it(
    'validates the request before claiming an idempotency key',
    async () => {
      const actorScope = `http-validation-order-${randomUUID()}`;
      const namespace = namespaceFor(actorScope);
      let executions = 0;
      const app = createProtectedApp(actorScope, (_request, response) => {
        executions += 1;
        response.status(201).json({ data: { id: randomUUID() } });
      });

      try {
        const response = await request(app)
          .post('/api/v1/idempotency-test')
          .set('Idempotency-Key', 'validation-before-claim')
          .send({ action: 'SUCCESS', amountMinor: 0 });

        expect(response.status).toBe(422);
        expect(response.body as unknown).toMatchObject({
          error: { code: 'VALIDATION_ERROR' },
        });
        expect(executions).toBe(0);
        await expect(prisma.idempotencyRecord.count({ where: { namespace } })).resolves.toBe(0);
      } finally {
        await deleteNamespace(namespace);
      }
    },
    databaseTestTimeoutMs,
  );

  it(
    'replays a completed response and rejects the same key with a different payload',
    async () => {
      const actorScope = `http-replay-${randomUUID()}`;
      const namespace = namespaceFor(actorScope);
      const resourceId = randomUUID();
      let executions = 0;
      const app = createProtectedApp(actorScope, (_request, response) => {
        executions += 1;
        response.status(201).json({ data: { id: resourceId } });
      });

      try {
        const first = await request(app)
          .post('/api/v1/idempotency-test')
          .set('Idempotency-Key', 'create-booking')
          .send({ action: 'SUCCESS', amountMinor: 5_000_000 });
        const replay = await request(app)
          .post('/api/v1/idempotency-test')
          .set('Idempotency-Key', 'create-booking')
          .send({ amountMinor: 5_000_000, action: 'SUCCESS' });
        const mismatch = await request(app)
          .post('/api/v1/idempotency-test')
          .set('Idempotency-Key', 'create-booking')
          .send({ action: 'SUCCESS', amountMinor: 5_000_001 });
        const stored = await prisma.idempotencyRecord.findUniqueOrThrow({
          where: {
            namespace_idempotencyKey: { namespace, idempotencyKey: 'create-booking' },
          },
        });

        expect(first).toMatchObject({ status: 201, body: { data: { id: resourceId } } });
        expect(replay).toMatchObject({ status: 201, body: first.body as unknown });
        expect(mismatch).toMatchObject({
          status: 422,
          body: {
            error: {
              code: 'IDEMPOTENCY_KEY_REUSED',
              message: 'The Idempotency-Key was already used for a different request.',
            },
          },
        });
        expect(executions).toBe(1);
        expect(stored).toMatchObject({
          status: 'SUCCEEDED',
          responseStatus: 201,
          responseBody: { data: { id: resourceId } },
        });
      } finally {
        await deleteNamespace(namespace);
      }
    },
    databaseTestTimeoutMs,
  );

  it(
    'lets one concurrent request execute and rejects the in-flight duplicate',
    async () => {
      const actorScope = `http-concurrent-${randomUUID()}`;
      const namespace = namespaceFor(actorScope);
      let executions = 0;
      let releaseHandler: (() => void) | undefined;
      let markHandlerStarted: (() => void) | undefined;
      const handlerStarted = new Promise<void>((resolve) => {
        markHandlerStarted = resolve;
      });
      const handlerRelease = new Promise<void>((resolve) => {
        releaseHandler = resolve;
      });
      const app = createProtectedApp(actorScope, async (_request, response) => {
        executions += 1;
        markHandlerStarted?.();
        await handlerRelease;
        response.status(201).json({ data: { id: randomUUID() } });
      });

      try {
        const firstResponse = request(app)
          .post('/api/v1/idempotency-test')
          .set('Idempotency-Key', 'concurrent-booking')
          .send({ action: 'SUCCESS', amountMinor: 5_000_000 })
          .then((response) => response);
        await handlerStarted;

        const duplicate = await request(app)
          .post('/api/v1/idempotency-test')
          .set('Idempotency-Key', 'concurrent-booking')
          .send({ action: 'SUCCESS', amountMinor: 5_000_000 });

        expect(duplicate).toMatchObject({
          status: 409,
          body: {
            error: {
              code: 'REQUEST_IN_PROGRESS',
              message: 'A request with this Idempotency-Key is still in progress.',
            },
          },
        });
        expect(duplicate.headers['retry-after']).toBe('1');
        expect(executions).toBe(1);

        releaseHandler?.();
        await expect(firstResponse).resolves.toMatchObject({ status: 201 });
        await expect(
          prisma.idempotencyRecord.findUniqueOrThrow({
            where: {
              namespace_idempotencyKey: {
                namespace,
                idempotencyKey: 'concurrent-booking',
              },
            },
          }),
        ).resolves.toMatchObject({ status: 'SUCCEEDED' });
      } finally {
        releaseHandler?.();
        await deleteNamespace(namespace);
      }
    },
    databaseTestTimeoutMs,
  );

  it(
    'stores and replays deterministic failures with the current request ID',
    async () => {
      const actorScope = `http-failure-${randomUUID()}`;
      const namespace = namespaceFor(actorScope);
      let executions = 0;
      const app = createProtectedApp(actorScope, () => {
        executions += 1;
        throw new ValidationError([
          {
            path: 'amountMinor',
            code: 'booking_policy',
            message: 'The amount is not allowed for this booking.',
          },
        ]);
      });

      try {
        const first = await request(app)
          .post('/api/v1/idempotency-test')
          .set('x-request-id', trustedRequestId)
          .set('Idempotency-Key', 'rejected-booking')
          .send({ action: 'FAILURE', amountMinor: 5_000_000 });
        const replay = await request(app)
          .post('/api/v1/idempotency-test')
          .set('x-request-id', replayRequestId)
          .set('Idempotency-Key', 'rejected-booking')
          .send({ action: 'FAILURE', amountMinor: 5_000_000 });
        const stored = await prisma.idempotencyRecord.findUniqueOrThrow({
          where: {
            namespace_idempotencyKey: { namespace, idempotencyKey: 'rejected-booking' },
          },
        });

        expect(first.status).toBe(422);
        expect(first.body as unknown).toMatchObject({
          error: { code: 'VALIDATION_ERROR', requestId: trustedRequestId },
        });
        expect(replay.status).toBe(422);
        expect(replay.body as unknown).toMatchObject({
          error: { code: 'VALIDATION_ERROR', requestId: replayRequestId },
        });
        expect(executions).toBe(1);
        expect(stored).toMatchObject({ status: 'FAILED', responseStatus: 422 });
      } finally {
        await deleteNamespace(namespace);
      }
    },
    databaseTestTimeoutMs,
  );

  it(
    'keeps a provider timeout in progress so retries cannot repeat an unknown effect',
    async () => {
      const actorScope = `http-timeout-${randomUUID()}`;
      const namespace = namespaceFor(actorScope);
      let externalEffects = 0;
      const app = createProtectedApp(actorScope, () => {
        externalEffects += 1;
        throw new ProviderError('timeout');
      });

      try {
        const first = await request(app)
          .post('/api/v1/idempotency-test')
          .set('Idempotency-Key', 'unknown-payment')
          .send({ action: 'TIMEOUT', amountMinor: 5_000_000 });
        const retry = await request(app)
          .post('/api/v1/idempotency-test')
          .set('Idempotency-Key', 'unknown-payment')
          .send({ action: 'TIMEOUT', amountMinor: 5_000_000 });
        const stored = await prisma.idempotencyRecord.findUniqueOrThrow({
          where: {
            namespace_idempotencyKey: { namespace, idempotencyKey: 'unknown-payment' },
          },
        });

        expect(first).toMatchObject({
          status: 504,
          body: { error: { code: 'PROVIDER_TIMEOUT' } },
        });
        expect(retry).toMatchObject({
          status: 409,
          body: { error: { code: 'REQUEST_IN_PROGRESS' } },
        });
        expect(externalEffects).toBe(1);
        expect(stored).toMatchObject({
          status: 'IN_PROGRESS',
          responseStatus: null,
          responseBody: null,
        });
      } finally {
        await deleteNamespace(namespace);
      }
    },
    databaseTestTimeoutMs,
  );
});
