import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  createIdentityRetentionService,
  createPrismaIdentityRetentionRepository,
  type IdentityRetentionRepository,
} from './identity-retention.js';

describe('identity retention service', () => {
  it('runs one bounded batch with the approved retention windows', async () => {
    const requestId = randomUUID();
    const runBatch = vi.fn(() =>
      Promise.resolve({
        anonymizedAccounts: 1,
        deletedInvitations: 2,
        deletedPasswordResets: 3,
        deletedSessions: 4,
      }),
    );
    const repository: IdentityRetentionRepository = { runBatch };
    const service = createIdentityRetentionService({
      repository,
      retentionDays: {
        invitation: 180,
        passwordReset: 30,
        session: 90,
        disabledAccountPii: 365,
      },
      now: () => new Date('2027-01-01T00:00:00.000Z'),
      requestId: () => requestId,
    });

    await expect(service.run({ batchSize: 100 })).resolves.toEqual({
      anonymizedAccounts: 1,
      deletedInvitations: 2,
      deletedPasswordResets: 3,
      deletedSessions: 4,
    });
    expect(runBatch).toHaveBeenCalledWith({
      batchSize: 100,
      now: new Date('2027-01-01T00:00:00.000Z'),
      requestId,
      retentionDays: {
        invitation: 180,
        passwordReset: 30,
        session: 90,
        disabledAccountPii: 365,
      },
    });
  });

  it.each([0, -1, 1001, 1.5])(
    'rejects unsafe batch size %s before persistence',
    async (batchSize) => {
      const runBatch = vi.fn();
      const repository: IdentityRetentionRepository = { runBatch };
      const service = createIdentityRetentionService({
        repository,
        retentionDays: {
          invitation: 180,
          passwordReset: 30,
          session: 90,
          disabledAccountPii: 365,
        },
      });

      await expect(service.run({ batchSize })).rejects.toThrow(RangeError);
      expect(runBatch).not.toHaveBeenCalled();
    },
  );

  it('fails closed for changed retention policy or an invalid clock', async () => {
    const runBatch = vi.fn();
    const repository: IdentityRetentionRepository = { runBatch };

    expect(() =>
      createIdentityRetentionService({
        repository,
        retentionDays: {
          invitation: 180,
          passwordReset: 30,
          session: 90,
          disabledAccountPii: 364,
        },
      }),
    ).toThrow(RangeError);

    const service = createIdentityRetentionService({
      repository,
      retentionDays: {
        invitation: 180,
        passwordReset: 30,
        session: 90,
        disabledAccountPii: 365,
      },
      now: () => new Date(Number.NaN),
    });
    await expect(service.run()).rejects.toThrow(RangeError);
    expect(runBatch).not.toHaveBeenCalled();
  });

  it('rejects an unsafe database schema identifier', () => {
    expect(() =>
      createPrismaIdentityRetentionRepository({} as never, {
        schema: 'public; DROP SCHEMA public',
      }),
    ).toThrow(RangeError);
  });
});
