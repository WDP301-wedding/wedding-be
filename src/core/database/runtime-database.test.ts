import { describe, expect, it, vi } from 'vitest';
import { closeApplicationDatabase, createApplicationDatabaseResource } from './runtime-database.js';

describe('application database ownership', () => {
  it('preserves readiness force cleanup when the lifecycle deadline expires', () => {
    const force = vi.fn();
    const resource = createApplicationDatabaseResource({ $disconnect: vi.fn() }, [
      {
        name: 'failed',
        close: vi.fn(),
        forceClose: () => {
          throw new Error('close failed');
        },
      },
      { name: 'no-force', close: vi.fn() },
      { name: 'readiness', close: vi.fn(), forceClose: force },
    ]);
    resource.forceClose?.();
    expect(force).toHaveBeenCalledOnce();
    expect(Object.hasOwn(resource, 'close')).toBe(true);
  });
  it('reports a disconnect failure without retrying or skipping module cleanup', async () => {
    const failure = new Error('disconnect failed');
    const closeModule = vi.fn(() => Promise.resolve());
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
      $disconnect: vi.fn(() => {
        events.push('disconnect');
        return Promise.resolve();
      }),
    };
    const close = closeApplicationDatabase(prisma, [
      {
        name: 'worker',
        close: async () => {
          await worker;
          events.push('worker');
        },
      },
      {
        name: 'realtime',
        close: () => {
          events.push('realtime');
          return Promise.resolve();
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
    const prisma = { $disconnect: vi.fn(() => Promise.resolve()) };
    const other = vi.fn(() => Promise.resolve());
    const close = closeApplicationDatabase(prisma, [
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
