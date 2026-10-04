import { z } from 'zod';

import type {
  AccountRepository,
  AccountRole,
  AccountStatus,
  SecurityAuditContext,
} from './account.repository.js';
import {
  InitialManagerAlreadyExistsRepositoryError,
  type BootstrapManagerRecord,
} from './account.repository.js';
import type { PasswordVerification, ScryptPasswordVerifier } from '../crypto/password.js';

export type PasswordCrypto = Readonly<{
  hash(password: string): Promise<ScryptPasswordVerifier>;
  verify(password: string, verifier: unknown): Promise<PasswordVerification>;
}>;

export type AuthenticatedAccount = Readonly<{
  accountId: string;
  displayEmail: string;
  roles: readonly AccountRole[];
}>;

export type RoleGrantAuthority = 'staff-provisioning' | 'couple-promotion';
export type InvalidCredentialsReason =
  'unknown-account' | 'inactive-account' | 'missing-password-credential' | 'password-mismatch';

const invalidCredentialReasons = new WeakMap<InvalidCredentialsError, InvalidCredentialsReason>();

export class InvalidCredentialsError extends Error {
  override readonly name = 'InvalidCredentialsError';

  constructor(reason: InvalidCredentialsReason = 'password-mismatch') {
    super('The supplied credentials are invalid.');
    invalidCredentialReasons.set(this, reason);
  }
}

export function invalidCredentialsReason(error: InvalidCredentialsError): InvalidCredentialsReason {
  return invalidCredentialReasons.get(error) ?? 'password-mismatch';
}

export class BootstrapManagerExistsError extends Error {
  override readonly name = 'BootstrapManagerExistsError';

  constructor() {
    super('The initial Manager has already been bootstrapped.');
  }
}

export class AccountAccessDeniedError extends Error {
  override readonly name = 'AccountAccessDeniedError';

  constructor() {
    super('The account operation is not permitted.');
  }
}

export class InvalidEmailError extends Error {
  override readonly name = 'InvalidEmailError';

  constructor() {
    super('The email address is invalid.');
  }
}

const emailSchema = z.email().max(320);
const operatorReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:@/-]+$/u);
const roleAuthorities: Readonly<Record<RoleGrantAuthority, AccountRole>> = Object.freeze({
  'staff-provisioning': 'STAFF',
  'couple-promotion': 'COUPLE',
});

export function normalizeEmail(email: string): Readonly<{ normalized: string; display: string }> {
  const display = email.trim().normalize('NFC');
  const containsControlCharacter = Array.from(display).some((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint <= 31 || codePoint === 127;
  });
  if (!emailSchema.safeParse(display).success || containsControlCharacter) {
    throw new InvalidEmailError();
  }
  return Object.freeze({ normalized: display.toLocaleLowerCase('en-US'), display });
}

export function createAccountService(
  options: Readonly<{
    repository: AccountRepository;
    passwordCrypto: PasswordCrypto;
    dummyPasswordVerifier: ScryptPasswordVerifier;
    disabledAccountRetentionDays: number;
  }>,
) {
  const retentionMilliseconds =
    validateRetentionDays(options.disabledAccountRetentionDays) * 24 * 60 * 60 * 1_000;

  return Object.freeze({
    async authenticate(
      input: Readonly<{ email: string; password: string }>,
    ): Promise<AuthenticatedAccount> {
      const { normalized } = normalizeEmail(input.email);
      const record = await options.repository.findForAuthentication(normalized);
      const candidate = record?.passwordVerifier ?? options.dummyPasswordVerifier;
      const verification = await options.passwordCrypto.verify(input.password, candidate);

      if (record === null) {
        throw new InvalidCredentialsError('unknown-account');
      }
      if (record.status !== 'ACTIVE') {
        throw new InvalidCredentialsError('inactive-account');
      }
      if (record.passwordVerifier === null) {
        throw new InvalidCredentialsError('missing-password-credential');
      }
      if (!verification.matches) {
        throw new InvalidCredentialsError('password-mismatch');
      }

      return Object.freeze({
        accountId: record.accountId,
        displayEmail: record.displayEmail,
        roles: Object.freeze([...record.roles]),
      });
    },

    async bootstrapInitialManager(
      input: Readonly<{
        email: string;
        password: string;
        environment: 'development' | 'test' | 'staging' | 'production';
        operatorReference: string;
        requestId: string;
      }>,
    ): Promise<BootstrapManagerRecord> {
      const email = normalizeEmail(input.email);
      const operatorReference = operatorReferenceSchema.parse(input.operatorReference);
      const passwordVerifier = await options.passwordCrypto.hash(input.password);
      try {
        return await options.repository.bootstrapInitialManager({
          emailNormalized: email.normalized,
          displayEmail: email.display,
          passwordVerifier,
          environment: input.environment,
          operatorReference,
          audit: { requestId: input.requestId },
        });
      } catch (error: unknown) {
        if (error instanceof InitialManagerAlreadyExistsRepositoryError) {
          throw new BootstrapManagerExistsError();
        }
        throw error;
      }
    },

    async replacePassword(
      input: Readonly<{
        accountId: string;
        password: string;
        requestId: string;
        actorAccountId?: string;
      }>,
    ): Promise<void> {
      const passwordVerifier = await options.passwordCrypto.hash(input.password);
      await options.repository.replacePassword({
        accountId: input.accountId,
        passwordVerifier,
        audit: auditContext(input),
      });
    },

    async grantRole(
      input: Readonly<{
        accountId: string;
        role: AccountRole;
        authority: RoleGrantAuthority;
        requestId: string;
        actorAccountId?: string;
      }>,
    ): Promise<void> {
      if (roleAuthorities[input.authority] !== input.role) {
        throw new AccountAccessDeniedError();
      }
      await options.repository.grantRole({
        accountId: input.accountId,
        role: input.role,
        audit: auditContext(input),
      });
    },

    async recordRetentionEligibility(
      input: Readonly<{
        accountId: string;
        consultationId: string;
        sourceBusinessRecordId: string;
        eligibleAfter: Date;
        requestId: string;
        actorAccountId?: string;
      }>,
    ): Promise<Date | null> {
      assertFiniteDate(input.eligibleAfter);
      return options.repository.recordRetentionEligibility({
        accountId: input.accountId,
        consultationId: input.consultationId,
        sourceBusinessRecordId: input.sourceBusinessRecordId,
        eligibleAfter: input.eligibleAfter,
        piiEligibleAt: new Date(input.eligibleAfter.getTime() + retentionMilliseconds),
        audit: auditContext(input),
      });
    },

    canEraseDisabledAccountPii(accountId: string, now = new Date()): Promise<boolean> {
      assertFiniteDate(now);
      return options.repository.isPiiErasureAllowed(accountId, now);
    },
  });
}

function auditContext(
  input: Readonly<{ requestId: string; actorAccountId?: string }>,
): SecurityAuditContext {
  return input.actorAccountId === undefined
    ? { requestId: input.requestId }
    : { requestId: input.requestId, actorAccountId: input.actorAccountId };
}

function validateRetentionDays(days: number): number {
  if (!Number.isSafeInteger(days) || days <= 0) {
    throw new RangeError('Disabled-account PII retention days must be a positive integer.');
  }
  return days;
}

function assertFiniteDate(date: Date): void {
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError('Expected a valid date.');
  }
}

export function accountMayAuthenticate(status: AccountStatus): boolean {
  return status === 'ACTIVE';
}
