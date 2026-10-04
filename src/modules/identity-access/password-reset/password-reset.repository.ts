import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import type { ScryptPasswordVerifier } from '../crypto/password.js';

export type CreatePasswordResetCredentialInput = Readonly<{
  accountId: string;
  tokenHash: string;
  expiresAt: Date;
  now: Date;
  requestId: string;
}>;

export type CompletePasswordResetInput = Readonly<{
  resetTokenHash: string;
  passwordVerifier: ScryptPasswordVerifier;
  now: Date;
  requestId: string;
}>;

export interface PasswordResetRepository {
  findEligibleAccount(
    emailNormalized: string,
  ): Promise<Readonly<{ accountId: string; displayEmail: string }> | null>;
  createCredential(
    input: CreatePasswordResetCredentialInput,
  ): Promise<Readonly<{ credentialId: string }>>;
  complete(input: CompletePasswordResetInput): Promise<boolean>;
}

export function createPrismaPasswordResetRepository(prisma: PrismaClient): PasswordResetRepository {
  return Object.freeze({
    async findEligibleAccount(emailNormalized: string) {
      const account = await prisma.account.findUnique({
        where: { emailNormalized },
        select: { id: true, displayEmail: true, status: true },
      });
      return account?.status === 'ACTIVE'
        ? Object.freeze({ accountId: account.id, displayEmail: account.displayEmail })
        : null;
    },

    async createCredential(input: CreatePasswordResetCredentialInput) {
      return prisma.$transaction(async (transaction) => {
        await transaction.passwordResetCredential.updateMany({
          where: { accountId: input.accountId, status: 'ACTIVE' },
          data: { status: 'REVOKED', revokedAt: input.now },
        });
        const credential = await transaction.passwordResetCredential.create({
          data: {
            accountId: input.accountId,
            tokenHash: input.tokenHash,
            expiresAt: input.expiresAt,
            createdAt: input.now,
          },
          select: { id: true },
        });
        await appendAudit(transaction, {
          requestId: input.requestId,
          action: 'password-reset.requested',
          entityType: 'password-reset-credential',
          entityId: credential.id,
        });
        return Object.freeze({ credentialId: credential.id });
      });
    },

    complete(input: CompletePasswordResetInput) {
      return completeWithRetry(prisma, input);
    },
  });
}

async function completeWithRetry(
  prisma: PrismaClient,
  input: CompletePasswordResetInput,
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (transaction) => {
          const credential = await transaction.passwordResetCredential.findUnique({
            where: { tokenHash: input.resetTokenHash },
            select: { id: true, accountId: true, status: true, expiresAt: true },
          });
          if (
            credential === null ||
            credential.status !== 'ACTIVE' ||
            credential.expiresAt.getTime() <= input.now.getTime()
          ) {
            if (credential?.status === 'ACTIVE') {
              await transaction.passwordResetCredential.updateMany({
                where: { id: credential.id, status: 'ACTIVE' },
                data: { status: 'EXPIRED', expiredAt: input.now },
              });
            }
            return false;
          }

          const consumed = await transaction.passwordResetCredential.updateMany({
            where: { id: credential.id, status: 'ACTIVE', expiresAt: { gt: input.now } },
            data: { status: 'CONSUMED', consumedAt: input.now },
          });
          if (consumed.count !== 1) {
            return false;
          }
          await transaction.passwordCredential.upsert({
            where: { accountId: credential.accountId },
            create: {
              accountId: credential.accountId,
              ...passwordVerifierData(input.passwordVerifier),
            },
            update: passwordVerifierData(input.passwordVerifier),
          });
          const sessions = await transaction.session.findMany({
            where: { accountId: credential.accountId, status: 'ACTIVE' },
            select: { id: true },
          });
          const sessionIds = sessions.map(({ id }) => id);
          if (sessionIds.length > 0) {
            await Promise.all([
              transaction.session.updateMany({
                where: { id: { in: sessionIds }, status: 'ACTIVE' },
                data: {
                  status: 'REVOKED',
                  revokedAt: input.now,
                  revocationReason: 'password-reset',
                },
              }),
              transaction.accessCredential.updateMany({
                where: { sessionId: { in: sessionIds }, status: 'ACTIVE' },
                data: { status: 'REVOKED', revokedAt: input.now },
              }),
              transaction.refreshCredential.updateMany({
                where: { sessionId: { in: sessionIds }, status: 'ACTIVE' },
                data: { status: 'REVOKED', revokedAt: input.now },
              }),
            ]);
          }
          await appendAudit(transaction, {
            requestId: input.requestId,
            action: 'password-reset.completed',
            entityType: 'account',
            entityId: credential.accountId,
          });
          return true;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error: unknown) {
      if (!isRetryableTransactionError(error) || attempt === 2) {
        throw error;
      }
    }
  }
  return false;
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

async function appendAudit(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    requestId: string;
    action: string;
    entityType: string;
    entityId: string;
  }>,
): Promise<void> {
  await transaction.auditLog.create({
    data: {
      requestId: input.requestId,
      actorType: 'SYSTEM',
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: {},
    },
  });
}

function isRetryableTransactionError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}
