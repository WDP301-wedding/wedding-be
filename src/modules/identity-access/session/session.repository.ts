import { randomUUID } from 'node:crypto';

import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import type { AccountRole, AccountStatus } from '../account/account.repository.js';
import { readAccessCredential } from '../authorization/access-credential.reader.js';

export type SessionClientKind = 'WEB' | 'ANDROID';
export type SessionStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED' | 'COMPROMISED';

export type CreateSessionInput = Readonly<{
  accountId: string;
  clientKind: SessionClientKind;
  accessTokenHash: string;
  refreshTokenHash: string;
  accessExpiresAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  now: Date;
}>;

export type RotateRefreshInput = Readonly<{
  presentedTokenHash: string;
  successorTokenHash: string;
  accessTokenHash: string;
  requestedAccessExpiresAt: Date;
  requestedIdleExpiresAt: Date;
  now: Date;
}>;

export type RefreshRotationOutcome =
  | Readonly<{
      outcome: 'ROTATED';
      accountId: string;
      sessionId: string;
      clientKind: SessionClientKind;
      accessExpiresAt: Date;
      refreshExpiresAt: Date;
    }>
  | Readonly<{ outcome: 'REPLAYED'; accountId: string; sessionId: string }>
  | Readonly<{ outcome: 'INVALID' }>;

export type SessionSummary = Readonly<{
  sessionId: string;
  clientKind: SessionClientKind;
  status: SessionStatus;
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}>;

export type AccessCredentialState = Readonly<{
  accountId: string;
  sessionId: string;
  displayEmail: string;
  credentialStatus: 'ACTIVE' | 'CONSUMED' | 'REVOKED' | 'EXPIRED';
  credentialExpiresAt: Date;
  sessionStatus: SessionStatus;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  accountStatus: AccountStatus;
  roles: readonly AccountRole[];
}>;

export type SessionPage = Readonly<{
  sessions: readonly SessionSummary[];
  nextCursor: string | null;
}>;

export interface SessionRepository {
  createSession(
    input: CreateSessionInput,
  ): Promise<Readonly<{ sessionId: string; accountId: string }>>;
  rotateRefresh(input: RotateRefreshInput): Promise<RefreshRotationOutcome>;
  revokeSession(
    input: Readonly<{
      sessionId: string;
      accountId?: string;
      reason: string;
      now: Date;
    }>,
  ): Promise<boolean>;
  revokeAllSessions(
    input: Readonly<{ accountId: string; reason: string; now: Date }>,
  ): Promise<number>;
  listSessions(
    accountId: string,
    input: Readonly<{ limit: number; cursor?: string }>,
  ): Promise<SessionPage>;
  findActorByAccessTokenHash(tokenHash: string): Promise<AccessCredentialState | null>;
}

export function createPrismaSessionRepository(prisma: PrismaClient): SessionRepository {
  return {
    async createSession(input) {
      return prisma.$transaction(async (transaction) => {
        const session = await transaction.session.create({
          data: {
            accountId: input.accountId,
            clientKind: input.clientKind,
            refreshFamilyId: randomUUID(),
            idleExpiresAt: input.idleExpiresAt,
            absoluteExpiresAt: input.absoluteExpiresAt,
            lastSeenAt: input.now,
            accessCredentials: {
              create: { tokenHash: input.accessTokenHash, expiresAt: input.accessExpiresAt },
            },
            refreshCredentials: {
              create: { tokenHash: input.refreshTokenHash, expiresAt: input.idleExpiresAt },
            },
          },
        });
        return Object.freeze({ sessionId: session.id, accountId: session.accountId });
      });
    },

    rotateRefresh(input) {
      return rotateWithRetry(prisma, input);
    },

    async revokeSession(input) {
      return prisma.$transaction(async (transaction) => {
        const sessions = await transaction.session.findMany({
          where: {
            id: input.sessionId,
            ...(input.accountId === undefined ? {} : { accountId: input.accountId }),
          },
          select: { id: true, status: true },
        });
        const session = sessions[0];
        if (session === undefined) {
          return false;
        }
        if (session.status !== 'ACTIVE') {
          return true;
        }
        await revokeSessions(transaction, [session.id], input.reason, input.now);
        return true;
      });
    },

    async revokeAllSessions(input) {
      return prisma.$transaction(async (transaction) => {
        const sessions = await transaction.session.findMany({
          where: { accountId: input.accountId, status: 'ACTIVE' },
          select: { id: true },
        });
        const ids = sessions.map(({ id }) => id);
        await revokeSessions(transaction, ids, input.reason, input.now);
        return ids.length;
      });
    },

    async listSessions(accountId, input) {
      const sessions = await prisma.session.findMany({
        where: { accountId },
        orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
        take: input.limit + 1,
        ...(input.cursor === undefined ? {} : { cursor: { id: input.cursor }, skip: 1 }),
        select: {
          id: true,
          clientKind: true,
          status: true,
          createdAt: true,
          lastSeenAt: true,
          idleExpiresAt: true,
          absoluteExpiresAt: true,
        },
      });
      const hasNextPage = sessions.length > input.limit;
      const page = sessions.slice(0, input.limit);
      return Object.freeze({
        sessions: Object.freeze(
          page.map((session) =>
            Object.freeze({
              sessionId: session.id,
              clientKind: session.clientKind,
              status: session.status,
              createdAt: session.createdAt,
              lastSeenAt: session.lastSeenAt,
              idleExpiresAt: session.idleExpiresAt,
              absoluteExpiresAt: session.absoluteExpiresAt,
            }),
          ),
        ),
        nextCursor: hasNextPage ? page.at(-1)!.id : null,
      });
    },

    findActorByAccessTokenHash(tokenHash) {
      return readAccessCredential(prisma, prisma, tokenHash);
    },
  };
}

async function rotateWithRetry(
  prisma: PrismaClient,
  input: RotateRefreshInput,
): Promise<RefreshRotationOutcome> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction((transaction) => rotateInTransaction(transaction, input), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error: unknown) {
      if (!isRetryableTransactionError(error) || attempt === 2) {
        throw error;
      }
    }
  }
  return { outcome: 'INVALID' };
}

async function rotateInTransaction(
  transaction: Prisma.TransactionClient,
  input: RotateRefreshInput,
): Promise<RefreshRotationOutcome> {
  const credential = await transaction.refreshCredential.findUnique({
    where: { tokenHash: input.presentedTokenHash },
    include: { session: { include: { account: { select: { status: true } } } } },
  });
  if (credential === null) {
    return { outcome: 'INVALID' };
  }
  if (credential.status === 'CONSUMED') {
    await compromiseSession(transaction, credential.sessionId, input.now);
    return {
      outcome: 'REPLAYED',
      accountId: credential.session.accountId,
      sessionId: credential.sessionId,
    };
  }
  if (
    credential.status !== 'ACTIVE' ||
    credential.expiresAt.getTime() <= input.now.getTime() ||
    credential.session.status !== 'ACTIVE' ||
    credential.session.account.status !== 'ACTIVE' ||
    credential.session.idleExpiresAt.getTime() <= input.now.getTime() ||
    credential.session.absoluteExpiresAt.getTime() <= input.now.getTime()
  ) {
    return { outcome: 'INVALID' };
  }

  const consumed = await transaction.refreshCredential.updateMany({
    where: { id: credential.id, status: 'ACTIVE' },
    data: { status: 'CONSUMED', consumedAt: input.now },
  });
  if (consumed.count !== 1) {
    await compromiseSession(transaction, credential.sessionId, input.now);
    return {
      outcome: 'REPLAYED',
      accountId: credential.session.accountId,
      sessionId: credential.sessionId,
    };
  }

  const absoluteExpiresAt = credential.session.absoluteExpiresAt;
  const idleExpiresAt = earlierOf(input.requestedIdleExpiresAt, absoluteExpiresAt);
  const accessExpiresAt = earlierOf(input.requestedAccessExpiresAt, absoluteExpiresAt);
  await transaction.refreshCredential.create({
    data: {
      sessionId: credential.sessionId,
      predecessorId: credential.id,
      tokenHash: input.successorTokenHash,
      expiresAt: idleExpiresAt,
    },
  });
  await transaction.accessCredential.create({
    data: {
      sessionId: credential.sessionId,
      tokenHash: input.accessTokenHash,
      expiresAt: accessExpiresAt,
    },
  });
  await transaction.session.update({
    where: { id: credential.sessionId },
    data: { idleExpiresAt, lastSeenAt: input.now },
  });
  return {
    outcome: 'ROTATED',
    accountId: credential.session.accountId,
    sessionId: credential.sessionId,
    clientKind: credential.session.clientKind,
    accessExpiresAt,
    refreshExpiresAt: idleExpiresAt,
  };
}

async function compromiseSession(
  transaction: Prisma.TransactionClient,
  sessionId: string,
  now: Date,
): Promise<void> {
  await transaction.session.updateMany({
    where: { id: sessionId, status: 'ACTIVE' },
    data: {
      status: 'COMPROMISED',
      revokedAt: now,
      revocationReason: 'refresh-reuse',
    },
  });
  await transaction.accessCredential.updateMany({
    where: { sessionId, status: 'ACTIVE' },
    data: { status: 'REVOKED', revokedAt: now },
  });
  await transaction.refreshCredential.updateMany({
    where: { sessionId, status: 'ACTIVE' },
    data: { status: 'REVOKED', revokedAt: now },
  });
}

async function revokeSessions(
  transaction: Prisma.TransactionClient,
  sessionIds: readonly string[],
  reason: string,
  now: Date,
): Promise<void> {
  if (sessionIds.length === 0) {
    return;
  }
  await transaction.session.updateMany({
    where: { id: { in: [...sessionIds] }, status: 'ACTIVE' },
    data: { status: 'REVOKED', revokedAt: now, revocationReason: reason },
  });
  await Promise.all([
    transaction.accessCredential.updateMany({
      where: { sessionId: { in: [...sessionIds] }, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: now },
    }),
    transaction.refreshCredential.updateMany({
      where: { sessionId: { in: [...sessionIds] }, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: now },
    }),
  ]);
}

function earlierOf(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime() ? left : right;
}

function isRetryableTransactionError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}
