import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type {
  AccountAuthenticationRecord,
  AccountRepository,
  BootstrapManagerRecord,
  RecordRetentionEligibilityInput,
} from './account.repository.js';
import { InitialManagerAlreadyExistsRepositoryError } from './account.repository.js';
import {
  AccountAccessDeniedError,
  BootstrapManagerExistsError,
  createAccountService,
  invalidCredentialsReason,
  normalizeEmail,
  type InvalidCredentialsError,
  type PasswordCrypto,
} from './account.service.js';

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

class FakeAccountRepository implements AccountRepository {
  authenticationRecord: AccountAuthenticationRecord | null = null;
  bootstrapRecord: BootstrapManagerRecord | null = null;
  retentionInputs: RecordRetentionEligibilityInput[] = [];
  replaced = 0;
  granted = 0;
  erasureAllowed = false;

  findForAuthentication(): Promise<AccountAuthenticationRecord | null> {
    return Promise.resolve(this.authenticationRecord);
  }

  bootstrapInitialManager(): Promise<BootstrapManagerRecord> {
    if (this.bootstrapRecord === null) {
      throw new InitialManagerAlreadyExistsRepositoryError();
    }
    return Promise.resolve(this.bootstrapRecord);
  }

  replacePassword(): Promise<void> {
    this.replaced += 1;
    return Promise.resolve();
  }

  grantRole(): Promise<void> {
    this.granted += 1;
    return Promise.resolve();
  }

  recordRetentionEligibility(input: RecordRetentionEligibilityInput): Promise<Date | null> {
    this.retentionInputs.push(input);
    return Promise.resolve(input.eligibleAfter);
  }

  isPiiErasureAllowed(): Promise<boolean> {
    return Promise.resolve(this.erasureAllowed);
  }
}

function crypto(matches: boolean): PasswordCrypto {
  return {
    hash: vi.fn(() => Promise.resolve(verifier)),
    verify: vi.fn(() => Promise.resolve({ matches, needsRehash: false })),
  };
}

function activeAccount(status: 'ACTIVE' | 'SUSPENDED' | 'DISABLED' = 'ACTIVE') {
  return {
    accountId: randomUUID(),
    displayEmail: 'Couple@Example.com',
    status,
    roles: ['COUPLE' as const],
    passwordVerifier: verifier,
  } satisfies AccountAuthenticationRecord;
}

describe('account service', () => {
  it('normalizes one account identity while preserving a safe display email', () => {
    expect(normalizeEmail('  Couple@Example.COM  ')).toEqual({
      normalized: 'couple@example.com',
      display: 'Couple@Example.COM',
    });
    expect(normalizeEmail('couple@example.com').normalized).toBe(
      normalizeEmail('COUPLE@EXAMPLE.COM').normalized,
    );
  });

  it.each(['not-an-email', `bad${String.fromCodePoint(7)}@example.com`])(
    'rejects unsafe email value %s',
    (email) => {
      expect(() => normalizeEmail(email)).toThrow();
    },
  );

  it.each([
    ['unknown', null, false, 'unknown-account'],
    ['incorrect password', activeAccount(), false, 'password-mismatch'],
    [
      'missing password',
      { ...activeAccount(), passwordVerifier: null },
      true,
      'missing-password-credential',
    ],
    ['suspended', activeAccount('SUSPENDED'), true, 'inactive-account'],
    ['disabled', activeAccount('DISABLED'), true, 'inactive-account'],
  ] as const)(
    'uses one public failure for %s credentials',
    async (_name, record, matches, expectedReason) => {
      const repository = new FakeAccountRepository();
      repository.authenticationRecord = record;
      const passwordCrypto = crypto(matches);
      const service = createAccountService({
        repository,
        passwordCrypto,
        dummyPasswordVerifier: verifier,
        disabledAccountRetentionDays: 365,
      });

      const error = await service
        .authenticate({ email: 'couple@example.com', password: 'not-the-password' })
        .catch((candidate: unknown) => candidate);

      expect(error).toMatchObject({
        name: 'InvalidCredentialsError',
        message: 'The supplied credentials are invalid.',
      });
      expect(invalidCredentialsReason(error as InvalidCredentialsError)).toBe(expectedReason);
      expect(passwordCrypto.verify).toHaveBeenCalledOnce();
    },
  );

  it('returns only the active account identity and current roles after verification', async () => {
    const repository = new FakeAccountRepository();
    const record = activeAccount();
    repository.authenticationRecord = record;
    const service = createAccountService({
      repository,
      passwordCrypto: crypto(true),
      dummyPasswordVerifier: verifier,
      disabledAccountRetentionDays: 365,
    });

    await expect(
      service.authenticate({ email: 'COUPLE@example.com', password: 'correct-password' }),
    ).resolves.toEqual({
      accountId: record.accountId,
      displayEmail: record.displayEmail,
      roles: ['COUPLE'],
    });
  });

  it('allows each privileged role only through its owning internal authority', async () => {
    const repository = new FakeAccountRepository();
    const service = createAccountService({
      repository,
      passwordCrypto: crypto(true),
      dummyPasswordVerifier: verifier,
      disabledAccountRetentionDays: 365,
    });

    await expect(
      service.grantRole({
        accountId: randomUUID(),
        role: 'MANAGER',
        authority: 'staff-provisioning',
        requestId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(AccountAccessDeniedError);
    await expect(
      service.grantRole({
        accountId: randomUUID(),
        role: 'STAFF',
        authority: 'staff-provisioning',
        requestId: randomUUID(),
      }),
    ).resolves.toBeUndefined();
    await expect(
      service.grantRole({
        accountId: randomUUID(),
        role: 'COUPLE',
        authority: 'couple-promotion',
        requestId: randomUUID(),
      }),
    ).resolves.toBeUndefined();
    expect(repository.granted).toBe(2);
  });

  it('hashes bootstrap and replacement passwords before repository persistence', async () => {
    const repository = new FakeAccountRepository();
    repository.bootstrapRecord = {
      accountId: randomUUID(),
      displayEmail: 'Manager@example.com',
      roles: ['MANAGER'],
    };
    const passwordCrypto = crypto(true);
    const service = createAccountService({
      repository,
      passwordCrypto,
      dummyPasswordVerifier: verifier,
      disabledAccountRetentionDays: 365,
    });

    await expect(
      service.bootstrapInitialManager({
        email: 'Manager@example.com',
        password: 'manager-password',
        environment: 'test',
        operatorReference: 'operator-01',
        requestId: randomUUID(),
      }),
    ).resolves.toEqual(repository.bootstrapRecord);
    await service.replacePassword({
      accountId: randomUUID(),
      password: 'replacement-password',
      requestId: randomUUID(),
      actorAccountId: randomUUID(),
    });
    expect(passwordCrypto.hash).toHaveBeenCalledTimes(2);
    expect(repository.replaced).toBe(1);
  });

  it('maps duplicate bootstrap to one domain error', async () => {
    const repository = new FakeAccountRepository();
    const service = createAccountService({
      repository,
      passwordCrypto: crypto(true),
      dummyPasswordVerifier: verifier,
      disabledAccountRetentionDays: 365,
    });

    await expect(
      service.bootstrapInitialManager({
        email: 'Manager@example.com',
        password: 'manager-password',
        environment: 'test',
        operatorReference: 'operator-01',
        requestId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(BootstrapManagerExistsError);
  });

  it('records retention eligibility only through the internal boundary and adds the wait', async () => {
    const repository = new FakeAccountRepository();
    const service = createAccountService({
      repository,
      passwordCrypto: crypto(true),
      dummyPasswordVerifier: verifier,
      disabledAccountRetentionDays: 365,
    });
    const eligibleAfter = new Date('2026-10-03T00:00:00.000Z');

    await service.recordRetentionEligibility({
      accountId: randomUUID(),
      consultationId: randomUUID(),
      sourceBusinessRecordId: randomUUID(),
      eligibleAfter,
      requestId: randomUUID(),
    });

    expect(repository.retentionInputs[0]?.piiEligibleAt).toEqual(
      new Date('2027-10-03T00:00:00.000Z'),
    );
  });

  it('rejects invalid retention dates and delegates the final hold-aware erasure decision', async () => {
    const repository = new FakeAccountRepository();
    repository.erasureAllowed = true;
    const service = createAccountService({
      repository,
      passwordCrypto: crypto(true),
      dummyPasswordVerifier: verifier,
      disabledAccountRetentionDays: 365,
    });

    await expect(
      service.recordRetentionEligibility({
        accountId: randomUUID(),
        consultationId: randomUUID(),
        sourceBusinessRecordId: randomUUID(),
        eligibleAfter: new Date(Number.NaN),
        requestId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      service.canEraseDisabledAccountPii(randomUUID(), new Date('2027-01-01T00:00:00.000Z')),
    ).resolves.toBe(true);
    expect(() =>
      createAccountService({
        repository,
        passwordCrypto: crypto(true),
        dummyPasswordVerifier: verifier,
        disabledAccountRetentionDays: 0,
      }),
    ).toThrow(RangeError);
  });
});
