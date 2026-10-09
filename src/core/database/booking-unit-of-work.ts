import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { AppError } from '../errors/app-error.js';
import { enlistedPrismaClient } from './enlisted-prisma-client.js';

type Context = Readonly<{
  requestId: string;
  causationId: string;
  actorAccountId: string | null;
  authority: 'AUTHENTICATED' | 'SYSTEM';
  transactionScopeId?: string;
}>;

export interface BookingBoundaryUnitOfWork {
  run<T>(
    input: Readonly<{ bookingId: string; context: Context }>,
    work: (scopedContext: Context) => Promise<T>,
  ): Promise<T>;
}

type Scope = {
  bookingId: string;
  context: Context;
  client: PrismaClient;
  active: boolean;
};

// Only infrastructure receives the enlisted client; consumers receive an opaque context.
export function createBookingBoundaryUnitOfWork(prisma: PrismaClient) {
  const storage = new AsyncLocalStorage<Scope>();
  const invalidScope = () =>
    new AppError({
      status: 409,
      code: 'INVALID_TRANSACTION_SCOPE',
      message: 'The booking transaction scope is invalid or has expired.',
    });

  const boundary: BookingBoundaryUnitOfWork = Object.freeze({
    run<T>(
      input: Readonly<{ bookingId: string; context: Context }>,
      work: (scopedContext: Context) => Promise<T>,
    ) {
      if (storage.getStore() !== undefined || input.context.transactionScopeId !== undefined) {
        throw invalidScope();
      }
      return prisma.$transaction(
        async (transaction) => {
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.bookingId}))`;
          const context = Object.freeze({ ...input.context, transactionScopeId: randomUUID() });
          // Owner repositories use interactive transactions. Enlist those callbacks rather
          // than starting independent transactions that could commit before the boundary.
          const client = enlistedPrismaClient(transaction);
          const scope: Scope = { bookingId: input.bookingId, context, client, active: true };
          return storage.run(scope, async () => {
            try {
              return await work(context);
            } finally {
              scope.active = false;
            }
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    },
  });

  return Object.freeze({
    boundary,
    withClient<T>(
      bookingId: string,
      context: Context | undefined,
      work: (client: PrismaClient) => Promise<T>,
    ): Promise<T> {
      const scope = storage.getStore();
      if (scope === undefined) {
        if (context?.transactionScopeId !== undefined) throw invalidScope();
        return work(prisma);
      }
      if (
        !scope.active ||
        scope.bookingId !== bookingId ||
        (context !== undefined && context !== scope.context)
      ) {
        throw invalidScope();
      }
      return work(scope.client);
    },
  });
}
