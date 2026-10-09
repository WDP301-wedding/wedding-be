import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { ValidationError } from '../errors/app-error.js';

/** Frozen baseline21.1/21.8 application boundary; never accepts HTTP authority. */
export interface ContractContext {
  readonly requestId: string;
  readonly causationId: string;
  readonly actorAccountId: string | null;
  readonly authority: 'AUTHENTICATED' | 'SYSTEM';
  readonly transactionScopeId?: string;
  readonly purpose?: string;
}
export interface BookingBoundaryUnitOfWork {
  run<T>(
    input: Readonly<{ bookingId: string; context: ContractContext }>,
    work: (scopedContext: ContractContext) => Promise<T>,
  ): Promise<T>;
}
interface Scope {
  readonly bookingId: string;
  readonly context: ContractContext;
  readonly tx: Prisma.TransactionClient;
  active: boolean;
}

/** Infrastructure-only transaction lookup. Application consumers receive opaque
 * contexts; each owner adapter enlists through this same composition-owned instance. */
export class PrismaBookingBoundary implements BookingBoundaryUnitOfWork {
  private readonly storage = new AsyncLocalStorage<Scope>();
  constructor(readonly prisma: PrismaClient) {}

  current(bookingId?: string): Prisma.TransactionClient | undefined {
    const scope = this.storage.getStore();
    if (scope === undefined) return undefined;
    if (!scope.active || (bookingId !== undefined && scope.bookingId !== bookingId.toLowerCase()))
      throw new ValidationError();
    return scope.tx;
  }

  currentContext(bookingId?: string): ContractContext | undefined {
    this.current(bookingId);
    return this.storage.getStore()?.context;
  }

  requireScope(bookingId: string, context: ContractContext): Prisma.TransactionClient {
    const scope = this.storage.getStore();
    if (
      scope === undefined ||
      !scope.active ||
      scope.bookingId !== bookingId.toLowerCase() ||
      scope.context.transactionScopeId !== context.transactionScopeId ||
      scope.context.actorAccountId !== context.actorAccountId ||
      scope.context.authority !== context.authority ||
      scope.context.requestId !== context.requestId ||
      scope.context.causationId !== context.causationId
    )
      throw new ValidationError();
    return scope.tx;
  }

  /** Owner infrastructure enlistment for ports whose frozen input lacks bookingId. */
  enlist(context: ContractContext): Prisma.TransactionClient {
    const scope = this.storage.getStore();
    if (scope === undefined) throw new ValidationError();
    return this.requireScope(scope.bookingId, context);
  }

  async run<T>(
    input: Readonly<{ bookingId: string; context: ContractContext }>,
    work: (scopedContext: ContractContext) => Promise<T>,
    admit?: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<T> {
    if (input.context.authority !== 'AUTHENTICATED' || input.context.actorAccountId === null)
      throw new ValidationError();
    return this.runTrusted(input, work, admit);
  }

  /** Purpose-specific internal facade; never exposed to HTTP/body authority. */
  async runSystemInvalidation<T>(
    input: Readonly<{
      bookingId: string;
      context: ContractContext;
      purpose: 'SEATING_REGISTRY_INVALIDATION';
    }>,
    work: (scoped: ContractContext) => Promise<T>,
  ): Promise<T> {
    if (
      input.purpose !== 'SEATING_REGISTRY_INVALIDATION' ||
      input.context.authority !== 'SYSTEM' ||
      input.context.actorAccountId !== null
    )
      throw new ValidationError();
    return this.runTrusted(input, work);
  }

  private async runTrusted<T>(
    input: Readonly<{ bookingId: string; context: ContractContext }>,
    work: (scopedContext: ContractContext) => Promise<T>,
    admit?: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<T> {
    const bookingId = z.uuid().parse(input.bookingId).toLowerCase();
    if (input.context.actorAccountId !== null) z.uuid().parse(input.context.actorAccountId);
    if (!input.context.requestId || !input.context.causationId) throw new ValidationError();
    if (input.context.transactionScopeId !== undefined) {
      const tx = this.requireScope(bookingId, input.context);
      await admit?.(tx);
      return work(input.context);
    }
    // An unscoped nested run must not silently start an independent transaction.
    if (this.storage.getStore() !== undefined) throw new ValidationError();
    return this.prisma.$transaction(
      async (tx) => {
        await admit?.(tx);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${bookingId}::text))`;
        const context = Object.freeze({ ...input.context, transactionScopeId: randomUUID() });
        const scope: Scope = { bookingId, context, tx, active: true };
        try {
          return await this.storage.run(scope, () => work(context));
        } finally {
          scope.active = false;
        }
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 10_000,
        timeout: 30_000,
      },
    );
  }
}
