import { describe, expect, it } from 'vitest';
import type { Prisma } from '../../generated/prisma/client.js';
import { enlistedPrismaClient } from './enlisted-prisma-client.js';

describe('enlisted Prisma client', () => {
  it('runs nested interactive work on the existing transaction and preserves method receivers', async () => {
    const transaction = {
      marker: 'existing-transaction',
      booking: { findUnique: () => Promise.resolve({ id: 'booking' }) },
      $queryRaw() {
        return Promise.resolve(this.marker);
      },
    };
    const tx = transaction as unknown as Prisma.TransactionClient;
    const client = enlistedPrismaClient(tx);
    expect(
      await client.$transaction(async (current) => {
        expect(current).toBe(tx);
        return current.booking.findUnique({ where: { id: 'booking' } });
      }),
    ).toEqual({ id: 'booking' });
    expect(await client.$queryRaw`SELECT 1`).toBe('existing-transaction');
    expect(client.booking).toBe(transaction.booking);
  });
});
