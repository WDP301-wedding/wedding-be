import { createHash } from 'node:crypto';
import { withIdempotencyExecution } from '../../../core/database/idempotency-execution.js';
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
import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';

export type BillingHttpResult = Readonly<{ status: number; body: IdempotencyJsonValue }>;
export function createBillingHttpIdempotency(prisma: PrismaClient) {
  const repository = createPrismaIdempotencyRepository(prisma);
  const service = createIdempotencyService({
    ...repository,
    claim(input) {
      // For billing only, epoch means an unowned execution lease. The immutable
      // request hash and lifetime retention are independent of this timestamp.
      return repository.claim({ ...input, lockedAt: new Date(0) });
    },
  });
  return Object.freeze({
    async run(
      input: Readonly<{ actorAccountId: string; route: string; key: string; payload: unknown }>,
      work: (commandId: string) => Promise<BillingHttpResult>,
    ): Promise<BillingHttpResult> {
      const namespace = createIdempotencyNamespace({
        actorScope: input.actorAccountId,
        method: 'POST',
        normalizedRoute: input.route,
        operationVersion: 'v1',
      });
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

      // Never retain a connection while an owner command uses this same pool.
      // A crashed process can be recovered after five minutes. Truncate to
      // milliseconds so Prisma Date values exactly fence subsequent writes.
      const [lease] = await prisma.$queryRaw<{ lockedAt: Date }[]>`
        UPDATE "IdempotencyRecord"
        SET "lockedAt" = date_trunc('milliseconds', clock_timestamp()),
            "updatedAt" = clock_timestamp()
        WHERE "id" = ${claim.record.id}::uuid AND "status" = 'IN_PROGRESS'
          AND "lockedAt" <= clock_timestamp() - interval '5 minutes'
        RETURNING "lockedAt"`;
      if (lease === undefined) throw new RequestInProgressError(1);
      const ownerService = createIdempotencyService({
        ...repository,
        async transition(transition) {
          const { id, ...data } = transition;
          try {
            const record = await prisma.idempotencyRecord.update({
              where: { id, status: 'IN_PROGRESS', lockedAt: lease.lockedAt },
              data: { ...data, responseBody: data.responseBody ?? Prisma.DbNull },
            });
            return { ...record, responseBody: record.responseBody as IdempotencyJsonValue };
          } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025')
              throw new RequestInProgressError(1);
            throw error;
          }
        },
      });
      const hash = createHash('sha256').update(`${namespace}\0${input.key}`).digest('hex');
      const commandId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
      let terminal = false;
      try {
        const result = await withIdempotencyExecution(
          { recordId: claim.record.id, lockedAt: lease.lockedAt },
          () => work(commandId),
        );
        await ownerService.markSucceeded({
          claimId: claim.record.id,
          responseStatus: result.status,
          responseBody: result.body,
        });
        terminal = true;
        return result;
      } catch (error) {
        if (error instanceof AppError && error.status >= 400 && error.status < 500) {
          await ownerService.markFailed({
            claimId: claim.record.id,
            responseStatus: error.status,
            responseBody: { code: error.code, message: error.message },
          });
          terminal = true;
        }
        throw error;
      } finally {
        if (!terminal)
          await prisma.idempotencyRecord.updateMany({
            where: { id: claim.record.id, status: 'IN_PROGRESS', lockedAt: lease.lockedAt },
            data: { lockedAt: new Date(0) },
          });
      }
    },
  });
}
