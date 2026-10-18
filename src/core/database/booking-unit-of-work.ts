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
type BoundaryInput = Readonly<{ bookingId: string; context: Context }>;

export interface BookingBoundaryUnitOfWork {
  run<T>(input: BoundaryInput, work: (scopedContext: Context) => Promise<T>): Promise<T>;
}

type Scope = {
  bookingId: string;
  context: Context;
  client: PrismaClient;
  readOnly: boolean;
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

  function run<T>(
    input: BoundaryInput,
    work: (scopedContext: Context) => Promise<T>,
    readOnly = false,
  ): Promise<T> {
    if (storage.getStore() !== undefined || input.context.transactionScopeId !== undefined) {
      throw invalidScope();
    }
    return prisma.$transaction(
      async (transaction) => {
        if (readOnly) {
          await transaction.$executeRaw`SET TRANSACTION READ ONLY`;
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${input.bookingId}))`;
        } else {
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.bookingId}))`;
        }
        const context = Object.freeze({ ...input.context, transactionScopeId: randomUUID() });
        // Owner repositories use interactive transactions. Enlist those callbacks rather
        // than starting independent transactions that could commit before the boundary.
        const client = enlistedPrismaClient(transaction);
        const scope: Scope = {
          bookingId: input.bookingId,
          context,
          client,
          readOnly,
          active: true,
        };
        return storage.run(scope, async () => {
          try {
            return await work(context);
          } finally {
            scope.active = false;
          }
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 30_000,
      },
    );
  }
  const boundary: BookingBoundaryUnitOfWork = Object.freeze({ run });
  // Infrastructure chooses this facade only for database-only views. PostgreSQL
  // rejects writes; commands retain the original exclusive boundary and retries.
  const readBoundary: BookingBoundaryUnitOfWork = Object.freeze({
    run<T>(input: BoundaryInput, work: (scopedContext: Context) => Promise<T>) {
      return run(input, work, true);
    },
  });

  return Object.freeze({
    boundary,
    readBoundary,
    isReadScope: () => storage.getStore()?.active === true && storage.getStore()!.readOnly,
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
