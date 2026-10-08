import { randomUUID } from 'node:crypto';

import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';

export type IdentityRetentionDays = Readonly<{
  invitation: number;
  passwordReset: number;
  session: number;
  disabledAccountPii: number;
}>;

export type IdentityRetentionBatchInput = Readonly<{
  batchSize: number;
  now: Date;
  requestId: string;
  retentionDays: IdentityRetentionDays;
}>;

export type IdentityRetentionBatchResult = Readonly<{
  anonymizedAccounts: number;
  deletedInvitations: number;
  deletedPasswordResets: number;
  deletedSessions: number;
}>;

export interface IdentityRetentionRepository {
  runBatch(input: IdentityRetentionBatchInput): Promise<IdentityRetentionBatchResult>;
}

const approvedRetentionDays: IdentityRetentionDays = Object.freeze({
  invitation: 180,
  passwordReset: 30,
  session: 90,
  disabledAccountPii: 365,
});

export function createIdentityRetentionService(
  options: Readonly<{
    repository: IdentityRetentionRepository;
    retentionDays: IdentityRetentionDays;
    now?: () => Date;
    requestId?: () => string;
  }>,
) {
  const retentionDays = validateRetentionDays(options.retentionDays);
  const now = options.now ?? (() => new Date());
  const requestId = options.requestId ?? randomUUID;

  return Object.freeze({
    async run(input: Readonly<{ batchSize?: number }> = {}): Promise<IdentityRetentionBatchResult> {
      const batchSize = input.batchSize ?? 100;
      if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
        throw new RangeError('Identity retention batch size must be an integer from 1 to 1000.');
      }

      const runAt = now();
      if (!Number.isFinite(runAt.getTime())) {
        throw new RangeError('Identity retention requires a valid clock value.');
      }

      return options.repository.runBatch({
        batchSize,
        now: runAt,
        requestId: requestId(),
        retentionDays,
      });
    },
  });
}

export function createPrismaIdentityRetentionRepository(
  prisma: PrismaClient,
  options: Readonly<{ schema?: string }> = {},
): IdentityRetentionRepository {
  const schema = validateSchemaName(options.schema ?? 'public');
  const accountTable = Prisma.raw(`"${schema}"."Account"`);
  const accessTable = Prisma.raw(`"${schema}"."ConsultationAccess"`);
  const retentionFactTable = Prisma.raw(`"${schema}"."AccountRetentionEligibilityFact"`);
  const invitationTable = Prisma.raw(`"${schema}"."WorkspaceInvitation"`);
  const passwordResetTable = Prisma.raw(`"${schema}"."PasswordResetCredential"`);
  const sessionTable = Prisma.raw(`"${schema}"."Session"`);

  return {
    runBatch(input) {
      const invitationCutoff = subtractDays(input.now, input.retentionDays.invitation);
      const passwordResetCutoff = subtractDays(input.now, input.retentionDays.passwordReset);
      const sessionCutoff = subtractDays(input.now, input.retentionDays.session);

      return prisma.$transaction(async (transaction) => {
        const candidates = await transaction.$queryRaw<
          readonly Readonly<{ id: string; emailNormalized: string }>[]
        >(Prisma.sql`
            SELECT account."id", account."emailNormalized"
            FROM ${accountTable} AS account
            WHERE account."status" = 'DISABLED'
              AND account."piiRetentionEligibleAt" <= ${input.now}
              AND account."piiAnonymizedAt" IS NULL
              AND (account."legalHoldUntil" IS NULL OR account."legalHoldUntil" <= ${input.now})
              AND EXISTS (
                SELECT 1
                FROM ${accessTable} AS access
                WHERE access."accountId" = account."id"
              )
              AND NOT EXISTS (
                SELECT 1
                FROM ${accessTable} AS access
                LEFT JOIN ${retentionFactTable} AS fact
                  ON fact."accountId" = access."accountId"
                 AND fact."consultationId" = access."consultationId"
                WHERE access."accountId" = account."id"
                  AND fact."id" IS NULL
              )
            ORDER BY account."piiRetentionEligibleAt", account."id"
            FOR UPDATE SKIP LOCKED
            LIMIT ${input.batchSize}
          `);

        let anonymizedAccounts = 0;
        for (const account of candidates) {
          if (await anonymizeAccount(transaction, account, input)) {
            anonymizedAccounts += 1;
          }
        }

        const deletedInvitations = await deleteTerminalMetadataBatch(
          transaction,
          invitationTable,
          Prisma.sql`
            ("status" = 'ACCEPTED' AND "acceptedAt" <= ${invitationCutoff})
            OR ("status" = 'REVOKED' AND "revokedAt" <= ${invitationCutoff})
            OR ("status" = 'SUPERSEDED' AND "supersededAt" <= ${invitationCutoff})
            OR ("status" = 'EXPIRED' AND "expiredAt" <= ${invitationCutoff})
          `,
          input.batchSize,
        );
        const deletedPasswordResets = await deleteTerminalMetadataBatch(
          transaction,
          passwordResetTable,
          Prisma.sql`
            ("status" = 'CONSUMED' AND "consumedAt" <= ${passwordResetCutoff})
            OR ("status" = 'REVOKED' AND "revokedAt" <= ${passwordResetCutoff})
            OR ("status" = 'EXPIRED' AND "expiredAt" <= ${passwordResetCutoff})
          `,
          input.batchSize,
        );
        const deletedSessions = await deleteTerminalMetadataBatch(
          transaction,
          sessionTable,
          Prisma.sql`
            ("status" IN ('REVOKED', 'COMPROMISED') AND "revokedAt" <= ${sessionCutoff})
            OR (
              "status" = 'EXPIRED'
              AND ("idleExpiresAt" <= ${sessionCutoff} OR "absoluteExpiresAt" <= ${sessionCutoff})
            )
          `,
          input.batchSize,
        );

        const result = Object.freeze({
          anonymizedAccounts,
          deletedInvitations,
          deletedPasswordResets,
          deletedSessions,
        });
        if (
          result.deletedInvitations > 0 ||
          result.deletedPasswordResets > 0 ||
          result.deletedSessions > 0
        ) {
          await transaction.auditLog.create({
            data: {
              requestId: input.requestId,
              actorType: 'SYSTEM',
              actorId: null,
              action: 'identity.retention-metadata.deleted',
              entityType: 'identity-retention',
              entityId: null,
              metadata: {
                deletedInvitations: result.deletedInvitations,
                deletedPasswordResets: result.deletedPasswordResets,
                deletedSessions: result.deletedSessions,
              },
            },
          });
        }
        return result;
      });
    },
  };
}

async function deleteTerminalMetadataBatch(
  transaction: Prisma.TransactionClient,
  table: Prisma.Sql,
  where: Prisma.Sql,
  batchSize: number,
): Promise<number> {
  const [result] = await transaction.$queryRaw<readonly Readonly<{ count: number }>[]>(Prisma.sql`
    WITH candidates AS (
      SELECT "id"
      FROM ${table}
      WHERE ${where}
      ORDER BY "id"
      FOR UPDATE SKIP LOCKED
      LIMIT ${batchSize}
    ), deleted AS (
      DELETE FROM ${table}
      WHERE "id" IN (SELECT "id" FROM candidates)
      RETURNING "id"
    )
    SELECT COUNT(*)::integer AS "count"
    FROM deleted
  `);
  return result?.count ?? 0;
}

async function anonymizeAccount(
  transaction: Prisma.TransactionClient,
  account: Readonly<{ id: string; emailNormalized: string }>,
  input: IdentityRetentionBatchInput,
): Promise<boolean> {
  const anonymizedEmail = `anonymized-${account.id}@identity.invalid`;
  const claimed = await transaction.account.updateMany({
    where: {
      id: account.id,
      status: 'DISABLED',
      piiRetentionEligibleAt: { lte: input.now },
      piiAnonymizedAt: null,
      OR: [{ legalHoldUntil: null }, { legalHoldUntil: { lte: input.now } }],
    },
    data: {
      emailNormalized: anonymizedEmail,
      displayEmail: 'anonymized@identity.invalid',
      displayName: null,
      piiAnonymizedAt: input.now,
    },
  });
  if (claimed.count === 0) {
    return false;
  }

  const sessionIds = (
    await transaction.session.findMany({
      where: { accountId: account.id, status: 'ACTIVE' },
      select: { id: true },
    })
  ).map(({ id }) => id);

  if (sessionIds.length > 0) {
    await Promise.all([
      transaction.accessCredential.updateMany({
        where: { sessionId: { in: sessionIds }, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: input.now },
      }),
      transaction.refreshCredential.updateMany({
        where: { sessionId: { in: sessionIds }, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: input.now },
      }),
    ]);
    await transaction.session.updateMany({
      where: { id: { in: sessionIds } },
      data: { status: 'REVOKED', revokedAt: input.now, revocationReason: 'PII_RETENTION' },
    });
  }

  await transaction.passwordResetCredential.updateMany({
    where: { accountId: account.id, status: 'ACTIVE' },
    data: { status: 'REVOKED', revokedAt: input.now },
  });
  await transaction.workspaceInvitation.updateMany({
    where: {
      OR: [
        { resolvedAccountId: account.id },
        { recipientEmailNormalized: account.emailNormalized },
      ],
      status: 'ACTIVE',
    },
    data: {
      recipientEmailNormalized: anonymizedEmail,
      status: 'REVOKED',
      revokedAt: input.now,
    },
  });
  await transaction.workspaceInvitation.updateMany({
    where: {
      OR: [
        { resolvedAccountId: account.id },
        { recipientEmailNormalized: account.emailNormalized },
      ],
      status: { not: 'ACTIVE' },
    },
    data: { recipientEmailNormalized: anonymizedEmail },
  });
  await transaction.passwordCredential.deleteMany({ where: { accountId: account.id } });
  await transaction.auditLog.create({
    data: {
      requestId: input.requestId,
      actorType: 'SYSTEM',
      actorId: null,
      action: 'account.pii.anonymized',
      entityType: 'account',
      entityId: account.id,
      metadata: { reasonCode: 'RETENTION_DUE' },
    },
  });
  return true;
}

function validateRetentionDays(candidate: IdentityRetentionDays): IdentityRetentionDays {
  for (const key of Object.keys(approvedRetentionDays) as (keyof IdentityRetentionDays)[]) {
    if (candidate[key] !== approvedRetentionDays[key]) {
      throw new RangeError(`Identity retention ${key} days must match the approved policy.`);
    }
  }
  return Object.freeze({ ...candidate });
}

function subtractDays(date: Date, days: number): Date {
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1_000);
}

function validateSchemaName(schema: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(schema)) {
    throw new RangeError('Identity retention database schema name is invalid.');
  }
  return schema;
}
