import { describe, expect, it, vi } from 'vitest';
import { startNotificationWorker } from './notification-worker.js';
describe('actual worker lifecycle', () => {
  it('starts immediately, never overlaps, drains stop and restarts independently', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const run = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      ),
      error = vi.fn(),
      worker = startNotificationWorker({ run }, error);
    expect(run).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(180000);
    expect(run).toHaveBeenCalledOnce();
    let stopped = false;
    const stop = worker.close().then(() => {
      stopped = true;
    });
    expect(stopped).toBe(false);
    release();
    await stop;
    expect(stopped).toBe(true);
    await vi.advanceTimersByTimeAsync(120000);
    expect(run).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
    const second = startNotificationWorker({ run: () => Promise.resolve() }, error);
    await second.close();
    vi.useRealTimers();
  });
  it('reports sanitized failure and retries next tick', async () => {
    vi.useFakeTimers();
    const run = vi
        .fn()
        .mockRejectedValueOnce(Error('private message'))
        .mockResolvedValue(undefined),
      error = vi.fn(),
      worker = startNotificationWorker({ run }, error);
    await vi.advanceTimersByTimeAsync(60000);
    expect(error.mock.calls).toEqual([[]]);
    expect(run).toHaveBeenCalledTimes(2);
    await worker.close();
    vi.useRealTimers();
  });
});
