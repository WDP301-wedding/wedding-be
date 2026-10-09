import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';

/** Owner repositories enlist interactive callbacks in the caller's transaction. */
export function enlistedPrismaClient(transaction: Prisma.TransactionClient): PrismaClient {
  return new Proxy(transaction, {
    get(target, key) {
      if (key === '$transaction') {
        return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          callback(transaction);
      }
      const value: unknown = Reflect.get(target, key);
      return typeof value === 'function' ? (value.bind(target) as unknown) : value;
    },
  }) as PrismaClient;
}
