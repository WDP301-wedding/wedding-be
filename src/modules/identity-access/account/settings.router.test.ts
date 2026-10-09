import type { RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../app.js';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import type { AuthenticatedActor } from '../authorization/authenticated-actor.middleware.js';
import type { PasswordOtpService } from '../password-otp/password-otp.service.js';
import { createAccountSettingsRouter } from './settings.router.js';

// The limiter is covered separately; these tests exercise account command
// forwarding, including missing transport metadata.
vi.mock('../../../core/http/rate-limit.js', () => ({
  createGeneralRateLimit: (): RequestHandler => (_request, _response, next) => next(),
}));

const actor: AuthenticatedActor = {
  accountId: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000002',
  displayEmail: 'couple@example.com',
  roles: ['COUPLE'],
};
const account = {
  id: actor.accountId,
  displayEmail: actor.displayEmail,
  displayName: 'Lan',
  profileRevision: 2,
};

function fixture(transport?: RequestHandler) {
  const tx = {
    $queryRaw: vi.fn<(query: Prisma.Sql) => Promise<unknown>>().mockResolvedValue([]),
    session: { findFirst: vi.fn().mockResolvedValue({ id: actor.sessionId }) },
    account: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(account),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    account: tx.account,
    $transaction: async (run: (client: Prisma.TransactionClient) => Promise<unknown>) =>
      run(tx as unknown as Prisma.TransactionClient),
  } as unknown as PrismaClient;
  const otp = {
    request: vi.fn<PasswordOtpService['request']>(),
    complete: vi
      .fn<PasswordOtpService['complete']>()
      .mockResolvedValue({ completed: true, requiresLogin: true }),
  };
  const app = createApp({
    runtimeEnvironment: 'test',
    registerRoutes(server) {
      if (transport) server.use(transport);
      server.use(
        '/api/v1',
        createAccountSettingsRouter(prisma, { resolve: () => Promise.resolve(actor) }, otp),
      );
    },
  });
  return { app, tx, otp };
}

describe('account settings HTTP authority', () => {
  it('returns the authenticated account profile without caching', async () => {
    const { app, tx } = fixture();
    const response = await request(app)
      .get('/api/v1/auth/profile')
      .set('Authorization', 'Bearer token');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: {
        accountId: actor.accountId,
        displayEmail: actor.displayEmail,
        displayName: 'Lan',
        revision: 2,
      },
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(tx.account.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: actor.accountId } });
  });

  it('locks account before session and audits a normalized profile update', async () => {
    const { app, tx } = fixture();
    const response = await request(app)
      .patch('/api/v1/auth/profile')
      .set('Authorization', 'Bearer token')
      .send({ displayName: ' Lan ', expectedRevision: 1 });
    expect(response.status).toBe(200);
    expect(tx.$queryRaw.mock.calls.map(([query]) => query.values)).toEqual([
      [actor.accountId],
      [actor.sessionId],
    ]);
    expect(tx.account.updateMany).toHaveBeenCalledWith({
      where: { id: actor.accountId, status: 'ACTIVE', profileRevision: 1 },
      data: { displayName: 'Lan', profileRevision: { increment: 1 } },
    });
    expect(tx.auditLog.create.mock.calls).toMatchObject([
      [{ data: { actorId: actor.accountId, action: 'account.profile-updated' } }],
    ]);
  });

  it('rejects a session revoked after authentication before changing the profile', async () => {
    const { app, tx } = fixture();
    tx.session.findFirst.mockResolvedValue(null);
    const response = await request(app)
      .patch('/api/v1/auth/profile')
      .set('Authorization', 'Bearer token')
      .send({ displayName: 'Lan', expectedRevision: 1 });
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ error: { code: 'SESSION_REVOKED' } });
    expect(tx.account.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects a stale revision without recording a successful update', async () => {
    const { app, tx } = fixture();
    tx.account.updateMany.mockResolvedValue({ count: 0 });
    const response = await request(app)
      .patch('/api/v1/auth/profile')
      .set('Authorization', 'Bearer token')
      .send({ displayName: 'Lan', expectedRevision: 1 });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ error: { code: 'PROFILE_REVISION_STALE' } });
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('completes a password change for the authenticated actor and clears the refresh cookie', async () => {
    const { app, otp } = fixture();
    const body = { challengeId: actor.sessionId, code: '123456', newPassword: 'new-password-123' };
    const response = await request(app)
      .post('/api/v1/auth/password-changes')
      .set('Authorization', 'Bearer token')
      .send(body);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { completed: true, requiresLogin: true } });
    expect(otp.complete).toHaveBeenCalledWith(expect.objectContaining({ ...body, actor }));
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['set-cookie']?.[0]).toContain('__Host-wedding-refresh=;');
  });

  it.each(['socket', 'unavailable'] as const)(
    'forwards %s client IP context when changing a password without an Express IP',
    async (source) => {
      const { app, otp } = fixture((incoming, _response, next) => {
        Object.defineProperty(incoming, 'ip', { value: undefined });
        Object.defineProperty(incoming.socket, 'remoteAddress', {
          value: source === 'socket' ? '127.0.0.7' : undefined,
        });
        next();
      });
      const response = await request(app)
        .post('/api/v1/auth/password-changes')
        .set('Authorization', 'Bearer token')
        .send({ challengeId: actor.sessionId, code: '123456', newPassword: 'new-password-123' });
      expect(response.status).toBe(200);
      expect(otp.complete).toHaveBeenCalledWith(
        expect.objectContaining({ actor, clientIp: source === 'socket' ? '127.0.0.7' : '' }),
      );
    },
  );
});
