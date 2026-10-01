import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import { errorResponseSchema } from '../../src/core/http/common.schemas.js';
import { createObservabilityMetrics } from '../../src/core/observability/metrics.js';

describe('internal metrics endpoint', () => {
  it('is absent by default', async () => {
    const metrics = createObservabilityMetrics();
    const response = await request(createApp({ observabilityMetrics: metrics })).get(
      '/internal/metrics',
    );

    expect(response.status).toBe(404);
    const body = errorResponseSchema.parse(response.body);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('rejects missing and incorrect bearer credentials with the common error envelope', async () => {
    const app = createApp({
      metricsConfig: { enabled: true, token: 'metrics-secret' },
    });

    for (const authorization of [undefined, 'Bearer wrong-secret']) {
      const operation = request(app).get('/internal/metrics');
      const response =
        authorization === undefined
          ? await operation
          : await operation.set('authorization', authorization);

      expect(response.status).toBe(401);
      expect(response.headers['www-authenticate']).toBe('Bearer realm="metrics"');
      const body = errorResponseSchema.parse(response.body);
      expect(body).toMatchObject({
        error: {
          code: 'METRICS_UNAUTHORIZED',
          message: 'Valid metrics credentials are required.',
        },
      });
      expect(body.error.requestId).toEqual(expect.any(String));
    }
  });

  it('exports bounded HTTP success, error, and latency series without raw request data', async () => {
    const metrics = createObservabilityMetrics();
    const app = createApp({
      metricsConfig: { enabled: true, token: 'metrics-secret' },
      observabilityMetrics: metrics,
      registerRoutes(expressApp) {
        expressApp.get('/api/v1/couples/:coupleId', (_request, response) => {
          response.status(204).end();
        });
        expressApp.get('/api/v1/failures/:failureId', () => {
          throw new Error('private provider message');
        });
      },
    });
    const coupleId = '67a9ab42-9f39-4dd1-b2ac-e838e6556935';
    const failureId = '90c87ef3-39ad-4aab-9cd8-e2dca1fcb740';

    await request(app).get(`/api/v1/couples/${coupleId}?email=private@example.com`).expect(204);
    await request(app).get(`/api/v1/failures/${failureId}`).expect(500);
    const response = await request(app)
      .get('/internal/metrics')
      .set('authorization', 'Bearer metrics-secret')
      .expect(200);

    expect(response.headers['content-type']).toMatch(/^text\/plain/u);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.text).toContain(
      'wedding_http_requests_total{method="GET",route="/api/v1/couples/:coupleId",status_class="2xx"} 1',
    );
    expect(response.text).toContain(
      'wedding_http_request_errors_total{method="GET",route="/api/v1/failures/:failureId",status_class="5xx"} 1',
    );
    expect(response.text).toContain(
      'wedding_http_request_duration_seconds_count{method="GET",route="/api/v1/failures/:failureId",status_class="5xx"} 1',
    );
    expect(response.text).not.toContain(coupleId);
    expect(response.text).not.toContain(failureId);
    expect(response.text).not.toContain('private@example.com');
    expect(response.text).not.toContain('private provider message');
    expect(response.text).not.toContain('metrics-secret');
  });
});
