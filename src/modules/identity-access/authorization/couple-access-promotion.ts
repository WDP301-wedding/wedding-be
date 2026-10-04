import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import { ConflictError, NotFoundError } from '../../../core/errors/app-error.js';

export type PromotionInput = Readonly<{
  accountId: string;
  consultationId: string;
  sourcePaymentId: string;
  requestId: string;
}>;

export type PromotionRepositoryOutcome =
  | Readonly<{ outcome: 'PROMOTED' | 'REPLAYED'; accessId: string }>
  | Readonly<{ outcome: 'CONFLICT' }>
  | Readonly<{ outcome: 'NOT_FOUND' }>;

export interface CoupleAccessPromotionRepository {
  promote(input: PromotionInput): Promise<PromotionRepositoryOutcome>;
}

export interface CoupleAccessPromoter {
  promote(
    input: PromotionInput,
  ): Promise<Readonly<{ level: 'FULL'; replayed: boolean; accessId: string }>>;
}

export function createCoupleAccessPromoter(
  repository: CoupleAccessPromotionRepository,
): CoupleAccessPromoter {
  return Object.freeze({
    async promote(input: PromotionInput) {
      const result = await repository.promote(input);
      if (result.outcome === 'CONFLICT') throw new ConflictError();
      if (result.outcome === 'NOT_FOUND') throw new NotFoundError();
      return Object.freeze({
        level: 'FULL' as const,
        replayed: result.outcome === 'REPLAYED',
        accessId: result.accessId,
      });
    },
  });
}

export function createPrismaCoupleAccessPromotionRepository(
  prisma: PrismaClient,
): CoupleAccessPromotionRepository {
  return Object.freeze({
    promote(input: PromotionInput) {
      return promoteWithRetry(prisma, input);
    },
  });
}

async function promoteWithRetry(
  prisma: PrismaClient,
  input: PromotionInput,
): Promise<PromotionRepositoryOutcome> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (transaction) => {
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.accountId}:${input.consultationId}`}))`;
          const paymentOwner = await transaction.consultationAccess.findUnique({
            where: { sourcePaymentId: input.sourcePaymentId },
            select: { id: true, accountId: true, consultationId: true },
          });
          if (paymentOwner !== null) {
            if (
              paymentOwner.accountId !== input.accountId ||
              paymentOwner.consultationId !== input.consultationId
            ) {
              await appendPromotionAudit(transaction, {
                requestId: input.requestId,
                action: 'consultation-access.promotion-conflict',
                entityId: paymentOwner.id,
                metadata: { reason: 'payment-source-reuse' },
              });
              return { outcome: 'CONFLICT' as const };
            }
            await upsertCoupleRole(transaction, input.accountId);
            return { outcome: 'REPLAYED' as const, accessId: paymentOwner.id };
          }

          const access = await transaction.consultationAccess.findUnique({
            where: {
              accountId_consultationId: {
                accountId: input.accountId,
                consultationId: input.consultationId,
              },
            },
            select: { id: true, level: true, sourcePaymentId: true },
          });
          if (access === null) return { outcome: 'NOT_FOUND' as const };
          if (access.level === 'FULL' || access.sourcePaymentId !== null) {
            await appendPromotionAudit(transaction, {
              requestId: input.requestId,
              action: 'consultation-access.promotion-conflict',
              entityId: access.id,
              metadata: { reason: 'promotion-evidence-mismatch' },
            });
            return { outcome: 'CONFLICT' as const };
          }

          const promoted = await transaction.consultationAccess.updateMany({
            where: { id: access.id, level: 'RESTRICTED', sourcePaymentId: null },
            data: { level: 'FULL', sourcePaymentId: input.sourcePaymentId, promotedAt: new Date() },
          });
          if (promoted.count !== 1) throw new PromotionRaceError();
          await upsertCoupleRole(transaction, input.accountId);
          await appendPromotionAudit(transaction, {
            requestId: input.requestId,
            action: 'consultation-access.promoted',
            entityId: access.id,
            metadata: { level: 'FULL' },
          });
          return { outcome: 'PROMOTED' as const, accessId: access.id };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error: unknown) {
      if (
        (isRetryableTransactionError(error) || error instanceof PromotionRaceError) &&
        attempt < 2
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error('Promotion transaction exhausted retries.');
}

async function upsertCoupleRole(
  transaction: Prisma.TransactionClient,
  accountId: string,
): Promise<void> {
  await transaction.accountRole.upsert({
    where: { accountId_role: { accountId, role: 'COUPLE' } },
    create: { accountId, role: 'COUPLE' },
    update: {},
  });
}

async function appendPromotionAudit(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    requestId: string;
    action: string;
    entityId: string;
    metadata: Prisma.InputJsonObject;
  }>,
): Promise<void> {
  await transaction.auditLog.create({
    data: {
      requestId: input.requestId,
      actorType: 'SYSTEM',
      action: input.action,
      entityType: 'consultation-access',
      entityId: input.entityId,
      metadata: input.metadata,
    },
  });
}

class PromotionRaceError extends Error {}

function isRetryableTransactionError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}
