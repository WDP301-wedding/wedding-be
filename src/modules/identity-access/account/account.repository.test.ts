import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../../../generated/prisma/client.js';
import {
  createPrismaAccountRepository,
  InitialManagerAlreadyExistsRepositoryError,
  RetentionAccessNotFoundRepositoryError,
} from './account.repository.js';

const verifier = {
  algorithm: 'scrypt' as const,
  version: 1 as const,
  parameters: {
    cost: 2,
    blockSize: 1,
    parallelization: 1,
    keyLengthBytes: 16,
    maxMemoryBytes: 4096,
  },
  saltEncoded: 'c2FsdHNhbHRzYWx0c2FsdA',
  derivedKeyEncoded: 'ZGVyaXZlZGRlcml2ZWQ',
};

describe('Prisma account repository', () => {
  it('maps current authentication state and malformed verifier metadata safely', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: randomUUID(),
        displayEmail: 'Couple@example.com',
        status: 'ACTIVE',
        roles: [{ role: 'COUPLE' }],
        passwordCredential: {
          algorithm: 'scrypt',
          version: 1,
          cost: 2,
          blockSize: 1,
          parallelization: 1,
          keyLengthBytes: 16,
          maxMemoryBytes: 4096,
          saltEncoded: verifier.saltEncoded,
          derivedKeyEncoded: verifier.derivedKeyEncoded,
        },
      })
      .mockResolvedValueOnce({
        id: randomUUID(),
        displayEmail: 'broken@example.com',
        status: 'ACTIVE',
        roles: [],
        passwordCredential: { ...verifier, algorithm: 'unknown', version: 99 },
      });
    const repository = createPrismaAccountRepository(prisma({ account: { findUnique } }));

    await expect(repository.findForAuthentication('missing@example.com')).resolves.toBeNull();
    await expect(repository.findForAuthentication('couple@example.com')).resolves.toMatchObject({
      status: 'ACTIVE',
      roles: ['COUPLE'],
      passwordVerifier: verifier,
    });
    await expect(repository.findForAuthentication('broken@example.com')).resolves.toMatchObject({
      passwordVerifier: null,
    });
  });

  it('bootstraps one Manager with password and audit in one transaction', async () => {
    const accountId = randomUUID();
    const audits: unknown[] = [];
    const transaction = {
      $executeRaw: vi.fn(() => Promise.resolve(1)),
      accountRole: { count: vi.fn(() => Promise.resolve(0)) },
      account: {
        create: vi.fn(() =>
          Promise.resolve({ id: accountId, displayEmail: 'Manager@example.com' }),
        ),
      },
      auditLog: {
        create: vi.fn((input: unknown) => {
          audits.push(input);
          return Promise.resolve({ id: randomUUID() });
        }),
      },
    };
    const repository = createPrismaAccountRepository(transactionalPrisma(transaction));

    await expect(
      repository.bootstrapInitialManager({
        emailNormalized: 'manager@example.com',
        displayEmail: 'Manager@example.com',
        passwordVerifier: verifier,
        environment: 'test',
        operatorReference: 'operator-01',
        audit: { requestId: randomUUID() },
      }),
    ).resolves.toEqual({
      accountId,
      displayEmail: 'Manager@example.com',
      roles: ['MANAGER'],
    });
    expect(transaction.account.create).toHaveBeenCalledOnce();
    expect(audits[0]).toMatchObject({
      data: {
        action: 'account.manager.bootstrapped',
        actorType: 'SYSTEM',
        actorId: null,
      },
    });
  });

  it('fails a repeated Manager bootstrap before writing an account', async () => {
    const transaction = {
      $executeRaw: vi.fn(() => Promise.resolve(1)),
      accountRole: { count: vi.fn(() => Promise.resolve(1)) },
      account: { create: vi.fn() },
    };
    const repository = createPrismaAccountRepository(transactionalPrisma(transaction));

    await expect(
      repository.bootstrapInitialManager({
        emailNormalized: 'manager@example.com',
        displayEmail: 'manager@example.com',
        passwordVerifier: verifier,
        environment: 'test',
        operatorReference: 'operator-01',
        audit: { requestId: randomUUID() },
      }),
    ).rejects.toBeInstanceOf(InitialManagerAlreadyExistsRepositoryError);
    expect(transaction.account.create).not.toHaveBeenCalled();
  });

  it('replaces credentials and grants a role with attributed audits', async () => {
    const audits: unknown[] = [];
    const transaction = {
      passwordCredential: { upsert: vi.fn(() => Promise.resolve({})) },
      accountRole: { upsert: vi.fn(() => Promise.resolve({})) },
      auditLog: {
        create: vi.fn((input: unknown) => {
          audits.push(input);
          return Promise.resolve({ id: randomUUID() });
        }),
      },
    };
    const repository = createPrismaAccountRepository(transactionalPrisma(transaction));
    const accountId = randomUUID();
    const actorAccountId = randomUUID();

    await repository.replacePassword({
      accountId,
      passwordVerifier: verifier,
      audit: { requestId: randomUUID(), actorAccountId },
    });
    await repository.grantRole({
      accountId,
      role: 'STAFF',
      audit: { requestId: randomUUID(), actorAccountId },
    });

    expect(transaction.passwordCredential.upsert).toHaveBeenCalledOnce();
    expect(transaction.accountRole.upsert).toHaveBeenCalledOnce();
    expect(transaction.auditLog.create).toHaveBeenCalledTimes(2);
    expect(audits[1]).toMatchObject({
      data: {
        actorType: 'USER',
        actorId: actorAccountId,
        metadata: { role: 'STAFF' },
      },
    });
  });

  it.each([
    [
      ['consultation-1', 'consultation-2'],
      [
        {
          consultationId: 'consultation-1',
          eligibleAfter: new Date('2025-01-01T00:00:00.000Z'),
        },
      ],
      null,
    ],
    [
      ['consultation-1', 'consultation-2'],
      [
        {
          consultationId: 'consultation-1',
          eligibleAfter: new Date('2025-01-01T00:00:00.000Z'),
        },
        {
          consultationId: 'consultation-2',
          eligibleAfter: new Date('2025-02-01T00:00:00.000Z'),
        },
      ],
      new Date('2026-02-01T00:00:00.000Z'),
    ],
  ])(
    'derives retention only when every linked consultation has a matching fact',
    async (consultationIds, facts, expected) => {
      const transaction = {
        accountRetentionEligibilityFact: {
          upsert: vi.fn(() => Promise.resolve({})),
          findMany: vi.fn(() => Promise.resolve(facts)),
        },
        consultationAccess: {
          findUnique: vi.fn(() => Promise.resolve({ id: randomUUID() })),
          findMany: vi.fn(() =>
            Promise.resolve(consultationIds.map((consultationId) => ({ consultationId }))),
          ),
        },
        account: { update: vi.fn(() => Promise.resolve({})) },
        auditLog: { create: vi.fn(() => Promise.resolve({ id: randomUUID() })) },
      };
      const repository = createPrismaAccountRepository(transactionalPrisma(transaction));

      await expect(
        repository.recordRetentionEligibility({
          accountId: randomUUID(),
          consultationId: randomUUID(),
          sourceBusinessRecordId: randomUUID(),
          eligibleAfter: new Date('2025-01-01T00:00:00.000Z'),
          piiEligibleAt: new Date('2026-01-01T00:00:00.000Z'),
          audit: { requestId: randomUUID() },
        }),
      ).resolves.toEqual(expected);
    },
  );

  it('rejects retention facts for consultations not linked to the account', async () => {
    const repository = createPrismaAccountRepository(
      transactionalPrisma({
        consultationAccess: { findUnique: vi.fn(() => Promise.resolve(null)) },
      }),
    );

    await expect(
      repository.recordRetentionEligibility({
        accountId: randomUUID(),
        consultationId: randomUUID(),
        sourceBusinessRecordId: randomUUID(),
        eligibleAfter: new Date('2025-01-01T00:00:00.000Z'),
        piiEligibleAt: new Date('2026-01-01T00:00:00.000Z'),
        audit: { requestId: randomUUID() },
      }),
    ).rejects.toBeInstanceOf(RetentionAccessNotFoundRepositoryError);
  });

  it.each([
    [null, false],
    [
      {
        status: 'DISABLED',
        piiRetentionEligibleAt: new Date('2026-01-01T00:00:00.000Z'),
        legalHoldUntil: new Date('2028-01-01T00:00:00.000Z'),
        consultationAccesses: [{ consultationId: 'consultation-1' }],
        retentionFacts: [{ consultationId: 'consultation-1' }],
      },
      false,
    ],
    [
      {
        status: 'DISABLED',
        piiRetentionEligibleAt: new Date('2026-01-01T00:00:00.000Z'),
        legalHoldUntil: null,
        consultationAccesses: [{ consultationId: 'consultation-1' }],
        retentionFacts: [{ consultationId: 'consultation-1' }],
      },
      true,
    ],
  ])('evaluates PII erasure eligibility without bypassing holds', async (account, expected) => {
    const repository = createPrismaAccountRepository(
      prisma({ account: { findUnique: vi.fn(() => Promise.resolve(account)) } }),
    );
    await expect(
      repository.isPiiErasureAllowed(randomUUID(), new Date('2027-01-01T00:00:00.000Z')),
    ).resolves.toBe(expected);
  });
});

function prisma(value: object): PrismaClient {
  return value as unknown as PrismaClient;
}

function transactionalPrisma(transaction: object): PrismaClient {
  return prisma({
    $transaction: (operation: (candidate: object) => Promise<unknown>) => operation(transaction),
  });
}
