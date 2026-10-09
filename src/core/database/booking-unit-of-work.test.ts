import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../../generated/prisma/client.js';
import { createBookingBoundaryUnitOfWork } from './booking-unit-of-work.js';

const context = {
  requestId: 'request',
  causationId: 'cause',
  actorAccountId: 'actor',
  authority: 'AUTHENTICATED' as const,
};

function fixture() {
  const transaction = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    booking: { findUnique: vi.fn().mockResolvedValue({ id: 'booking' }) },
  };
  const client = {
    $transaction: vi.fn(async (work: (tx: typeof transaction) => Promise<unknown>) =>
      work(transaction),
    ),
  };
  return {
    transaction,
    client,
    scope: createBookingBoundaryUnitOfWork(client as unknown as PrismaClient),
  };
}

describe('booking boundary transaction scope', () => {
  it('enlists reads and nested owner callbacks in one transaction and lock', async () => {
    const { scope, transaction, client } = fixture();
    await scope.boundary.run({ bookingId: 'booking', context }, async (scoped) => {
      expect(Object.isFrozen(scoped)).toBe(true);
      expect(scoped.transactionScopeId).toBeDefined();
      await scope.withClient('booking', scoped, (enlisted) =>
        enlisted.booking.findUnique({ where: { id: 'booking' } }),
      );
      await scope.withClient('booking', scoped, (enlisted) =>
        enlisted.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT 1`;
        }),
      );
    });
    expect(client.$transaction).toHaveBeenCalledOnce();
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(2);
    expect(transaction.booking.findUnique).toHaveBeenCalledOnce();
  });

  it('uses the root client outside a scope and rejects fabricated scopes', async () => {
    const { scope, client } = fixture();
    expect(
      await scope.withClient('booking', context, (root) =>
        Promise.resolve(root === (client as unknown)),
      ),
    ).toBe(true);
    expect(() =>
      scope.withClient('booking', { ...context, transactionScopeId: 'forged' }, () =>
        Promise.resolve(),
      ),
    ).toThrow('invalid or has expired');
    expect(() =>
      scope.boundary.run(
        { bookingId: 'booking', context: { ...context, transactionScopeId: 'forged' } },
        () => Promise.resolve(),
      ),
    ).toThrow('invalid or has expired');
  });

  it('rejects copied, mismatched, nested, expired, and detached contexts', async () => {
    const { scope } = fixture();
    let captured: Parameters<typeof scope.withClient>[1];
    let detached: Promise<void> | undefined;
    let release: (() => void) | undefined;
    await scope.boundary.run({ bookingId: 'booking', context }, async (scoped) => {
      captured = scoped;
      for (const [id, supplied] of [
        ['other', scoped],
        ['booking', { ...scoped }],
        ['booking', context],
      ] as const) {
        expect(() => scope.withClient(id, supplied, () => Promise.resolve())).toThrow(
          'invalid or has expired',
        );
      }
      expect(() =>
        scope.boundary.run({ bookingId: 'booking', context }, () => Promise.resolve()),
      ).toThrow('invalid or has expired');
      await scope.withClient('booking', undefined, () => Promise.resolve());
      // An async resource can retain ALS after the callback; the active flag revokes it.
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      detached = gate.then(() => scope.withClient('booking', scoped, () => Promise.resolve()));
    });
    expect(() => scope.withClient('booking', captured, () => Promise.resolve())).toThrow(
      'invalid or has expired',
    );
    const rejected = expect(detached!).rejects.toThrow('invalid or has expired');
    release!();
    await rejected;
  });

  it('propagates an exception to the outer transaction', async () => {
    const { scope } = fixture();
    await expect(
      scope.boundary.run({ bookingId: 'booking', context }, () =>
        Promise.reject(new Error('owner failed')),
      ),
    ).rejects.toThrow('owner failed');
  });
});
