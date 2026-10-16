import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { PrismaBookingBoundary, type ContractContext } from './booking-boundary.js';

function fixture() {
  const locks: string[] = [];
  const transactions: Array<'commit' | 'rollback'> = [];
  const tx = {
    $executeRaw: vi.fn((sql: TemplateStringsArray) => {
      locks.push(sql.join('?'));
      return Promise.resolve(1);
    }),
  };
  const prisma = {
    $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => {
      try {
        const result = await work(tx);
        transactions.push('commit');
        return result;
      } catch (error) {
        transactions.push('rollback');
        throw error;
      }
    }),
  };
  const boundary = new PrismaBookingBoundary(prisma as unknown as PrismaClient);
  const bookingId = randomUUID();
  const context: ContractContext = {
    requestId: randomUUID(),
    causationId: randomUUID(),
    actorAccountId: randomUUID(),
    authority: 'AUTHENTICATED',
  };
  return { boundary, bookingId, context, tx, prisma, locks, transactions };
}

describe('booking read transaction boundary', () => {
  it('enlists nested reads in one shared scope and revokes it after commit', async () => {
    const f = fixture();
    let captured: ContractContext | undefined;
    expect(f.boundary.isReadScope()).toBe(false);
    await f.boundary.runRead(f, async (context) => {
      expect(f.boundary.isReadScope()).toBe(true);
      captured = context;
      expect(f.boundary.requireScope(f.bookingId, context)).toBe(f.tx);
      await f.boundary.runRead({ ...f, context }, (nested) => {
        expect(nested).toBe(context);
        return Promise.resolve();
      });
    });
    expect(f.locks).toEqual(['SELECT pg_advisory_xact_lock_shared(hashtext(?::text))']);
    expect(f.transactions).toEqual(['commit']);
    expect(() => f.boundary.requireScope(f.bookingId, captured!)).toThrow();
  });

  it('rolls back a read scope before retrying a required repair exclusively', async () => {
    const f = fixture();
    let attempts = 0;
    const result = await f.boundary.runRead(f, (context) => {
      attempts++;
      f.boundary.requireWriteScope(f.bookingId, context);
      return Promise.resolve('initialized');
    });
    expect(result).toBe('initialized');
    expect(attempts).toBe(2);
    expect(f.transactions).toEqual(['rollback', 'commit']);
    expect(f.locks).toEqual([
      'SELECT pg_advisory_xact_lock_shared(hashtext(?::text))',
      'SELECT pg_advisory_xact_lock(hashtext(?::text))',
    ]);
  });

  it('restarts the outer read before entering a nested writer instead of upgrading a lock', async () => {
    const f = fixture();
    await f.boundary.runRead(f, (context) =>
      f.boundary.run({ ...f, context }, (writer) => {
        expect(f.boundary.isReadScope()).toBe(false);
        expect(f.boundary.requireWriteScope(f.bookingId, writer)).toBe(f.tx);
        return Promise.resolve();
      }),
    );
    expect(f.transactions).toEqual(['rollback', 'commit']);
  });

  it('does not retry application failures or admit a forged or nested unscoped read', async () => {
    const f = fixture();
    await expect(
      f.boundary.runRead(f, () => Promise.reject(new Error('read failed'))),
    ).rejects.toThrow('read failed');
    expect(f.prisma.$transaction).toHaveBeenCalledOnce();
    await expect(
      f.boundary.runRead({ ...f, context: { ...f.context, authority: 'SYSTEM' } }, () =>
        Promise.resolve(1),
      ),
    ).rejects.toThrow();
    await expect(
      f.boundary.runRead(
        { ...f, context: { ...f.context, transactionScopeId: randomUUID() } },
        () => Promise.resolve(1),
      ),
    ).rejects.toThrow();
    await f.boundary.runRead(f, async (context) => {
      await expect(f.boundary.runRead(f, () => Promise.resolve(1))).rejects.toThrow();
      expect(() => f.boundary.requireWriteScope(randomUUID(), context)).toThrow();
    });
  });
});
