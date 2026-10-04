import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { InvalidCredentialsError, type AuthenticatedAccount } from '../account/account.service.js';
import type {
  CreateSessionInput,
  RotateRefreshInput,
  SessionPage,
  SessionRepository,
  SessionSummary,
} from './session.repository.js';
import {
  createInMemoryAttemptThrottle,
  createSessionService,
  InvalidClientIpError,
  LoginRateLimitedError,
  RefreshRateLimitedError,
  RefreshReplayError,
  type IdentitySecurityEvent,
} from './session.service.js';

class FakeSessionRepository implements SessionRepository {
  created: CreateSessionInput[] = [];
  rotationInputs: RotateRefreshInput[] = [];
  rotationOutcome:
    | {
        outcome: 'ROTATED';
        accountId: string;
        sessionId: string;
        clientKind: 'WEB' | 'ANDROID';
        accessExpiresAt: Date;
        refreshExpiresAt: Date;
      }
    | { outcome: 'REPLAYED'; accountId: string; sessionId: string }
    | { outcome: 'INVALID' } = { outcome: 'INVALID' };
  revokeFound = true;
  revoked: string[] = [];
  summaries: readonly SessionSummary[] = [];
  listedLimits: number[] = [];

  createSession(input: CreateSessionInput) {
    this.created.push(input);
    return Promise.resolve({ sessionId: randomUUID(), accountId: input.accountId });
  }

  rotateRefresh(input: RotateRefreshInput) {
    this.rotationInputs.push(input);
    return Promise.resolve(this.rotationOutcome);
  }

  revokeSession(input: { reason: string }): Promise<boolean> {
    this.revoked.push(input.reason);
    return Promise.resolve(this.revokeFound);
  }

  revokeAllSessions(): Promise<number> {
    return Promise.resolve(1);
  }

  listSessions(_accountId: string, input: { limit: number }): Promise<SessionPage> {
    this.listedLimits.push(input.limit);
    return Promise.resolve({ sessions: this.summaries, nextCursor: null });
  }

  findActorByAccessTokenHash(): Promise<null> {
    return Promise.resolve(null);
  }
}

const config = {
  accessTokenTtlSeconds: 600,
  refreshIdleTtlSeconds: 2_592_000,
  refreshAbsoluteTtlSeconds: 7_776_000,
  tokenEntropyBytes: 32,
  loginRateLimit: { maxAttempts: 2, windowSeconds: 900 },
  refreshRateLimit: { maxAttempts: 60, windowSeconds: 900 },
};

function authenticatedAccount(): AuthenticatedAccount {
  return {
    accountId: randomUUID(),
    displayEmail: 'Couple@example.com',
    roles: ['COUPLE'],
  };
}

describe('session service', () => {
  it('issues raw access/refresh values once while passing only purpose hashes to persistence', async () => {
    const repository = new FakeSessionRepository();
    const account = authenticatedAccount();
    const authenticate = vi.fn(() => Promise.resolve(account));
    const service = createSessionService({
      repository,
      authenticate,
      throttle: createInMemoryAttemptThrottle(),
      config,
      recordSecurityEvent: vi.fn(() => Promise.resolve()),
      now: () => new Date('2026-10-03T00:00:00.000Z'),
    });

    const issued = await service.login({
      email: 'Couple@example.com',
      password: 'correct-password',
      clientKind: 'WEB',
      clientIp: '203.0.113.10',
      requestId: randomUUID(),
    });

    expect(issued.accessToken).toMatch(/^wia_/u);
    expect(issued.refreshToken).toMatch(/^wir_/u);
    expect(repository.created[0]).toMatchObject({
      accountId: account.accountId,
      clientKind: 'WEB',
      accessExpiresAt: new Date('2026-10-03T00:10:00.000Z'),
      idleExpiresAt: new Date('2026-11-02T00:00:00.000Z'),
      absoluteExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
    });
    expect(repository.created[0]?.accessTokenHash).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(repository.created[0]?.refreshTokenHash).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(JSON.stringify(repository.created[0])).not.toContain(issued.accessToken);
    expect(JSON.stringify(repository.created[0])).not.toContain(issued.refreshToken);
  });

  it('uses separate IP and subject buckets without creating permanent account lockout', async () => {
    const repository = new FakeSessionRepository();
    const events: IdentitySecurityEvent[] = [];
    const service = createSessionService({
      repository,
      authenticate: () => Promise.reject(new InvalidCredentialsError()),
      throttle: createInMemoryAttemptThrottle(),
      config,
      recordSecurityEvent: (event) => {
        events.push(event);
        return Promise.resolve();
      },
      now: () => new Date('2026-10-03T00:00:00.000Z'),
    });
    const attempt = (email: string, clientIp: string) =>
      service.login({
        email,
        password: 'wrong-password',
        clientKind: 'WEB',
        clientIp,
        requestId: randomUUID(),
      });

    await expect(attempt('couple@example.com', '203.0.113.10')).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    await expect(attempt('couple@example.com', '203.0.113.10')).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    await expect(attempt('couple@example.com', '203.0.113.10')).rejects.toBeInstanceOf(
      LoginRateLimitedError,
    );
    await expect(attempt('other@example.com', '203.0.113.11')).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    expect(events.every((event) => !JSON.stringify(event).includes('couple@example.com'))).toBe(
      true,
    );
  });

  it('records a safe internal login outcome without exposing the subject', async () => {
    const repository = new FakeSessionRepository();
    const events: IdentitySecurityEvent[] = [];
    const service = createSessionService({
      repository,
      authenticate: () => Promise.reject(new InvalidCredentialsError('unknown-account')),
      throttle: createInMemoryAttemptThrottle(),
      config,
      recordSecurityEvent: (event) => {
        events.push(event);
        return Promise.resolve();
      },
    });

    await expect(
      service.login({
        email: 'Unknown@example.com',
        password: 'wrong-password',
        clientKind: 'WEB',
        clientIp: '203.0.113.10',
        requestId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(events).toContainEqual(
      expect.objectContaining({ action: 'session.login-failed', reasonCode: 'unknown-account' }),
    );
    expect(JSON.stringify(events)).not.toContain('unknown@example.com');
    expect(JSON.stringify(events)).not.toContain('wrong-password');
  });

  it('rejects unresolved client IP values before authentication or refresh work', async () => {
    const repository = new FakeSessionRepository();
    const authenticate = vi.fn(() => Promise.resolve(authenticatedAccount()));
    const service = createSessionService({
      repository,
      authenticate,
      throttle: createInMemoryAttemptThrottle(),
      config,
      recordSecurityEvent: vi.fn(() => Promise.resolve()),
    });

    await expect(
      service.login({
        email: 'couple@example.com',
        password: 'correct-password',
        clientKind: 'WEB',
        clientIp: 'not-an-ip',
        requestId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(InvalidClientIpError);
    await expect(
      service.refresh({
        refreshToken: `wir_${'a'.repeat(43)}`,
        clientIp: 'not-an-ip',
        requestId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(InvalidClientIpError);
    expect(authenticate).not.toHaveBeenCalled();
    expect(repository.rotationInputs).toHaveLength(0);
  });

  it('counts malformed email attempts against the IP throttle', async () => {
    const repository = new FakeSessionRepository();
    const events: IdentitySecurityEvent[] = [];
    const service = createSessionService({
      repository,
      authenticate: () => Promise.resolve(authenticatedAccount()),
      throttle: createInMemoryAttemptThrottle(),
      config: { ...config, loginRateLimit: { maxAttempts: 1, windowSeconds: 900 } },
      recordSecurityEvent: (event) => {
        events.push(event);
        return Promise.resolve();
      },
      now: () => new Date('2026-10-03T00:00:00.000Z'),
    });
    const input = {
      email: 'not-an-email',
      password: 'wrong-password',
      clientKind: 'WEB' as const,
      clientIp: '203.0.113.10',
      requestId: randomUUID(),
    };

    await expect(service.login(input)).rejects.toMatchObject({ name: 'InvalidEmailError' });
    await expect(service.login(input)).rejects.toBeInstanceOf(LoginRateLimitedError);
    expect(events.map(({ reasonCode }) => reasonCode)).toEqual(['invalid-email', 'rate-limit']);
  });

  it('rotates refresh credentials without extending the absolute lifetime', async () => {
    const repository = new FakeSessionRepository();
    const accountId = randomUUID();
    const sessionId = randomUUID();
    repository.rotationOutcome = {
      outcome: 'ROTATED',
      accountId,
      sessionId,
      clientKind: 'ANDROID',
      accessExpiresAt: new Date('2027-01-01T00:05:00.000Z'),
      refreshExpiresAt: new Date('2027-01-01T00:10:00.000Z'),
    };
    const service = createSessionService({
      repository,
      authenticate: () => Promise.resolve(authenticatedAccount()),
      throttle: createInMemoryAttemptThrottle(),
      config,
      recordSecurityEvent: vi.fn(() => Promise.resolve()),
      now: () => new Date('2026-12-31T23:55:00.000Z'),
    });

    const result = await service.refresh({
      refreshToken: `wir_${'a'.repeat(43)}`,
      clientIp: '203.0.113.10',
      requestId: randomUUID(),
    });

    expect(result.sessionId).toBe(sessionId);
    expect(repository.rotationInputs[0]).toMatchObject({
      requestedAccessExpiresAt: new Date('2027-01-01T00:05:00.000Z'),
      requestedIdleExpiresAt: new Date('2027-01-30T23:55:00.000Z'),
    });
    expect(repository.rotationInputs[0]?.presentedTokenHash).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });

  it('reports refresh replay without returning newly generated credentials', async () => {
    const repository = new FakeSessionRepository();
    repository.rotationOutcome = {
      outcome: 'REPLAYED',
      accountId: randomUUID(),
      sessionId: randomUUID(),
    };
    const events: IdentitySecurityEvent[] = [];
    const service = createSessionService({
      repository,
      authenticate: () => Promise.resolve(authenticatedAccount()),
      throttle: createInMemoryAttemptThrottle(),
      config,
      recordSecurityEvent: (event) => {
        events.push(event);
        return Promise.resolve();
      },
    });

    await expect(
      service.refresh({
        refreshToken: `wir_${'b'.repeat(43)}`,
        clientIp: '203.0.113.10',
        requestId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(RefreshReplayError);
    expect(events).toContainEqual(expect.objectContaining({ action: 'session.refresh-reuse' }));
  });

  it('rejects malformed and unknown refresh credentials with the same public error', async () => {
    const repository = new FakeSessionRepository();
    const service = createSessionService({
      repository,
      authenticate: () => Promise.resolve(authenticatedAccount()),
      throttle: createInMemoryAttemptThrottle(),
      config,
      recordSecurityEvent: vi.fn(() => Promise.resolve()),
    });

    await expect(
      service.refresh({
        refreshToken: 'invalid',
        clientIp: '203.0.113.10',
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ name: 'InvalidRefreshTokenError' });
    await expect(
      service.refresh({
        refreshToken: `wir_${'z'.repeat(43)}`,
        clientIp: '203.0.113.10',
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ name: 'InvalidRefreshTokenError' });
  });

  it('uses an independent refresh throttle bucket', async () => {
    const repository = new FakeSessionRepository();
    const service = createSessionService({
      repository,
      authenticate: () => Promise.resolve(authenticatedAccount()),
      throttle: createInMemoryAttemptThrottle(),
      config: { ...config, refreshRateLimit: { maxAttempts: 1, windowSeconds: 900 } },
      recordSecurityEvent: vi.fn(() => Promise.resolve()),
      now: () => new Date('2026-10-03T00:00:00.000Z'),
    });
    const input = {
      refreshToken: `wir_${'q'.repeat(43)}`,
      clientIp: '203.0.113.10',
      requestId: randomUUID(),
    };

    await expect(service.refresh(input)).rejects.toMatchObject({
      name: 'InvalidRefreshTokenError',
    });
    await expect(service.refresh(input)).rejects.toMatchObject({ name: 'RefreshRateLimitedError' });
  });

  it('counts malformed refresh credentials against the refresh throttle', async () => {
    const repository = new FakeSessionRepository();
    const service = createSessionService({
      repository,
      authenticate: () => Promise.resolve(authenticatedAccount()),
      throttle: createInMemoryAttemptThrottle(),
      config: { ...config, refreshRateLimit: { maxAttempts: 1, windowSeconds: 900 } },
      recordSecurityEvent: vi.fn(() => Promise.resolve()),
      now: () => new Date('2026-10-03T00:00:00.000Z'),
    });
    const input = {
      refreshToken: 'malformed'.repeat(100),
      clientIp: '203.0.113.10',
      requestId: randomUUID(),
    };

    await expect(service.refresh(input)).rejects.toMatchObject({
      name: 'InvalidRefreshTokenError',
    });
    await expect(service.refresh(input)).rejects.toBeInstanceOf(RefreshRateLimitedError);
    expect(repository.rotationInputs).toHaveLength(0);
  });

  it('supports idempotent logout, owned revoke, inventory, and internal all-session revoke', async () => {
    const repository = new FakeSessionRepository();
    const accountId = randomUUID();
    const sessionId = randomUUID();
    repository.summaries = [
      {
        sessionId,
        clientKind: 'WEB',
        status: 'ACTIVE',
        createdAt: new Date(),
        lastSeenAt: new Date(),
        idleExpiresAt: new Date(),
        absoluteExpiresAt: new Date(),
      },
    ];
    const service = createSessionService({
      repository,
      authenticate: () => Promise.resolve(authenticatedAccount()),
      throttle: createInMemoryAttemptThrottle(),
      config,
      recordSecurityEvent: vi.fn(() => Promise.resolve()),
    });

    await service.logout({ accountId, sessionId, requestId: randomUUID() });
    await service.revokeOwnedSession({ accountId, sessionId, requestId: randomUUID() });
    await expect(service.listSessions(accountId)).resolves.toEqual({
      sessions: repository.summaries,
      nextCursor: null,
    });
    await expect(service.listSessions(accountId, { limit: 100 })).resolves.toEqual({
      sessions: repository.summaries,
      nextCursor: null,
    });
    expect(repository.listedLimits).toEqual([20, 100]);
    expect(() => service.listSessions(accountId, { limit: 0 })).toThrow(RangeError);
    expect(() => service.listSessions(accountId, { limit: 101 })).toThrow(RangeError);
    await expect(
      service.revokeAllSessions({ accountId, reason: 'password-reset', requestId: randomUUID() }),
    ).resolves.toBe(1);
    expect(repository.revoked).toEqual(['logout', 'owner-revoked']);

    repository.revokeFound = false;
    await expect(
      service.revokeOwnedSession({ accountId, sessionId: randomUUID(), requestId: randomUUID() }),
    ).rejects.toMatchObject({ name: 'OwnedSessionNotFoundError' });
  });

  it('resets an in-memory throttle after its window', async () => {
    const throttle = createInMemoryAttemptThrottle();
    const base = {
      bucket: 'login-ip' as const,
      key: '203.0.113.10',
      maxAttempts: 1,
      windowSeconds: 1,
    };

    await expect(throttle.consume({ ...base, now: new Date(0) })).resolves.toMatchObject({
      allowed: true,
    });
    await expect(throttle.consume({ ...base, now: new Date(500) })).resolves.toMatchObject({
      allowed: false,
    });
    await expect(throttle.consume({ ...base, now: new Date(1_000) })).resolves.toMatchObject({
      allowed: true,
    });
  });

  it('bounds in-memory throttle cardinality and fails closed when saturated', async () => {
    const throttle = createInMemoryAttemptThrottle();
    const now = new Date(0);
    for (let index = 0; index < 10_000; index += 1) {
      await throttle.consume({
        bucket: 'refresh-token',
        key: `fingerprint-${index}`,
        maxAttempts: 1,
        windowSeconds: 900,
        now,
      });
    }

    await expect(
      throttle.consume({
        bucket: 'refresh-token',
        key: 'overflow',
        maxAttempts: 1,
        windowSeconds: 900,
        now,
      }),
    ).resolves.toEqual({ allowed: false, retryAfterSeconds: 900 });
    await expect(
      throttle.consume({
        bucket: 'refresh-token',
        key: 'after-expiry',
        maxAttempts: 1,
        windowSeconds: 900,
        now: new Date(900_000),
      }),
    ).resolves.toMatchObject({ allowed: true });
  });

  it('rejects invalid configured session lifetimes', async () => {
    const service = createSessionService({
      repository: new FakeSessionRepository(),
      authenticate: () => Promise.resolve(authenticatedAccount()),
      throttle: createInMemoryAttemptThrottle(),
      config: { ...config, accessTokenTtlSeconds: 0 },
      recordSecurityEvent: vi.fn(() => Promise.resolve()),
      now: () => new Date('2026-10-03T00:00:00.000Z'),
    });

    await expect(
      service.login({
        email: 'couple@example.com',
        password: 'correct-password',
        clientKind: 'WEB',
        clientIp: '203.0.113.10',
        requestId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(RangeError);
  });
});
