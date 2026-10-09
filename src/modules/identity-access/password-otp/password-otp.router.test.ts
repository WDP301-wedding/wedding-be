import type { RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../app.js';
import { AppError } from '../../../core/errors/app-error.js';
import type { AuthenticatedActor } from '../authorization/authenticated-actor.middleware.js';
import { createPasswordOtpRouter } from './password-otp.router.js';
import type { PasswordOtpService } from './password-otp.service.js';

// Rate limiting has its own HTTP tests. Isolate command forwarding here so the
// transport fallback can also be checked when client IP metadata is absent.
vi.mock('../../../core/http/rate-limit.js', () => ({
  createGeneralRateLimit: (): RequestHandler => (_request, _response, next) => next(),
}));

const challengeId = '00000000-0000-4000-8000-000000000001';
const actor: AuthenticatedActor = {
  accountId: '00000000-0000-4000-8000-000000000002',
  sessionId: '00000000-0000-4000-8000-000000000003',
  displayEmail: 'couple@example.com',
  roles: ['COUPLE'],
};
const acknowledged = {
  accepted: true as const,
  challengeId,
  expiresInSeconds: 600 as const,
  resendAfterSeconds: 60 as const,
} as const;
const completed = { completed: true as const, requiresLogin: true as const };
const completion = { challengeId, code: '123456', newPassword: 'new-password-123' };

function fixture(transport?: RequestHandler) {
  const service = {
    request: vi.fn<PasswordOtpService['request']>().mockResolvedValue(acknowledged),
    complete: vi.fn<PasswordOtpService['complete']>().mockResolvedValue(completed),
  };
  const resolve = vi.fn().mockResolvedValue(actor);
  const app = createApp({
    runtimeEnvironment: 'test',
    registerRoutes(server) {
      if (transport) server.use(transport);
      server.use('/api/v1', createPasswordOtpRouter(service, { resolve }));
    },
  });
  return { app, service, resolve };
}

describe('password OTP HTTP contract', () => {
  it.each([
    {
      path: 'password-otp-requests',
      body: { email: 'couple@example.com' },
      method: 'request' as const,
      status: 202,
      result: acknowledged,
    },
    {
      path: 'password-otp-completions',
      body: completion,
      method: 'complete' as const,
      status: 200,
      result: completed,
    },
    {
      path: 'password-change-otp-requests',
      body: { currentPassword: 'old-password' },
      method: 'request' as const,
      status: 202,
      result: acknowledged,
    },
  ])(
    'forwards the validated $path command with request context',
    async ({ path, body, method, status, result }) => {
      const { app, service } = fixture();
      const response = await request(app)
        .post(`/api/v1/auth/${path}`)
        .set('Authorization', 'Bearer test-token')
        .send(body);

      expect(response.status).toBe(status);
      expect(response.body).toEqual({ data: result });
      expect(response.headers['cache-control']).toBe('no-store');
      const command = service[method].mock.calls[0]![0];
      expect(command).toMatchObject(body);
      expect(command.clientIp).toBeTruthy();
      expect(command.requestId).toBe(response.headers['x-request-id']);
      if (path === 'password-change-otp-requests') expect(command.actor).toEqual(actor);
      else expect(command.actor).toBeUndefined();
      if (method === 'complete') {
        expect(response.headers['set-cookie']?.[0]).toContain('__Host-wedding-refresh=;');
        expect(response.headers['set-cookie']?.[0]).toContain('HttpOnly');
        expect(response.headers['set-cookie']?.[0]).toContain('Secure');
      }
    },
  );

  it.each(['password-otp-requests', 'password-otp-completions', 'password-change-otp-requests'])(
    'rejects invalid %s input before invoking the provider',
    async (path) => {
      const { app, service } = fixture();
      const response = await request(app)
        .post(`/api/v1/auth/${path}`)
        .set('Authorization', 'Bearer token')
        .send({ unexpected: true });
      expect(response.status).toBe(422);
      expect(service.request).not.toHaveBeenCalled();
      expect(service.complete).not.toHaveBeenCalled();
    },
  );

  it('requires an authenticated actor for a change challenge', async () => {
    const { app, service, resolve } = fixture();
    const response = await request(app)
      .post('/api/v1/auth/password-change-otp-requests')
      .send({ currentPassword: 'old-password' });
    expect(response.status).toBe(401);
    expect(service.request).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('preserves service denials without clearing the refresh cookie', async () => {
    const { app, service } = fixture();
    service.complete.mockRejectedValue(
      new AppError({ status: 422, code: 'OTP_INVALID', message: 'Invalid OTP.' }),
    );
    const response = await request(app)
      .post('/api/v1/auth/password-otp-completions')
      .send(completion);
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ error: { code: 'OTP_INVALID' } });
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it.each(['socket', 'unavailable'] as const)(
    'uses %s client IP context when Express has no IP',
    async (source) => {
      const { app, service } = fixture((incoming, _response, next) => {
        Object.defineProperty(incoming, 'ip', { value: undefined });
        Object.defineProperty(incoming.socket, 'remoteAddress', {
          value: source === 'socket' ? '127.0.0.7' : undefined,
        });
        next();
      });
      for (const [path, body, method] of [
        ['password-otp-requests', { email: 'couple@example.com' }, 'request'],
        ['password-otp-completions', completion, 'complete'],
        ['password-change-otp-requests', { currentPassword: 'old-password' }, 'request'],
      ] as const) {
        const response = await request(app)
          .post(`/api/v1/auth/${path}`)
          .set('Authorization', 'Bearer token')
          .send(body);
        expect(response.status).toBeLessThan(300);
        expect(service[method]).toHaveBeenLastCalledWith(
          expect.objectContaining({ clientIp: source === 'socket' ? '127.0.0.7' : '' }),
        );
      }
    },
  );
});
