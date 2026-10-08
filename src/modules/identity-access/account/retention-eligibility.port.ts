import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import { createPrismaAccountRepository, type AccountRepository } from './account.repository.js';

export interface AccountRetentionEligibilityRecorder {
  record(
    input: Readonly<{
      accountId: string;
      eligibleAfter: Date;
      sourceBusinessRecordId: string;
    }>,
  ): Promise<void>;
}

type RetentionContext = Readonly<{ requestId: string; actorAccountId: string | null }>;

export function createAccountRetentionEligibilityRecorder(
  repository: Pick<AccountRepository, 'recordRetentionEligibility'>,
  options: RetentionContext & Readonly<{ consultationId: string; retentionDays: number }>,
): AccountRetentionEligibilityRecorder {
  if (!Number.isSafeInteger(options.retentionDays) || options.retentionDays <= 0)
    throw new RangeError('Retention days must be a positive integer.');
  return Object.freeze({
    async record(input: Parameters<AccountRetentionEligibilityRecorder['record']>[0]) {
      if (!Number.isFinite(input.eligibleAfter.getTime()))
        throw new RangeError('Expected a valid date.');
      await repository.recordRetentionEligibility({
        ...input,
        consultationId: options.consultationId,
        piiEligibleAt: new Date(input.eligibleAfter.getTime() + options.retentionDays * 86400000),
        audit: {
          requestId: options.requestId,
          ...(options.actorAccountId === null ? {} : { actorAccountId: options.actorAccountId }),
        },
      });
    },
  });
}

export function createPrismaConsultationRetentionRecorder(
  prisma: PrismaClient | Prisma.TransactionClient,
  retentionDays: number,
) {
  return Object.freeze({
    async recordTerminal(
      input: Readonly<{
        consultationId: string;
        sourceBusinessRecordId: string;
        eligibleAfter: Date;
      }>,
      context: RetentionContext,
    ): Promise<void> {
      // Identity enumerates its own grants. The business owner supplies terminal evidence.
      const grants = await prisma.consultationAccess.findMany({
        where: { consultationId: input.consultationId },
        select: { accountId: true },
      });
      const recorder = createAccountRetentionEligibilityRecorder(
        createPrismaAccountRepository(prisma),
        { ...context, consultationId: input.consultationId, retentionDays },
      );
      for (const grant of grants) {
        await recorder.record({
          accountId: grant.accountId,
          sourceBusinessRecordId: input.sourceBusinessRecordId,
          eligibleAfter: input.eligibleAfter,
        });
      }
    },
  });
}
