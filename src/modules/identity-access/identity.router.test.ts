import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../app.js';
import { InvalidCredentialsError, InvalidEmailError } from './account/account.service.js';
import type { AuthenticatedActor } from './authorization/authenticated-actor.middleware.js';
import { PasswordPolicyError } from './crypto/password.js';
import { createIdentityRouter, type IdentityHttpServices } from './identity.router.js';
import { InvalidOrExpiredResetTokenError } from './password-reset/password-reset.service.js';
import {
  InvalidRefreshTokenError,
  LoginRateLimitedError,
  OwnedSessionNotFoundError,
  RefreshRateLimitedError,
  RefreshReplayError,
} from './session/session.service.js';
import { InvalidOrExpiredInvitationError } from './workspace-invitation/workspace-invitation.acceptance.js';

const accountId = randomUUID();
const sessionId = randomUUID();
const refreshToken = `wir_${'r'.repeat(43)}`;
const accessToken = `wia_${'a'.repeat(43)}`;

function actor(): AuthenticatedActor {
  return { accountId, sessionId, displayEmail: 'couple@example.com', roles: ['COUPLE'] };
}

function services(): IdentityHttpServices {
  return {
    resolveActor: vi.fn(() => Promise.resolve(actor())),
    login: vi.fn(() =>
      Promise.resolve({
        account: { accountId, displayEmail: 'couple@example.com', roles: ['COUPLE'] as const },
        sessionId,
        clientKind: 'WEB' as const,
        accessToken,
        accessExpiresAt: new Date('2026-10-03T00:10:00.000Z'),
        refreshToken,
        refreshExpiresAt: new Date('2026-11-02T00:00:00.000Z'),
        absoluteExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
      }),
    ),
    refresh: vi.fn(() =>
      Promise.resolve({
        sessionId,
        clientKind: 'WEB' as const,
        accessToken,
        accessExpiresAt: new Date('2026-10-03T00:10:00.000Z'),
        refreshToken,
        refreshExpiresAt: new Date('2026-11-02T00:00:00.000Z'),
      }),
    ),
    logout: vi.fn(() => Promise.resolve()),
    listSessions: vi.fn(() =>
      Promise.resolve({
        sessions: [
          {
            sessionId,
            clientKind: 'WEB' as const,
            status: 'ACTIVE' as const,
            createdAt: new Date('2026-10-01T00:00:00.000Z'),
            lastSeenAt: new Date('2026-10-03T00:00:00.000Z'),
            idleExpiresAt: new Date('2026-11-02T00:00:00.000Z'),
            absoluteExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
          },
        ],
        nextCursor: null,
      }),
    ),
    revokeOwnedSession: vi.fn(() => Promise.resolve()),
    requestPasswordReset: vi.fn(() => Promise.resolve({ accepted: true as const })),
    completePasswordReset: vi.fn(() => Promise.resolve({ completed: true as const })),
    acceptInvitation: vi.fn(() =>
      Promise.resolve({
        account: { accountId, displayEmail: 'couple@example.com', roles: [] as const },
        sessionId,
        clientKind: 'WEB' as const,
        accessToken,
        accessExpiresAt: new Date('2026-10-03T00:10:00.000Z'),
        refreshToken,
        refreshExpiresAt: new Date('2026-11-02T00:00:00.000Z'),
        absoluteExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
      }),
    ),
  };
}

function appWith(serviceOverrides: Partial<IdentityHttpServices> = {}) {
  const identityServices = { ...services(), ...serviceOverrides };
  const app = createApp({
    corsConfig: { allowedOrigins: ['https://couple.example.com'] },
    registerRoutes: (expressApp) => {
      expressApp.use(
        '/api/v1',
        createIdentityRouter({
          services: identityServices,
          allowedWebOrigins: ['https://couple.example.com'],
          refreshCookieName: '__Host-wedding-refresh',
        }),
      );
    },
  });
  return { app, identityServices };
}

describe('IA-08 identity HTTP contract', () => {
  it('keeps the Web refresh credential only in the secure host cookie', async () => {
    const { app, identityServices } = appWith();

    const response = await request(app)
      .post('/api/v1/auth/web-sessions')
      .send({ email: 'couple@example.com', password: 'correct-password' });

    expect(response.status).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['set-cookie']?.[0]).toContain(
      '__Host-wedding-refresh=wir_rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr',
    );
    expect(response.headers['set-cookie']?.[0]).toContain('HttpOnly');
    expect(response.headers['set-cookie']?.[0]).toContain('Secure');
    expect(response.headers['set-cookie']?.[0]).toContain('SameSite=Lax');
    expect(response.headers['set-cookie']?.[0]).not.toContain('Domain=');
    expect(JSON.stringify(response.body)).not.toContain(refreshToken);
    expect(identityServices.login).toHaveBeenCalledWith(
      expect.objectContaining({ clientKind: 'WEB', email: 'couple@example.com' }),
    );
  });

  it('requires an allowed Origin and cookie for Web refresh while Android uses the body', async () => {
    const { app, identityServices } = appWith();

    const missingOrigin = await request(app)
      .post('/api/v1/auth/web-session-refreshes')
      .set('Cookie', `__Host-wedding-refresh=${refreshToken}`)
      .send({});
    const web = await request(app)
      .post('/api/v1/auth/web-session-refreshes')
      .set('Origin', 'https://couple.example.com')
      .set('Cookie', `__Host-wedding-refresh=${refreshToken}`)
      .send({});
    const android = await request(app)
      .post('/api/v1/auth/android-session-refreshes')
      .send({ refreshToken });

    expect(missingOrigin.status).toBe(403);
    expect(web.status).toBe(200);
    expect(JSON.stringify(web.body)).not.toContain(refreshToken);
    expect(android.status).toBe(200);
    expect(android.body).toMatchObject({ data: { refreshToken } });
    expect(identityServices.refresh).toHaveBeenCalledTimes(2);
  });

  it('returns the Android refresh credential in the successful login body', async () => {
    const { app, identityServices } = appWith({
      login: vi.fn(() =>
        Promise.resolve({
          account: { accountId, displayEmail: 'couple@example.com', roles: ['COUPLE'] as const },
          sessionId,
          clientKind: 'ANDROID' as const,
          accessToken,
          accessExpiresAt: new Date('2026-10-03T00:10:00.000Z'),
          refreshToken,
          refreshExpiresAt: new Date('2026-11-02T00:00:00.000Z'),
          absoluteExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
        }),
      ),
    });

    const response = await request(app)
      .post('/api/v1/auth/android-sessions')
      .send({ email: 'couple@example.com', password: 'correct-password' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      data: { clientKind: 'ANDROID', refreshToken },
    });
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(identityServices.login).toHaveBeenCalledWith(
      expect.objectContaining({ clientKind: 'ANDROID' }),
    );
  });

  it('uses bearer authentication for current user and bounded cursor inventory', async () => {
    const { app, identityServices } = appWith();

    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    const inventory = await request(app)
      .get(`/api/v1/auth/sessions?limit=20&cursor=${sessionId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(me.status).toBe(200);
    expect(me.body).toEqual({
      data: { accountId, sessionId, displayEmail: 'couple@example.com', roles: ['COUPLE'] },
    });
    expect(inventory.status).toBe(200);
    expect(identityServices.listSessions).toHaveBeenCalledWith(accountId, {
      limit: 20,
      cursor: sessionId,
    });
    expect(JSON.stringify(inventory.body)).not.toMatch(/token|password/iu);
  });

  it('clears the Web cookie on idempotent logout and rejects unknown fields', async () => {
    const { app, identityServices } = appWith();

    const invalid = await request(app)
      .post('/api/v1/auth/android-sessions')
      .send({ email: 'couple@example.com', password: 'correct-password', role: 'MANAGER' });
    const logout = await request(app)
      .delete('/api/v1/auth/sessions/current')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Cookie', `__Host-wedding-refresh=${refreshToken}`);

    expect(invalid.status).toBe(422);
    expect(JSON.stringify(invalid.body)).not.toContain('correct-password');
    expect(logout.status).toBe(204);
    expect(logout.headers['set-cookie']?.[0]).toContain('Max-Age=0');
    expect(identityServices.logout).toHaveBeenCalledWith(
      expect.objectContaining({ accountId, sessionId }),
    );
  });

  it('uses stable non-echoing auth, throttling, and ownership errors', async () => {
    const invalidCredentials = appWith({
      login: vi.fn(() => Promise.reject(new InvalidCredentialsError('unknown-account'))),
    });
    const throttled = appWith({
      login: vi.fn(() => Promise.reject(new LoginRateLimitedError(12))),
    });
    const concealed = appWith({
      revokeOwnedSession: vi.fn(() => Promise.reject(new OwnedSessionNotFoundError())),
    });

    const invalid = await request(invalidCredentials.app)
      .post('/api/v1/auth/web-sessions')
      .send({ email: 'unknown@example.com', password: 'secret-password' });
    const limited = await request(throttled.app)
      .post('/api/v1/auth/android-sessions')
      .send({ email: 'couple@example.com', password: 'secret-password' });
    const notFound = await request(concealed.app)
      .delete(`/api/v1/auth/sessions/${randomUUID()}`)
      .set('Authorization', `Bearer ${accessToken}`);
    const unauthenticated = await request(concealed.app).get('/api/v1/auth/me');

    expect(invalid.status).toBe(401);
    expect(invalid.body).toMatchObject({ error: { code: 'INVALID_CREDENTIALS' } });
    expect(JSON.stringify(invalid.body)).not.toMatch(/unknown@example|secret-password/iu);
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBe('12');
    expect(notFound.status).toBe(404);
    expect(unauthenticated.status).toBe(401);
    expect(
      [invalid, limited, notFound, unauthenticated].every(
        (value) => value.headers['cache-control'] === 'no-store',
      ),
    ).toBe(true);
  });

  it('adds no-store even when CORS rejects the Web refresh before route dispatch', async () => {
    const { app } = appWith();

    const response = await request(app)
      .post('/api/v1/auth/web-session-refreshes')
      .set('Origin', 'https://attacker.example')
      .set('Cookie', `__Host-wedding-refresh=${refreshToken}`)
      .send({});

    expect(response.status).toBe(403);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it.each([
    ['invalid email', new InvalidEmailError()],
    ['invalid credentials', new InvalidCredentialsError('password-mismatch')],
  ])('normalizes %s login failures', async (_case, error) => {
    const { app } = appWith({ login: vi.fn(() => Promise.reject(error)) });

    const response = await request(app)
      .post('/api/v1/auth/web-sessions')
      .send({ email: 'couple@example.com', password: 'secret-password' });

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ error: { code: 'INVALID_CREDENTIALS' } });
  });

  it.each([
    ['invalid token', new InvalidRefreshTokenError(), 401, 'INVALID_OR_EXPIRED_TOKEN'],
    ['replayed token', new RefreshReplayError(), 401, 'INVALID_OR_EXPIRED_TOKEN'],
    ['refresh throttle', new RefreshRateLimitedError(9), 429, 'RATE_LIMITED'],
  ])('normalizes %s failures', async (_case, error, status, code) => {
    const { app } = appWith({ refresh: vi.fn(() => Promise.reject(error)) });

    const response = await request(app)
      .post('/api/v1/auth/android-session-refreshes')
      .send({ refreshToken });

    expect(response.status).toBe(status);
    expect(response.body).toMatchObject({ error: { code } });
  });

  it('handles optional inventory input, successful owned revoke, and a missing refresh cookie', async () => {
    const { app, identityServices } = appWith();

    const inventory = await request(app)
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${accessToken}`);
    const revoked = await request(app)
      .delete(`/api/v1/auth/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${accessToken}`);
    const missingCookie = await request(app)
      .post('/api/v1/auth/web-session-refreshes')
      .set('Origin', 'https://couple.example.com')
      .send({});

    expect(inventory.status).toBe(200);
    expect(identityServices.listSessions).toHaveBeenCalledWith(accountId, { limit: 20 });
    expect(revoked.status).toBe(204);
    expect(identityServices.revokeOwnedSession).toHaveBeenCalled();
    expect(missingCookie.status).toBe(401);
  });

  it('ignores unrelated cookies and clamps an already-expired cookie lifetime', async () => {
    const expired = appWith({
      login: vi.fn(() =>
        Promise.resolve({
          account: {
            accountId,
            displayEmail: 'couple@example.com',
            roles: ['COUPLE'] as const,
          },
          sessionId,
          clientKind: 'WEB' as const,
          accessToken,
          accessExpiresAt: new Date('2026-10-03T00:10:00.000Z'),
          refreshToken,
          refreshExpiresAt: new Date('2020-01-01T00:00:00.000Z'),
          absoluteExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
        }),
      ),
    });
    const login = await request(expired.app)
      .post('/api/v1/auth/web-sessions')
      .send({ email: 'couple@example.com', password: 'correct-password' });
    const unrelatedCookie = await request(expired.app)
      .post('/api/v1/auth/web-session-refreshes')
      .set('Origin', 'https://couple.example.com')
      .set('Cookie', 'other=value')
      .send({});

    expect(login.headers['set-cookie']?.[0]).toContain('Max-Age=0');
    expect(unrelatedCookie.status).toBe(401);
  });

  it('keeps unexpected service failures inside the common error envelope', async () => {
    const { app } = appWith({ login: vi.fn(() => Promise.reject(new Error('raw secret'))) });

    const response = await request(app)
      .post('/api/v1/auth/android-sessions')
      .send({ email: 'couple@example.com', password: 'secret-password' });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
    expect(JSON.stringify(response.body)).not.toContain('raw secret');
  });
});

describe('IA-13 reset and invitation HTTP contract', () => {
  it('accepts reset and invitation credentials only in strict POST bodies', async () => {
    const { app, identityServices } = appWith();
    const invitationToken = `wii_${'i'.repeat(43)}`;
    const resetToken = `wip_${'p'.repeat(43)}`;

    const requested = await request(app)
      .post('/api/v1/auth/password-reset-requests')
      .send({ email: 'couple@example.com' });
    const completed = await request(app)
      .post('/api/v1/auth/password-reset-completions')
      .send({ resetToken, newPassword: 'new-password-123' });
    const accepted = await request(app)
      .post('/api/v1/workspace-invitation-acceptances')
      .send({ invitationToken, password: 'new-password-123' });

    expect(requested.status).toBe(202);
    expect(requested.body).toEqual({ data: { accepted: true } });
    expect(completed.status).toBe(200);
    expect(completed.body).toEqual({ data: { completed: true } });
    expect(accepted.status).toBe(201);
    expect(accepted.headers['cache-control']).toBe('no-store');
    expect(accepted.headers['set-cookie']?.[0]).toContain('__Host-wedding-refresh=');
    expect(JSON.stringify(accepted.body)).not.toContain(invitationToken);
    expect(JSON.stringify(accepted.body)).not.toContain(refreshToken);
    expect(identityServices.completePasswordReset).toHaveBeenCalledWith(
      expect.objectContaining({ resetToken, newPassword: 'new-password-123' }),
    );
    expect(identityServices.acceptInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ invitationToken, password: 'new-password-123' }),
    );

    const queryCredential = await request(app).post(
      `/api/v1/workspace-invitation-acceptances?invitationToken=${invitationToken}`,
    );
    const unknownField = await request(app)
      .post('/api/v1/auth/password-reset-completions')
      .send({ resetToken, newPassword: 'new-password-123', email: 'couple@example.com' });
    expect(queryCredential.status).toBe(422);
    expect(unknownField.status).toBe(422);
  });

  it.each([
    ['reset', new InvalidOrExpiredResetTokenError(), '/api/v1/auth/password-reset-completions'],
    [
      'invitation',
      new InvalidOrExpiredInvitationError(),
      '/api/v1/workspace-invitation-acceptances',
    ],
  ])('maps invalid or replayed %s credentials to one generic error', async (kind, error, path) => {
    const resetToken = `wip_${'p'.repeat(43)}`;
    const invitationToken = `wii_${'i'.repeat(43)}`;
    const { app } = appWith(
      kind === 'reset'
        ? { completePasswordReset: vi.fn(() => Promise.reject(error)) }
        : { acceptInvitation: vi.fn(() => Promise.reject(error)) },
    );

    const response = await request(app)
      .post(path)
      .send(
        kind === 'reset'
          ? { resetToken, newPassword: 'new-password-123' }
          : { invitationToken, password: 'new-password-123' },
      );

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ error: { code: 'INVALID_OR_EXPIRED_TOKEN' } });
    expect(JSON.stringify(response.body)).not.toMatch(/wii_|wip_|new-password/iu);
  });

  it('normalizes password policy failures without echoing password details', async () => {
    const { app } = appWith({
      completePasswordReset: vi.fn(() => Promise.reject(new PasswordPolicyError())),
    });

    const response = await request(app)
      .post('/api/v1/auth/password-reset-completions')
      .send({ resetToken: `wip_${'p'.repeat(43)}`, newPassword: 'new-password-123' });

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(JSON.stringify(response.body)).not.toContain('new-password');
  });
});
