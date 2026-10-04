import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { RateLimitError } from '../../../core/errors/app-error.js';
import { createInMemoryAttemptThrottle } from '../session/session.service.js';
import type {
  CompletePasswordResetInput,
  PasswordResetRepository,
} from './password-reset.repository.js';
import {
  createPasswordResetService,
  InvalidOrExpiredResetTokenError,
} from './password-reset.service.js';

class FakeRepository implements PasswordResetRepository {
  eligibleAccount: { accountId: string; displayEmail: string } | null = {
    accountId: randomUUID(),
    displayEmail: 'Couple@example.com',
  };
  completed: CompletePasswordResetInput[] = [];
  completeResult = true;

  findEligibleAccount(): Promise<{ accountId: string; displayEmail: string } | null> {
    return Promise.resolve(this.eligibleAccount);
  }

  createCredential(input: { accountId: string }): Promise<{ credentialId: string }> {
    return Promise.resolve({ credentialId: input.accountId });
  }

  complete(input: CompletePasswordResetInput): Promise<boolean> {
    this.completed.push(input);
    return Promise.resolve(this.completeResult);
  }
}

function createService(repository: FakeRepository) {
  const notifications: unknown[] = [];
  const service = createPasswordResetService({
    repository,
    passwordCrypto: { hash: vi.fn(() => Promise.resolve({ verifier: 'safe' } as never)) },
    notificationPort: {
      sendPasswordReset(command) {
        notifications.push(command);
        return Promise.resolve();
      },
      sendWorkspaceInvitation: vi.fn(() => Promise.resolve()),
    },
    throttle: { consume: vi.fn(() => Promise.resolve({ allowed: true, retryAfterSeconds: 1 })) },
    config: {
      tokenEntropyBytes: 32,
      lifetimeSeconds: 1_800,
      requestRateLimit: { maxAttempts: 3, windowSeconds: 3_600 },
      completionRateLimit: { maxAttempts: 10, windowSeconds: 900 },
    },
    now: () => new Date('2026-10-03T00:00:00.000Z'),
  });
  return { service, notifications };
}

describe('IA-09 password reset service', () => {
  it('returns the same accepted result for unknown and eligible accounts', async () => {
    const eligibleRepository = new FakeRepository();
    const eligible = createService(eligibleRepository);
    const unknownRepository = new FakeRepository();
    unknownRepository.eligibleAccount = null;
    const unknown = createService(unknownRepository);
    const input = {
      email: 'Couple@example.com',
      clientIp: '203.0.113.10',
      requestId: randomUUID(),
    };

    await expect(eligible.service.request(input)).resolves.toEqual({ accepted: true });
    await expect(unknown.service.request(input)).resolves.toEqual({ accepted: true });
    expect(eligible.notifications).toHaveLength(1);
    expect(unknown.notifications).toHaveLength(0);
    expect(JSON.stringify(eligibleRepository)).not.toContain('wir_');
  });

  it('hashes the raw credential before persistence and passes it only to notification', async () => {
    const repository = new FakeRepository();
    const { service, notifications } = createService(repository);

    await service.request({
      email: 'couple@example.com',
      clientIp: '203.0.113.10',
      requestId: randomUUID(),
    });

    expect(notifications).toHaveLength(1);
    const notification = notifications[0] as { resetToken: string };
    expect(notification.resetToken).toMatch(/^wip_/u);
    expect(JSON.stringify(repository)).not.toContain(notification.resetToken);
  });

  it('completes once through the atomic repository boundary and rejects replay', async () => {
    const repository = new FakeRepository();
    const { service } = createService(repository);
    const input = {
      resetToken: `wip_${'t'.repeat(43)}`,
      newPassword: 'a-strong-new-password',
      clientIp: '203.0.113.10',
      requestId: randomUUID(),
    };

    await expect(service.complete(input)).resolves.toEqual({ completed: true });
    expect(repository.completed[0]?.resetTokenHash).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(JSON.stringify(repository.completed[0])).not.toContain(input.resetToken);

    repository.completeResult = false;
    await expect(service.complete(input)).rejects.toBeInstanceOf(InvalidOrExpiredResetTokenError);
  });

  it('keeps provider failures safe after credential persistence', async () => {
    const repository = new FakeRepository();
    const service = createPasswordResetService({
      repository,
      passwordCrypto: { hash: vi.fn(() => Promise.resolve({ verifier: 'safe' } as never)) },
      notificationPort: {
        sendPasswordReset: () => Promise.reject(new Error('provider raw detail')),
        sendWorkspaceInvitation: vi.fn(() => Promise.resolve()),
      },
      throttle: { consume: vi.fn(() => Promise.resolve({ allowed: true, retryAfterSeconds: 1 })) },
      config: {
        tokenEntropyBytes: 32,
        lifetimeSeconds: 1_800,
        requestRateLimit: { maxAttempts: 3, windowSeconds: 3_600 },
        completionRateLimit: { maxAttempts: 10, windowSeconds: 900 },
      },
    });

    await expect(
      service.request({
        email: 'couple@example.com',
        clientIp: '203.0.113.10',
        requestId: randomUUID(),
      }),
    ).rejects.toThrow('provider raw detail');
  });

  it('enforces separate reset request buckets and rejects invalid client IPs', async () => {
    const repository = new FakeRepository();
    repository.eligibleAccount = null;
    const service = createPasswordResetService({
      repository,
      passwordCrypto: { hash: vi.fn(() => Promise.resolve({ verifier: 'safe' } as never)) },
      notificationPort: {
        sendPasswordReset: vi.fn(() => Promise.resolve()),
        sendWorkspaceInvitation: vi.fn(() => Promise.resolve()),
      },
      throttle: createInMemoryAttemptThrottle(),
      config: {
        tokenEntropyBytes: 32,
        lifetimeSeconds: 1_800,
        requestRateLimit: { maxAttempts: 1, windowSeconds: 3_600 },
        completionRateLimit: { maxAttempts: 10, windowSeconds: 900 },
      },
      now: () => new Date('2026-10-03T00:00:00.000Z'),
    });
    const input = {
      email: 'couple@example.com',
      clientIp: '203.0.113.10',
      requestId: randomUUID(),
    };

    await expect(service.request(input)).resolves.toEqual({ accepted: true });
    await expect(service.request(input)).rejects.toBeInstanceOf(RateLimitError);
    await expect(service.request({ ...input, clientIp: 'not-an-ip' })).rejects.toBeInstanceOf(
      TypeError,
    );
  });

  it('rejects malformed and oversized reset credentials before persistence', async () => {
    const repository = new FakeRepository();
    const { service } = createService(repository);
    const base = {
      newPassword: 'a-strong-new-password',
      clientIp: '203.0.113.10',
      requestId: randomUUID(),
    };

    await expect(service.complete({ ...base, resetToken: 'malformed' })).rejects.toBeInstanceOf(
      InvalidOrExpiredResetTokenError,
    );
    await expect(
      service.complete({ ...base, clientIp: '203.0.113.11', resetToken: 'x'.repeat(300) }),
    ).rejects.toBeInstanceOf(InvalidOrExpiredResetTokenError);
    expect(repository.completed).toHaveLength(0);
  });

  it('fails closed for an invalid configured reset lifetime', async () => {
    const repository = new FakeRepository();
    const service = createPasswordResetService({
      repository,
      passwordCrypto: { hash: vi.fn(() => Promise.resolve({ verifier: 'safe' } as never)) },
      notificationPort: {
        sendPasswordReset: vi.fn(() => Promise.resolve()),
        sendWorkspaceInvitation: vi.fn(() => Promise.resolve()),
      },
      throttle: createInMemoryAttemptThrottle(),
      config: {
        tokenEntropyBytes: 32,
        lifetimeSeconds: 0,
        requestRateLimit: { maxAttempts: 3, windowSeconds: 3_600 },
        completionRateLimit: { maxAttempts: 10, windowSeconds: 900 },
      },
    });

    await expect(
      service.request({
        email: 'couple@example.com',
        clientIp: '203.0.113.10',
        requestId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(RangeError);
  });
});
