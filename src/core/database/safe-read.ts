import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { RequestTimeoutError } from '../errors/app-error.js';
import { currentRequestDeadline, remainingReadTime } from '../http/request-deadline.js';

/** Explicit enrollment only: callback submits ONE pure database read, no provider
 * calls or nested transactions. Never wrap lazy-initializing GETs or money flows.
 * PostgreSQL statement_timeout stops active server work; a Promise race cannot.
 * Disconnect prevents subsequent work; active SQL retains its bounded deadline.
 * Off by default until pooler compatibility and added round trips are measured. */
export async function safeReadQuery<T>(
  prisma: PrismaClient,
  read: (client: Prisma.TransactionClient) => Promise<T>,
  enabled = process.env.DB_SAFE_READ_DEADLINE_ENABLED === 'true',
): Promise<T> {
  const deadline = currentRequestDeadline();
  if (!enabled || deadline === undefined) return read(prisma);
  const budget = remainingReadTime(deadline);
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        remainingReadTime(deadline);
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const milliseconds = String(remainingReadTime(deadline));
        await tx.$queryRaw`SELECT set_config('statement_timeout', ${milliseconds}, true)`;
        remainingReadTime(deadline);
        return read(tx);
      },
      { maxWait: Math.min(budget, 2000), timeout: budget },
    );
    remainingReadTime(deadline);
    return result;
  } catch (error) {
    // Do not classify mutation/provider outcomes from an HTTP timer.
    if (deadline.signal.aborted || Math.floor(deadline.expiresAt - performance.now()) < 1)
      throw new RequestTimeoutError();
    throw error;
  }
}
