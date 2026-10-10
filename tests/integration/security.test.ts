import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { parseEnvironment } from '../../src/config/env.js';
import { bootstrap } from '../../src/server.js';
import { createVenueCatalogRuntime } from '../../src/modules/venue-catalog/venue-catalog.runtime.js';
import { createPaymentsBillingRuntime } from '../../src/modules/payments-billing/payments-billing.runtime.js';

vi.mock('../../src/modules/identity-access/identity.runtime.js', async () => {
  const { Router } = await import('express');

  return {
    createIdentityRuntime: vi.fn(() => ({
      router: Router(),
      resource: { name: 'identity-database', close: vi.fn() },
    })),
  };
});

vi.mock('../../src/core/database/database-readiness.js', () => ({
  DATABASE_READINESS_TIMEOUT_MS: 5_000,
  createDatabaseReadiness: vi.fn(() => ({
    probe: () => Promise.resolve(),
    resource: { name: 'database-readiness', close: () => Promise.resolve() },
  })),
}));

vi.mock('../../src/modules/invitation-studio/invitation-studio.runtime.js', async () => {
  const { Router } = await import('express');
  return {
    createInvitationStudioRuntime: vi.fn(() => ({
      router: Router(),
      resource: { name: 'invitation-studio-database', close: vi.fn() },
    })),
  };
});

vi.mock('../../src/modules/venue-catalog/venue-catalog.runtime.js', async () => {
  const { Router } = await import('express');

  return {
    createVenueCatalogRuntime: vi.fn(() => ({
      router: Router(),
      resource: { name: 'venue-catalog-database', close: vi.fn() },
    })),
  };
});

vi.mock('../../src/modules/booking-lifecycle/booking-lifecycle.runtime.js', async () => {
  const { Router } = await import('express');
  return {
    createBookingLifecycleRuntime: vi.fn(() => ({
      router: Router(),
      resource: { name: 'booking-lifecycle-database', close: vi.fn() },
    })),
  };
});

vi.mock('../../src/modules/payments-billing/payments-billing.runtime.js', async () => {
  const { Router } = await import('express');
  return {
    createPaymentsBillingRuntime: vi.fn(() => ({
      router: Router(),
      resource: { name: 'payments-billing-database', close: vi.fn() },
    })),
  };
});

const trustedRequestId = '24dcfaac-4408-4d42-8d66-456ed6ee7ea4';
const allowedOrigin = 'https://wedding.example.com';

const defaultSecurityConfig = {
  bodyLimitBytes: 1_048_576,
  requestTimeoutMs: 30_000,
  rateLimit: {
    maxRequests: 100,
    windowMs: 60_000,
  },
  replicaCount: 1 as const,
};

function expectStandardError(
  response: request.Response,
  expected: { readonly status: number; readonly code: string; readonly message: string },
): void {
  expect(response.status).toBe(expected.status);
  expect(response.headers['x-request-id']).toBe(trustedRequestId);
  expect(response.body as unknown).toEqual({
    error: {
      code: expected.code,
      message: expected.message,
      requestId: trustedRequestId,
    },
  });
}

describe('HTTP security baseline', () => {
  it('sets production security headers and permits only a configured credentialed origin', async () => {
    const app = createApp({
      corsConfig: { allowedOrigins: [allowedOrigin] },
      isTrustedRequestId: () => true,
      runtimeEnvironment: 'production',
    });

    const response = await request(app)
      .get('/health/live')
      .set('origin', allowedOrigin)
      .set('x-request-id', trustedRequestId);

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe(allowedOrigin);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers.vary).toContain('Origin');
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('does not advertise HSTS in local development', async () => {
    const response = await request(createApp({ runtimeEnvironment: 'development' })).get(
      '/health/live',
    );

    expect(response.status).toBe(200);
    expect(response.headers['strict-transport-security']).toBeUndefined();
    expect(response.headers['content-security-policy']).toBeDefined();
  });

  it('rejects an unconfigured browser origin through the common error envelope', async () => {
    const app = createApp({
      corsConfig: { allowedOrigins: [allowedOrigin] },
      isTrustedRequestId: () => true,
    });

    const response = await request(app)
      .get('/health/live')
      .set('origin', 'https://attacker.example')
      .set('x-request-id', trustedRequestId);

    expectStandardError(response, {
      status: 403,
      code: 'CORS_ORIGIN_DENIED',
      message: 'The request origin is not allowed.',
    });
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows non-browser requests without an Origin header', async () => {
    const response = await request(
      createApp({ corsConfig: { allowedOrigins: [allowedOrigin] } }),
    ).get('/health/live');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers allowed CORS preflight requests with an explicit policy', async () => {
    const app = createApp({ corsConfig: { allowedOrigins: [allowedOrigin] } });

    const response = await request(app)
      .options('/api/v1/weddings')
      .set('origin', allowedOrigin)
      .set('access-control-request-method', 'POST')
      .set('access-control-request-headers', 'authorization,content-type,idempotency-key');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(allowedOrigin);
    expect(response.headers['access-control-allow-methods']).toBe(
      'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS',
    );
    expect(response.headers['access-control-allow-headers']).toBe(
      'Authorization,Content-Type,Idempotency-Key,X-Request-Id',
    );
  });

  it('maps an oversized JSON body to the common 413 error envelope', async () => {
    const app = createApp({
      isTrustedRequestId: () => true,
      securityConfig: {
        ...defaultSecurityConfig,
        bodyLimitBytes: 32,
      },
      registerRoutes: (router) => {
        router.post('/api/v1/security/body', (_request, response) => {
          response.sendStatus(204);
        });
      },
    });

    const response = await request(app)
      .post('/api/v1/security/body')
      .set('x-request-id', trustedRequestId)
      .send({ value: 'x'.repeat(100) });

    expectStandardError(response, {
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
      message: 'The request body is too large.',
    });
  });

  it('maps an application request deadline to the common 408 error envelope', async () => {
    const app = createApp({
      isTrustedRequestId: () => true,
      securityConfig: {
        ...defaultSecurityConfig,
        requestTimeoutMs: 20,
      },
      registerRoutes: (router) => {
        router.get('/api/v1/security/slow', async () => new Promise<never>(() => undefined));
      },
    });

    const response = await request(app)
      .get('/api/v1/security/slow')
      .set('x-request-id', trustedRequestId);

    expectStandardError(response, {
      status: 408,
      code: 'REQUEST_TIMEOUT',
      message: 'The request exceeded its allowed duration.',
    });
  });

  it('returns Retry-After and the common 429 envelope when the process limit is exceeded', async () => {
    const app = createApp({
      isTrustedRequestId: () => true,
      securityConfig: {
        ...defaultSecurityConfig,
        rateLimit: { maxRequests: 2, windowMs: 60_000 },
      },
      registerRoutes: (router) => {
        router.get('/api/v1/security/limited', (_request, response) => {
          response.sendStatus(204);
        });
      },
    });

    await request(app).get('/api/v1/security/limited').expect(204);
    await request(app).get('/api/v1/security/limited').expect(204);
    const response = await request(app)
      .get('/api/v1/security/limited')
      .set('x-request-id', trustedRequestId);

    expectStandardError(response, {
      status: 429,
      code: 'RATE_LIMITED',
      message: 'Too many requests.',
    });
    expect(response.headers['retry-after']).toBe('60');
    expect(response.headers['ratelimit']).toBeDefined();
    expect(response.headers['x-ratelimit-limit']).toBeUndefined();
  });

  it('applies the validated CORS and security configuration during server bootstrap', async () => {
    const parsed = parseEnvironment({
      CORS_ALLOWED_ORIGINS: allowedOrigin,
      RATE_LIMIT_MAX_REQUESTS: '1',
    });
    const config = {
      ...parsed,
      runtime: { ...parsed.runtime, port: 0 },
    } as ReturnType<typeof parseEnvironment>;
    const running = await bootstrap({
      loadConfig: () => Promise.resolve(config),
    });

    try {
      expect(createVenueCatalogRuntime).toHaveBeenCalledWith(config);
      expect(createPaymentsBillingRuntime).toHaveBeenCalledWith(config);
      const firstResponse = await request(running.httpServer)
        .get('/health/live')
        .set('origin', allowedOrigin);
      const limitedResponse = await request(running.httpServer)
        .get('/health/live')
        .set('origin', allowedOrigin);

      expect(firstResponse.status).toBe(200);
      expect(firstResponse.headers['access-control-allow-origin']).toBe(allowedOrigin);
      expect(limitedResponse.status).toBe(429);
      expect(limitedResponse.body as unknown).toMatchObject({
        error: { code: 'RATE_LIMITED' },
      });
    } finally {
      await running.shutdown();
    }
  });
});
