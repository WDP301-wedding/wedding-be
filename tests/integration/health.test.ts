import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import {
  healthLiveResponseSchema,
  healthReadyResponseSchema,
  healthUnavailableResponseSchema,
} from '../../src/core/http/health.schemas.js';
import type { ReadinessProbe } from '../../src/core/http/readiness.js';

const trustedRequestId = '24dcfaac-4408-4d42-8d66-456ed6ee7ea4';

describe('health endpoints', () => {
  it('returns dependency-free liveness with a stable response schema', async () => {
    const readinessProbe = vi.fn<ReadinessProbe>().mockRejectedValue(new Error('database offline'));
    const app = createApp({
      isTrustedRequestId: () => true,
      readinessProbe,
    });

    const response = await request(app).get('/health/live').set('x-request-id', trustedRequestId);

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBe(trustedRequestId);
    expect(response.body).toEqual({
      data: { status: 'live', requestId: trustedRequestId },
    });
    expect(healthLiveResponseSchema.safeParse(response.body).success).toBe(true);
    expect(readinessProbe).not.toHaveBeenCalled();
  });

  it('returns readiness success from the injected probe', async () => {
    const readinessProbe = vi.fn<ReadinessProbe>().mockResolvedValue(undefined);
    const app = createApp({
      isTrustedRequestId: () => true,
      readinessProbe,
    });

    const response = await request(app).get('/health/ready').set('x-request-id', trustedRequestId);

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBe(trustedRequestId);
    expect(response.body).toEqual({
      data: { status: 'ready', requestId: trustedRequestId },
    });
    expect(healthReadyResponseSchema.safeParse(response.body).success).toBe(true);
    expect(readinessProbe).toHaveBeenCalledOnce();
    expect(readinessProbe).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it('returns the standard 503 contract without leaking probe failures', async () => {
    const readinessProbe = vi
      .fn<ReadinessProbe>()
      .mockRejectedValue(new Error('postgres password=super-secret'));
    const app = createApp({
      isTrustedRequestId: () => true,
      readinessProbe,
    });

    const response = await request(app).get('/health/ready').set('x-request-id', trustedRequestId);

    expect(response.status).toBe(503);
    expect(response.headers['x-request-id']).toBe(trustedRequestId);
    expect(response.body).toEqual({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'The service is not ready.',
        requestId: trustedRequestId,
      },
    });
    expect(healthUnavailableResponseSchema.safeParse(response.body).success).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain('super-secret');
  });

  it('bounds a stalled readiness probe and keeps liveness healthy', async () => {
    let receivedSignal: AbortSignal | undefined;
    const readinessProbe = vi.fn<ReadinessProbe>().mockImplementation(
      (signal) =>
        new Promise<void>((_resolve, reject) => {
          receivedSignal = signal;
          signal.addEventListener(
            'abort',
            () => reject(new Error('Readiness probe aborted.', { cause: signal.reason })),
            { once: true },
          );
        }),
    );
    const app = createApp({
      isTrustedRequestId: () => true,
      readinessProbe,
      readinessTimeoutMs: 10,
    });

    const readyResponse = await request(app)
      .get('/health/ready')
      .set('x-request-id', trustedRequestId);
    const liveResponse = await request(app)
      .get('/health/live')
      .set('x-request-id', trustedRequestId);

    expect(readyResponse.status).toBe(503);
    expect(receivedSignal?.aborted).toBe(true);
    expect(liveResponse.status).toBe(200);
    expect(healthLiveResponseSchema.safeParse(liveResponse.body).success).toBe(true);
    expect(readinessProbe).toHaveBeenCalledOnce();
  });
});
