import { Writable } from 'node:stream';

import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { createLogger, createProviderLogger } from '../../src/core/logging/logger.js';

const trustedRequestId = '24dcfaac-4408-4d42-8d66-456ed6ee7ea4';

type LogRecord = Record<string, unknown>;

function captureLogs(): {
  readonly destination: Writable;
  readonly lines: string[];
  readonly records: LogRecord[];
} {
  const lines: string[] = [];
  const records: LogRecord[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of String(chunk).trim().split('\n')) {
        if (line !== '') {
          lines.push(line);
          records.push(JSON.parse(line) as LogRecord);
        }
      }
      callback();
    },
  });

  return { destination, lines, records };
}

describe('request logging', () => {
  it('correlates normalized request and provider events without logging headers or bodies', async () => {
    const capture = captureLogs();
    const logger = createLogger({
      destination: capture.destination,
      level: 'info',
      runtimeEnvironment: 'test',
    });
    const secrets = {
      authorization: 'Bearer request-auth-secret',
      cookie: 'session=request-cookie-secret',
      email: 'couple@example.com',
      phone: '+84-900-000-000',
      token: 'invitation-token-secret',
      cardNumber: '4111111111111111',
      // A distinct canary cannot collide with a timestamp or duration such as22.123ms.
      cvv: 'sensitive-cvv-canary-123',
    };
    const app = createApp({
      isTrustedRequestId: () => true,
      logger,
      registerRoutes: (router) => {
        const weddingRouter = express.Router();
        weddingRouter.post('/:weddingId', (request_, response) => {
          createProviderLogger(request_.log, {
            entryPoint: 'http',
            module: 'notifications',
            provider: 'resend',
            requestId: request_.requestId,
          }).info(
            { event: 'provider_request_completed', providerCode: 'DELIVERED' },
            'provider request completed',
          );
          response.status(201).json({ data: { created: true } });
        });
        router.use('/weddings', weddingRouter);
      },
      runtimeEnvironment: 'test',
    });

    const response = await request(app)
      .post('/weddings/a0875e60-0a30-4b2d-8cb2-6baab854e1fb')
      .set('x-request-id', trustedRequestId)
      .set('authorization', secrets.authorization)
      .set('cookie', secrets.cookie)
      .send({
        invitationToken: secrets.token,
        contact: { email: secrets.email, phone: secrets.phone },
        payment: { cardNumber: secrets.cardNumber, cvv: secrets.cvv },
      });

    expect(response.status).toBe(201);
    expect(capture.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'provider_request_completed',
          requestId: trustedRequestId,
          entryPoint: 'http',
          provider: 'resend',
        }),
        expect.objectContaining({
          event: 'http_request_completed',
          requestId: trustedRequestId,
          entryPoint: 'http',
          module: 'http',
          route: '/weddings/:weddingId',
          method: 'POST',
          statusClass: '2xx',
        }),
      ]),
    );
    const completedRequest = capture.records.find(
      (record) => record.event === 'http_request_completed',
    );
    expect(typeof completedRequest?.durationMs).toBe('number');
    for (const record of capture.records) {
      expect(record).toMatchObject({ requestId: trustedRequestId, entryPoint: 'http' });
    }
    for (const line of capture.lines) {
      expect(line.match(/"requestId":/gu)).toHaveLength(1);
      expect(line.match(/"entryPoint":/gu)).toHaveLength(1);
      expect(line.match(/"module":/gu)).toHaveLength(1);
    }
    const serializedLogs = JSON.stringify(capture.records);
    for (const secret of Object.values(secrets)) {
      expect(serializedLogs).not.toContain(secret);
    }
  });

  it('locates an induced failure by request ID without leaking its error detail', async () => {
    const capture = captureLogs();
    const logger = createLogger({
      destination: capture.destination,
      level: 'info',
      runtimeEnvironment: 'test',
    });
    const app = createApp({
      isTrustedRequestId: () => true,
      logger,
      registerRoutes: (router) => {
        router.get('/failures/:failureId', () => {
          throw new Error('database password=induced-error-secret');
        });
      },
      runtimeEnvironment: 'test',
    });

    const response = await request(app)
      .get('/failures/a0875e60-0a30-4b2d-8cb2-6baab854e1fb')
      .set('x-request-id', trustedRequestId);

    expect(response.status).toBe(500);
    const relatedEvents = capture.records.filter((record) => record.requestId === trustedRequestId);
    expect(relatedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'http_request_error',
          level: 'error',
          errorName: 'Error',
        }),
        expect.objectContaining({
          event: 'http_request_completed',
          level: 'error',
          route: '/failures/:failureId',
          statusClass: '5xx',
          errorCode: 'INTERNAL_ERROR',
        }),
      ]),
    );
    for (const line of capture.lines) {
      expect(line.match(/"requestId":/gu)).toHaveLength(1);
      expect(line.match(/"entryPoint":/gu)).toHaveLength(1);
      expect(line.match(/"module":/gu)).toHaveLength(1);
    }
    expect(JSON.stringify(relatedEvents)).not.toContain('induced-error-secret');
  });
});
