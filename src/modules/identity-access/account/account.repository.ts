import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import type { ScryptPasswordVerifier } from '../crypto/password.js';

export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
export type AccountRole = 'MANAGER' | 'STAFF' | 'COUPLE';

export type AccountAuthenticationRecord = Readonly<{
  accountId: string;
  displayEmail: string;
  status: AccountStatus;
  roles: readonly AccountRole[];
  passwordVerifier: ScryptPasswordVerifier | null;
}>;

export type BootstrapManagerRecord = Readonly<{
  accountId: string;
  displayEmail: string;
  roles: readonly ['MANAGER'];
}>;

export type SecurityAuditContext = Readonly<{
  requestId: string;
  actorAccountId?: string;
}>;

export type BootstrapManagerInput = Readonly<{
  emailNormalized: string;
  displayEmail: string;
  passwordVerifier: ScryptPasswordVerifier;
  environment: 'development' | 'test' | 'staging' | 'production';
  operatorReference: string;
  audit: SecurityAuditContext;
}>;

export type ReplacePasswordInput = Readonly<{
  accountId: string;
  passwordVerifier: ScryptPasswordVerifier;
  audit: SecurityAuditContext;
}>;

export type GrantRoleInput = Readonly<{
  accountId: string;
  role: AccountRole;
  audit: SecurityAuditContext;
}>;

export type RecordRetentionEligibilityInput = Readonly<{
  accountId: string;
  consultationId: string;
  sourceBusinessRecordId: string;
  eligibleAfter: Date;
  piiEligibleAt: Date;
  audit: SecurityAuditContext;
}>;

export interface AccountRepository {
  findForAuthentication(emailNormalized: string): Promise<AccountAuthenticationRecord | null>;
  bootstrapInitialManager(input: BootstrapManagerInput): Promise<BootstrapManagerRecord>;
  replacePassword(input: ReplacePasswordInput): Promise<void>;
  grantRole(input: GrantRoleInput): Promise<void>;
  recordRetentionEligibility(input: RecordRetentionEligibilityInput): Promise<Date | null>;
  isPiiErasureAllowed(accountId: string, now: Date): Promise<boolean>;
}

export class InitialManagerAlreadyExistsRepositoryError extends Error {
  override readonly name = 'InitialManagerAlreadyExistsRepositoryError';

  constructor() {
    super('The initial Manager has already been bootstrapped.');
  }
}

export class RetentionAccessNotFoundRepositoryError extends Error {
  override readonly name = 'RetentionAccessNotFoundRepositoryError';

  constructor() {
    super('Retention eligibility requires an existing consultation access grant.');
  }
}

export function createPrismaAccountRepository(prisma: PrismaClient): AccountRepository {
  return {
    async findForAuthentication(emailNormalized) {
      const account = await prisma.account.findUnique({
        where: { emailNormalized },
        include: { passwordCredential: true, roles: { select: { role: true } } },
      });

      if (account === null) {
        return null;
      }

      return Object.freeze({
        accountId: account.id,
        displayEmail: account.displayEmail,
        status: account.status,
        roles: Object.freeze(account.roles.map(({ role }) => role)),
        passwordVerifier:
          account.passwordCredential === null
            ? null
            : toPasswordVerifier(account.passwordCredential),
      });
    },

    async bootstrapInitialManager(input) {
      try {
        return await prisma.$transaction(async (transaction) => {
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('identity-access.bootstrap-manager'))`;
          const managerCount = await transaction.accountRole.count({ where: { role: 'MANAGER' } });
          if (managerCount > 0) {
            throw new InitialManagerAlreadyExistsRepositoryError();
          }

          const account = await transaction.account.create({
            data: {
              emailNormalized: input.emailNormalized,
              displayEmail: input.displayEmail,
              passwordCredential: { create: passwordVerifierData(input.passwordVerifier) },
              roles: { create: { role: 'MANAGER' } },
            },
          });
          await appendAudit(transaction, {
            ...input.audit,
            action: 'account.manager.bootstrapped',
            entityType: 'account',
            entityId: account.id,
            metadata: {
              environment: input.environment,
              operatorReference: input.operatorReference,
            },
          });

          return Object.freeze({
            accountId: account.id,
            displayEmail: account.displayEmail,
            roles: Object.freeze(['MANAGER'] as const),
          });
        });
      } catch (error: unknown) {
        if (
          error instanceof InitialManagerAlreadyExistsRepositoryError ||
          isUniqueConstraintError(error)
        ) {
          throw new InitialManagerAlreadyExistsRepositoryError();
        }
        throw error;
      }
    },

    async replacePassword(input) {
      await prisma.$transaction(async (transaction) => {
        await transaction.passwordCredential.upsert({
          where: { accountId: input.accountId },
          create: { accountId: input.accountId, ...passwordVerifierData(input.passwordVerifier) },
          update: passwordVerifierData(input.passwordVerifier),
        });
        await appendAudit(transaction, {
          ...input.audit,
          action: 'account.password.replaced',
          entityType: 'account',
          entityId: input.accountId,
          metadata: {},
        });
      });
    },

    async grantRole(input) {
      await prisma.$transaction(async (transaction) => {
        await transaction.accountRole.upsert({
          where: { accountId_role: { accountId: input.accountId, role: input.role } },
          create: { accountId: input.accountId, role: input.role },
          update: {},
        });
        await appendAudit(transaction, {
          ...input.audit,
          action: 'account.role.granted',
          entityType: 'account',
          entityId: input.accountId,
          metadata: { role: input.role },
        });
      });
    },

    async recordRetentionEligibility(input) {
      return prisma.$transaction(async (transaction) => {
        const linkedAccess = await transaction.consultationAccess.findUnique({
          where: {
            accountId_consultationId: {
              accountId: input.accountId,
              consultationId: input.consultationId,
            },
          },
          select: { id: true },
        });
        if (linkedAccess === null) {
          throw new RetentionAccessNotFoundRepositoryError();
        }
        await transaction.accountRetentionEligibilityFact.upsert({
          where: {
            accountId_consultationId: {
              accountId: input.accountId,
              consultationId: input.consultationId,
            },
          },
          create: {
            accountId: input.accountId,
            consultationId: input.consultationId,
            sourceBusinessRecordId: input.sourceBusinessRecordId,
            eligibleAfter: input.eligibleAfter,
          },
          update: {
            sourceBusinessRecordId: input.sourceBusinessRecordId,
            eligibleAfter: input.eligibleAfter,
          },
        });

        const [accesses, facts] = await Promise.all([
          transaction.consultationAccess.findMany({
            where: { accountId: input.accountId },
            select: { consultationId: true },
          }),
          transaction.accountRetentionEligibilityFact.findMany({
            where: { accountId: input.accountId },
            select: { consultationId: true, eligibleAfter: true },
          }),
        ]);
        const factByConsultation = new Map(
          facts.map((fact) => [fact.consultationId, fact.eligibleAfter]),
        );
        const linkedEligibilityDates = accesses.flatMap((access) => {
          const date = factByConsultation.get(access.consultationId);
          return date === undefined ? [] : [date];
        });
        const allLinkedRecordsTerminal =
          accesses.length > 0 && linkedEligibilityDates.length === accesses.length;
        const latestEligibility = allLinkedRecordsTerminal
          ? linkedEligibilityDates.reduce(
              (latest, date) => (date.getTime() > latest.getTime() ? date : latest),
              linkedEligibilityDates[0]!,
            )
          : null;
        const piiRetentionEligibleAt =
          latestEligibility === null
            ? null
            : new Date(
                latestEligibility.getTime() +
                  (input.piiEligibleAt.getTime() - input.eligibleAfter.getTime()),
              );

        await transaction.account.update({
          where: { id: input.accountId },
          data: { piiRetentionEligibleAt },
        });
        await appendAudit(transaction, {
          ...input.audit,
          action: 'account.retention-eligibility.recorded',
          entityType: 'account',
          entityId: input.accountId,
          metadata: { allLinkedRecordsTerminal },
        });
        return piiRetentionEligibleAt;
      });
    },

    async isPiiErasureAllowed(accountId, now) {
      const account = await prisma.account.findUnique({
        where: { id: accountId },
        include: {
          consultationAccesses: { select: { consultationId: true } },
          retentionFacts: { select: { consultationId: true } },
        },
      });

      return (
        account !== null &&
        account.status === 'DISABLED' &&
        account.piiRetentionEligibleAt !== null &&
        account.piiRetentionEligibleAt.getTime() <= now.getTime() &&
        allConsultationsHaveFacts(account.consultationAccesses, account.retentionFacts) &&
        (account.legalHoldUntil === null || account.legalHoldUntil.getTime() <= now.getTime())
      );
    },
  };
}

function allConsultationsHaveFacts(
  accesses: readonly Readonly<{ consultationId: string }>[],
  facts: readonly Readonly<{ consultationId: string }>[],
): boolean {
  const factConsultationIds = new Set(facts.map(({ consultationId }) => consultationId));
  return (
    accesses.length > 0 &&
    accesses.every(({ consultationId }) => factConsultationIds.has(consultationId))
  );
}

type PasswordCredentialRow = Readonly<{
  algorithm: string;
  version: number;
  cost: number;
  blockSize: number;
  parallelization: number;
  keyLengthBytes: number;
  maxMemoryBytes: number;
  saltEncoded: string;
  derivedKeyEncoded: string;
}>;

function toPasswordVerifier(record: PasswordCredentialRow): ScryptPasswordVerifier | null {
  if (record.algorithm !== 'scrypt' || record.version !== 1) {
    return null;
  }
  return Object.freeze({
    algorithm: 'scrypt',
    version: 1,
    parameters: Object.freeze({
      cost: record.cost,
      blockSize: record.blockSize,
      parallelization: record.parallelization,
      keyLengthBytes: record.keyLengthBytes,
      maxMemoryBytes: record.maxMemoryBytes,
    }),
    saltEncoded: record.saltEncoded,
    derivedKeyEncoded: record.derivedKeyEncoded,
  });
}

function passwordVerifierData(verifier: ScryptPasswordVerifier) {
  return {
    algorithm: verifier.algorithm,
    version: verifier.version,
    cost: verifier.parameters.cost,
    blockSize: verifier.parameters.blockSize,
    parallelization: verifier.parameters.parallelization,
    keyLengthBytes: verifier.parameters.keyLengthBytes,
    maxMemoryBytes: verifier.parameters.maxMemoryBytes,
    saltEncoded: verifier.saltEncoded,
    derivedKeyEncoded: verifier.derivedKeyEncoded,
  };
}

type Transaction = Prisma.TransactionClient;
type AuditWrite = SecurityAuditContext &
  Readonly<{
    action: string;
    entityType: string;
    entityId: string;
    metadata: Prisma.InputJsonObject;
  }>;

async function appendAudit(transaction: Transaction, input: AuditWrite): Promise<void> {
  await transaction.auditLog.create({
    data: {
      requestId: input.requestId,
      actorType: input.actorAccountId === undefined ? 'SYSTEM' : 'USER',
      actorId: input.actorAccountId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata,
    },
  });
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
