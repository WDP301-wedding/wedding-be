import { randomUUID } from 'node:crypto';

import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import type { AccountAuthenticationRecord } from '../account/account.repository.js';
import type { ScryptPasswordVerifier } from '../crypto/password.js';

export type PersistInvitationInput = Readonly<{
  invitationIntentId?: string;
  consultationId: string;
  recipientEmailNormalized: string;
  issuedByAccountId: string;
  tokenHash: string;
  expiresAt: Date;
  now: Date;
  requestId: string;
  reissueLimit: number;
  reissueWindowSeconds: number;
}>;

export type RevokeInvitationInput = Readonly<{
  invitationId: string;
  actorAccountId: string;
  now: Date;
  requestId: string;
}>;

export interface WorkspaceInvitationRepository {
  issue(input: PersistInvitationInput): Promise<PersistedWorkspaceInvitation>;
  reissue(input: PersistInvitationInput): Promise<PersistedWorkspaceInvitation>;
  revoke(input: RevokeInvitationInput): Promise<boolean>;
}

export type PersistedWorkspaceInvitation = Readonly<{
  invitationId: string;
  sequence: number;
  accepted?: boolean;
  expiresAt?: Date;
  deliveryIntentId?: string;
}>;

export type InvitationAcceptancePreview = Readonly<{
  invitationId: string;
  consultationId: string;
  recipientEmailNormalized: string;
  displayEmail: string;
  account:
    | (Pick<AccountAuthenticationRecord, 'accountId' | 'status' | 'passwordVerifier'> &
        Readonly<{ passwordUpdatedAt: Date }>)
    | null;
}>;

export type AcceptInvitationInput = Readonly<{
  invitationTokenHash: string;
  expectedAccountId: string | null;
  expectedPasswordUpdatedAt: Date | null;
  newAccountPasswordVerifier: ScryptPasswordVerifier | null;
  accessTokenHash: string;
  refreshTokenHash: string;
  accessExpiresAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  now: Date;
  requestId: string;
}>;

export type AcceptedInvitation = Readonly<{
  account: Readonly<{
    accountId: string;
    displayEmail: string;
    roles: readonly ('MANAGER' | 'STAFF' | 'COUPLE')[];
  }>;
  consultationAccessId: string;
  sessionId: string;
}>;

export interface WorkspaceInvitationAcceptanceRepository {
  previewAcceptance(
    invitationTokenHash: string,
    now: Date,
  ): Promise<InvitationAcceptancePreview | null>;
  accept(input: AcceptInvitationInput): Promise<AcceptedInvitation | null>;
}

export class ActiveInvitationExistsError extends Error {
  override readonly name = 'ActiveInvitationExistsError';
  constructor() {
    super('An active invitation already exists for this consultation and recipient.');
  }
}

export class InvitationNotFoundError extends Error {
  override readonly name = 'InvitationNotFoundError';
  constructor() {
    super('The active invitation was not found.');
  }
}

export class InvitationReissueLimitError extends Error {
  override readonly name = 'InvitationReissueLimitError';
  constructor() {
    super('The invitation reissue limit has been reached.');
  }
}

export function createPrismaWorkspaceInvitationRepository(
  prisma: PrismaClient,
): WorkspaceInvitationRepository & WorkspaceInvitationAcceptanceRepository {
  return Object.freeze({
    issue(input: PersistInvitationInput) {
      return invitationTransaction(prisma, input, 'issue');
    },
    reissue(input: PersistInvitationInput) {
      return invitationTransaction(prisma, input, 'reissue');
    },
    async revoke(input: RevokeInvitationInput) {
      return prisma.$transaction(async (transaction) => {
        const invitation = await transaction.workspaceInvitation.findUnique({
          where: { id: input.invitationId },
          select: { id: true, status: true },
        });
        if (invitation === null) {
          return false;
        }
        if (invitation.status === 'REVOKED') {
          return true;
        }
        if (invitation.status !== 'ACTIVE') {
          return false;
        }
        const updated = await transaction.workspaceInvitation.updateMany({
          where: { id: invitation.id, status: 'ACTIVE' },
          data: { status: 'REVOKED', revokedAt: input.now },
        });
        if (updated.count !== 1) {
          return false;
        }
        await appendAudit(transaction, {
          requestId: input.requestId,
          actorAccountId: input.actorAccountId,
          action: 'workspace-invitation.revoked',
          entityId: invitation.id,
          metadata: { terminalReason: 'revoked' },
        });
        return true;
      });
    },
    async previewAcceptance(invitationTokenHash: string, now: Date) {
      const invitation = await prisma.workspaceInvitation.findUnique({
        where: { tokenHash: invitationTokenHash },
        select: {
          id: true,
          consultationId: true,
          recipientEmailNormalized: true,
          status: true,
          expiresAt: true,
        },
      });
      if (
        invitation === null ||
        invitation.status !== 'ACTIVE' ||
        invitation.expiresAt.getTime() <= now.getTime()
      ) {
        return null;
      }
      const account = await prisma.account.findUnique({
        where: { emailNormalized: invitation.recipientEmailNormalized },
        include: { passwordCredential: true },
      });
      return Object.freeze({
        invitationId: invitation.id,
        consultationId: invitation.consultationId,
        recipientEmailNormalized: invitation.recipientEmailNormalized,
        displayEmail: account?.displayEmail ?? invitation.recipientEmailNormalized,
        account:
          account?.passwordCredential === undefined || account.passwordCredential === null
            ? account === null
              ? null
              : Object.freeze({
                  accountId: account.id,
                  status: account.status,
                  passwordVerifier: null,
                  passwordUpdatedAt: account.updatedAt,
                })
            : Object.freeze({
                accountId: account.id,
                status: account.status,
                passwordVerifier: toPasswordVerifier(account.passwordCredential),
                passwordUpdatedAt: account.passwordCredential.updatedAt,
              }),
      });
    },
    accept(input: AcceptInvitationInput) {
      return acceptWithRetry(prisma, input);
    },
  });
}

async function acceptWithRetry(
  prisma: PrismaClient,
  input: AcceptInvitationInput,
): Promise<AcceptedInvitation | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (transaction) => {
          const initial = await transaction.workspaceInvitation.findUnique({
            where: { tokenHash: input.invitationTokenHash },
            select: { consultationId: true, recipientEmailNormalized: true },
          });
          if (initial === null) return null;

          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${initial.consultationId}:${initial.recipientEmailNormalized}`}))`;
          const invitation = await transaction.workspaceInvitation.findUnique({
            where: { tokenHash: input.invitationTokenHash },
            select: {
              id: true,
              consultationId: true,
              recipientEmailNormalized: true,
              status: true,
              expiresAt: true,
            },
          });
          if (
            invitation === null ||
            invitation.status !== 'ACTIVE' ||
            invitation.expiresAt.getTime() <= input.now.getTime()
          ) {
            if (invitation?.status === 'ACTIVE') {
              await transaction.workspaceInvitation.updateMany({
                where: { id: invitation.id, status: 'ACTIVE' },
                data: { status: 'EXPIRED', expiredAt: input.now },
              });
            }
            return null;
          }

          const currentAccount = await transaction.account.findUnique({
            where: { emailNormalized: invitation.recipientEmailNormalized },
            include: {
              passwordCredential: true,
              roles: { select: { role: true } },
            },
          });
          const account = await resolveAcceptanceAccount(transaction, {
            currentAccount,
            invitation,
            input,
          });
          if (account === null) return null;

          const access = await transaction.consultationAccess.upsert({
            where: {
              accountId_consultationId: {
                accountId: account.id,
                consultationId: invitation.consultationId,
              },
            },
            create: {
              accountId: account.id,
              consultationId: invitation.consultationId,
              level: 'RESTRICTED',
            },
            update: {},
            select: { id: true },
          });
          const session = await transaction.session.create({
            data: {
              accountId: account.id,
              clientKind: 'WEB',
              refreshFamilyId: randomUUID(),
              idleExpiresAt: input.idleExpiresAt,
              absoluteExpiresAt: input.absoluteExpiresAt,
              lastSeenAt: input.now,
              createdAt: input.now,
              accessCredentials: {
                create: {
                  tokenHash: input.accessTokenHash,
                  expiresAt: input.accessExpiresAt,
                  createdAt: input.now,
                },
              },
              refreshCredentials: {
                create: {
                  tokenHash: input.refreshTokenHash,
                  expiresAt: input.idleExpiresAt,
                  createdAt: input.now,
                },
              },
            },
            select: { id: true },
          });
          const consumed = await transaction.workspaceInvitation.updateMany({
            where: { id: invitation.id, status: 'ACTIVE', expiresAt: { gt: input.now } },
            data: {
              status: 'ACCEPTED',
              acceptedAt: input.now,
              resolvedAccountId: account.id,
            },
          });
          if (consumed.count !== 1) throw new InvitationAcceptanceConflictError();

          await appendAudit(transaction, {
            requestId: input.requestId,
            actorAccountId: account.id,
            action: 'workspace-invitation.accepted',
            entityId: invitation.id,
            metadata: { createdAccount: currentAccount === null },
          });
          return Object.freeze({
            account: Object.freeze({
              accountId: account.id,
              displayEmail: account.displayEmail,
              roles: Object.freeze(account.roles.map(({ role }) => role)),
            }),
            consultationAccessId: access.id,
            sessionId: session.id,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error: unknown) {
      if (error instanceof InvitationAcceptanceConflictError) return null;
      if ((isRetryableTransactionError(error) || isActiveConstraint(error)) && attempt < 2) {
        continue;
      }
      if (isActiveConstraint(error)) return null;
      throw error;
    }
  }
  return null;
}

class InvitationAcceptanceConflictError extends Error {}

async function resolveAcceptanceAccount(
  transaction: Prisma.TransactionClient,
  context: Readonly<{
    currentAccount: AcceptanceAccountRow | null;
    invitation: Readonly<{
      recipientEmailNormalized: string;
    }>;
    input: AcceptInvitationInput;
  }>,
) {
  const { currentAccount, input, invitation } = context;
  if (input.expectedAccountId === null) {
    if (currentAccount !== null || input.newAccountPasswordVerifier === null) return null;
    return transaction.account.create({
      data: {
        emailNormalized: invitation.recipientEmailNormalized,
        displayEmail: invitation.recipientEmailNormalized,
        passwordCredential: {
          create: passwordVerifierData(input.newAccountPasswordVerifier),
        },
      },
      include: { roles: { select: { role: true } } },
    });
  }
  if (
    currentAccount === null ||
    currentAccount.id !== input.expectedAccountId ||
    currentAccount.status !== 'ACTIVE' ||
    currentAccount.passwordCredential === null ||
    input.expectedPasswordUpdatedAt === null ||
    currentAccount.passwordCredential.updatedAt.getTime() !==
      input.expectedPasswordUpdatedAt.getTime() ||
    input.newAccountPasswordVerifier !== null
  ) {
    return null;
  }
  return currentAccount;
}

type AcceptanceAccountRow = Readonly<{
  id: string;
  displayEmail: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
  passwordCredential: (Readonly<{ updatedAt: Date }> & PasswordCredentialRow) | null;
  roles: readonly Readonly<{ role: 'MANAGER' | 'STAFF' | 'COUPLE' }>[];
}>;

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

async function invitationTransaction(
  prisma: PrismaClient,
  input: PersistInvitationInput,
  operation: 'issue' | 'reissue',
): Promise<PersistedWorkspaceInvitation> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (transaction) => {
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.consultationId}:${input.recipientEmailNormalized}`}))`;
          const invitations = await transaction.workspaceInvitation.findMany({
            where: {
              consultationId: input.consultationId,
              recipientEmailNormalized: input.recipientEmailNormalized,
            },
            orderBy: { sequence: 'desc' },
            select: { id: true, sequence: true, status: true, expiresAt: true, createdAt: true },
          });
          const priorIntent =
            input.invitationIntentId === undefined
              ? undefined
              : invitations.find((invitation) => invitation.id === input.invitationIntentId);
          if (operation === 'issue' && priorIntent !== undefined) {
            if (priorIntent.status === 'ACCEPTED') {
              return Object.freeze({
                invitationId: priorIntent.id,
                sequence: priorIntent.sequence,
                accepted: true,
                expiresAt: priorIntent.expiresAt,
              });
            }
            if (
              priorIntent.status !== 'ACTIVE' ||
              priorIntent.expiresAt.getTime() <= input.now.getTime()
            ) {
              throw new InvitationNotFoundError();
            }
            // Retry a persisted issuance whose notification or caller acknowledgment failed.
            // Only the hash is stored; a fresh token replaces the unacknowledged credential.
            const deliveryIntentId = randomUUID();
            await transaction.workspaceInvitation.update({
              where: { id: priorIntent.id },
              data: { tokenHash: input.tokenHash, deliveryIntentId },
            });
            await appendAudit(transaction, {
              requestId: input.requestId,
              actorAccountId: input.issuedByAccountId,
              action: 'workspace-invitation.delivery-retried',
              entityId: priorIntent.id,
              metadata: { sequence: priorIntent.sequence },
            });
            return Object.freeze({
              invitationId: priorIntent.id,
              sequence: priorIntent.sequence,
              expiresAt: priorIntent.expiresAt,
              deliveryIntentId,
            });
          }
          let active = invitations.find(({ status }) => status === 'ACTIVE');
          if (active !== undefined && active.expiresAt.getTime() <= input.now.getTime()) {
            await transaction.workspaceInvitation.updateMany({
              where: { id: active.id, status: 'ACTIVE' },
              data: { status: 'EXPIRED', expiredAt: input.now },
            });
            active = undefined;
          }

          if (operation === 'issue' && active !== undefined) {
            throw new ActiveInvitationExistsError();
          }
          if (operation === 'reissue' && active === undefined) {
            throw new InvitationNotFoundError();
          }
          if (operation === 'reissue') {
            const windowStart = new Date(input.now.getTime() - input.reissueWindowSeconds * 1_000);
            const recentInvitationIds = invitations
              .filter(({ createdAt }) => createdAt.getTime() > windowStart.getTime())
              .map(({ id }) => id);
            const reissuesInWindow =
              recentInvitationIds.length === 0
                ? 0
                : await transaction.auditLog.count({
                    where: {
                      action: 'workspace-invitation.reissued',
                      entityId: { in: recentInvitationIds },
                    },
                  });
            if (reissuesInWindow >= input.reissueLimit) {
              throw new InvitationReissueLimitError();
            }
            await transaction.workspaceInvitation.updateMany({
              where: { id: active!.id, status: 'ACTIVE' },
              data: { status: 'SUPERSEDED', supersededAt: input.now },
            });
          }

          const sequence = (invitations[0]?.sequence ?? 0) + 1;
          const resolvedAccount = await transaction.account.findUnique({
            where: { emailNormalized: input.recipientEmailNormalized },
            select: { id: true },
          });
          const invitation = await transaction.workspaceInvitation.create({
            data: {
              ...(input.invitationIntentId === undefined ? {} : { id: input.invitationIntentId }),
              consultationId: input.consultationId,
              recipientEmailNormalized: input.recipientEmailNormalized,
              resolvedAccountId: resolvedAccount?.id ?? null,
              issuedByAccountId: input.issuedByAccountId,
              sequence,
              tokenHash: input.tokenHash,
              expiresAt: input.expiresAt,
              createdAt: input.now,
            },
            select: { id: true, deliveryIntentId: true },
          });
          await appendAudit(transaction, {
            requestId: input.requestId,
            actorAccountId: input.issuedByAccountId,
            action: `workspace-invitation.${operation === 'issue' ? 'issued' : 'reissued'}`,
            entityId: invitation.id,
            metadata: { sequence },
          });
          return Object.freeze({
            invitationId: invitation.id,
            sequence,
            deliveryIntentId: invitation.deliveryIntentId,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error: unknown) {
      if (isDomainError(error)) {
        throw error;
      }
      if (isActiveConstraint(error)) {
        throw new ActiveInvitationExistsError();
      }
      if (!isRetryableTransactionError(error) || attempt === 2) {
        throw error;
      }
    }
  }
  throw new Error('Invitation transaction exhausted retries.');
}

async function appendAudit(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    requestId: string;
    actorAccountId: string;
    action: string;
    entityId: string;
    metadata: Prisma.InputJsonObject;
  }>,
): Promise<void> {
  await transaction.auditLog.create({
    data: {
      requestId: input.requestId,
      actorType: 'USER',
      actorId: input.actorAccountId,
      action: input.action,
      entityType: 'workspace-invitation',
      entityId: input.entityId,
      metadata: input.metadata,
    },
  });
}

function isDomainError(error: unknown): boolean {
  return (
    error instanceof ActiveInvitationExistsError ||
    error instanceof InvitationNotFoundError ||
    error instanceof InvitationReissueLimitError
  );
}

function isActiveConstraint(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function isRetryableTransactionError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
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

function toPasswordVerifier(record: PasswordCredentialRow): ScryptPasswordVerifier | null {
  if (record.algorithm !== 'scrypt' || record.version !== 1) return null;
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
