import { createHash } from 'node:crypto';
import {
  AppError,
  IdempotencyKeyReusedError,
  RequestInProgressError,
} from '../../../core/errors/app-error.js';
import {
  createPrismaIdempotencyRepository,
  type IdempotencyJsonValue,
} from '../../../core/idempotency/idempotency.repository.js';
import { createIdempotencyService } from '../../../core/idempotency/idempotency.service.js';
import { createIdempotencyNamespace } from '../../../core/idempotency/idempotency.policy.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';

export type BillingHttpResult = Readonly<{ status: number; body: IdempotencyJsonValue }>;
export function createBillingHttpIdempotency(prisma: PrismaClient) {
  const service = createIdempotencyService(createPrismaIdempotencyRepository(prisma));
  return Object.freeze({
    run(
      input: Readonly<{ actorAccountId: string; route: string; key: string; payload: unknown }>,
      work: (commandId: string) => Promise<BillingHttpResult>,
    ): Promise<BillingHttpResult> {
      const namespace = createIdempotencyNamespace({
        actorScope: input.actorAccountId,
        method: 'POST',
        normalizedRoute: input.route,
        operationVersion: 'v1',
      });
      // Separate two-int advisory namespace from the one-int booking locks. This
      // connection only holds a request mutex; owner money transactions commit
      // independently and are recoverable by the stable command identity below.
      const lockId = createHash('sha256')
        .update(`${namespace}\0${input.key}`)
        .digest()
        .readInt32BE(0);
      return prisma.$transaction(
        async (tx) => {
          const [lock] = await tx.$queryRaw<
            { acquired: boolean }[]
          >`SELECT pg_try_advisory_xact_lock(684006, ${lockId}) AS acquired`;
          if (lock?.acquired !== true) throw new RequestInProgressError(1);
          const claim = await service.claim({
            namespace,
            idempotencyKey: input.key,
            payload: input.payload,
            retentionMs: new Date('9999-12-31T00:00:00Z').getTime() - Date.now(),
          });
          if (claim.outcome === 'MISMATCH') throw new IdempotencyKeyReusedError();
          if (claim.record.status === 'FAILED') {
            const saved = claim.record.responseBody as { code: string; message: string };
            throw new AppError({
              status: claim.record.responseStatus!,
              code: saved.code,
              message: saved.message,
            });
          }
          if (claim.record.status === 'SUCCEEDED')
            return { status: claim.record.responseStatus!, body: claim.record.responseBody };
          const hash = createHash('sha256').update(`${namespace}\0${input.key}`).digest('hex');
          const commandId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
          try {
            const result = await work(commandId);
            await service.markSucceeded({
              claimId: claim.record.id,
              responseStatus: result.status,
              responseBody: result.body,
            });
            return result;
          } catch (error) {
            if (error instanceof AppError && error.status >= 400 && error.status < 500) {
              await service.markFailed({
                claimId: claim.record.id,
                responseStatus: error.status,
                responseBody: { code: error.code, message: error.message },
              });
            }
            throw error;
          }
        },
        { maxWait: 5000, timeout: 30000 },
      );
    },
  });
}
