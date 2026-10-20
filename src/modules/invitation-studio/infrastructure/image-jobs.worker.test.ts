import { afterEach, describe, expect, it, vi } from 'vitest';
import { startImageJobsWorker } from './image-jobs.worker.js';

afterEach(() => vi.useRealTimers());
describe('Image job worker lifecycle', () => {
  it('does not overlap, drains before close and never dispatches after shutdown', async () => {
    vi.useFakeTimers();
    let resolve!: (value: boolean) => void;
    const runNext = vi.fn(
      () =>
        new Promise<boolean>((r) => {
          resolve = r;
        }),
    );
    const worker = startImageJobsWorker({ runNext }, vi.fn(), true);
    await vi.advanceTimersByTimeAsync(6000);
    expect(runNext).toHaveBeenCalledTimes(1);
    let closed = false;
    const closing = worker.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    resolve(true);
    await closing;
    await vi.advanceTimersByTimeAsync(6000);
    expect(runNext).toHaveBeenCalledTimes(1);
  });
  it('reports an allowlisted failure and keeps polling; disabled mode only performs minute maintenance', async () => {
    vi.useFakeTimers();
    const runNext = vi
      .fn()
      .mockRejectedValueOnce(new Error('private provider payload'))
      .mockResolvedValue(false);
    const report = vi.fn();
    const worker = startImageJobsWorker({ runNext }, report, false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(runNext).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(117000);
    expect(runNext).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledExactlyOnceWith();
    await worker.close();
  });
});
