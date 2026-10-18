import { AsyncLocalStorage } from 'node:async_hooks';

import type { Prisma } from '../../generated/prisma/client.js';
import { RequestInProgressError } from '../errors/app-error.js';

type ExecutionLease = Readonly<{ recordId: string; lockedAt: Date }>;
const execution = new AsyncLocalStorage<ExecutionLease>();

export function withIdempotencyExecution<T>(lease: ExecutionLease, work: () => Promise<T>) {
  return execution.run(lease, work);
}

/** Fence owner writes in their own transaction, without borrowing another connection. */
export async function lockIdempotencyExecution(transaction: Prisma.TransactionClient) {
  const lease = execution.getStore();
  if (lease === undefined) return;
  // Takeover waits for an already executing owner to commit. Conversely, an old
  // worker that resumes after takeover cannot enter a new money transaction.
  const rows = await transaction.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "IdempotencyRecord"
    WHERE "id" = ${lease.recordId}::uuid AND "status" = 'IN_PROGRESS'
      AND "lockedAt" = ${lease.lockedAt}
    FOR UPDATE`;
  if (rows.length !== 1) throw new RequestInProgressError(1);
}
