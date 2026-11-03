import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { closeApplicationDatabase } from './runtime-database.js';

describe('application database ownership', () => {
  it('reports a disconnect failure without retrying or skipping module cleanup', async () => {
    const failure = new Error('disconnect failed');
    const closeModule = vi.fn(async () => undefined);
    const prisma = { $disconnect: vi.fn().mockRejectedValue(failure) };
    const close = closeApplicationDatabase(prisma, [{ name: 'module', close: closeModule }]);
    await expect(close()).rejects.toMatchObject({ errors: [failure] });
    await expect(close()).rejects.toMatchObject({ errors: [failure] });
    expect(prisma.$disconnect).toHaveBeenCalledOnce();
    expect(closeModule).toHaveBeenCalledOnce();
  });
  it('drains every module before disconnecting the shared database exactly once', async () => {
    const events: string[] = [];
    let finish!: () => void;
    const worker = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const prisma = {
      $disconnect: vi.fn(async () => {
        events.push('disconnect');
      }),
    };
    const close = closeApplicationDatabase(prisma as unknown as PrismaClient, [
      {
        name: 'worker',
        close: async () => {
          await worker;
          events.push('worker');
        },
      },
      {
        name: 'realtime',
        close: async () => {
          events.push('realtime');
        },
      },
    ]);
    const first = close();
    expect(close()).toBe(first);
    await Promise.resolve();
    expect(prisma.$disconnect).not.toHaveBeenCalled();
    finish();
    await first;
    expect(events).toEqual(['realtime', 'worker', 'disconnect']);
    await close();
    expect(prisma.$disconnect).toHaveBeenCalledOnce();
  });

  it('closes the shared client and other modules even when one cleanup fails', async () => {
    const failure = new Error('worker close failed');
    const prisma = { $disconnect: vi.fn(async () => undefined) };
    const other = vi.fn(async () => undefined);
    const close = closeApplicationDatabase(prisma as unknown as PrismaClient, [
      {
        name: 'bad',
        close: () => {
          throw failure;
        },
      },
      { name: 'other', close: other },
    ]);
    await expect(close()).rejects.toMatchObject({ errors: [failure] });
    expect(other).toHaveBeenCalledOnce();
    expect(prisma.$disconnect).toHaveBeenCalledOnce();
  });
});
