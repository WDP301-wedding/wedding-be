import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SeatingService } from '../application/seating.service.js';
import { startSeatingReconciler } from './seating-reconciler.js';
describe('five-minute Seating reconciliation lifecycle', () => {
  afterEach(() => vi.useRealTimers());
  it('does no background database work when explicitly disabled', async () => {
    vi.useFakeTimers();
    const page = vi.fn().mockResolvedValue({ nextBookingId: null, failures: [] });
    const worker = startSeatingReconciler(
      { reconcilePage: page } as unknown as SeatingService,
      vi.fn(),
      false,
    );
    await vi.advanceTimersByTimeAsync(900000);
    expect(page).not.toHaveBeenCalled();
    await worker.close();
  });
  it('tracks bounded page cursors, reports failures, and stops on close', async () => {
    vi.useFakeTimers();
    const page = vi
      .fn()
      .mockResolvedValueOnce({ nextBookingId: 'next', failures: ['failed'] })
      .mockResolvedValueOnce({ nextBookingId: null, failures: [] })
      .mockRejectedValueOnce(new Error('DB'));
    const report = vi.fn(),
      worker = startSeatingReconciler({ reconcilePage: page } as unknown as SeatingService, report);
    await vi.advanceTimersByTimeAsync(300000);
    expect(report).toHaveBeenCalledWith(['failed']);
    expect(page).toHaveBeenLastCalledWith('next');
    await vi.advanceTimersByTimeAsync(300000);
    expect(report).toHaveBeenCalledWith(['SEATING_RECONCILIATION_FAILED']);
    await worker.close();
    await vi.advanceTimersByTimeAsync(300000);
    expect(page).toHaveBeenCalledTimes(3);
  });
  it('does not overlap pending work and waits on shutdown', async () => {
    vi.useFakeTimers();
    let release!: (v: { nextBookingId: null; failures: string[] }) => void;
    const page = vi.fn(
      () =>
        new Promise<{ nextBookingId: null; failures: string[] }>((resolve) => {
          release = resolve;
        }),
    );
    const worker = startSeatingReconciler(
      { reconcilePage: page } as unknown as SeatingService,
      vi.fn(),
    );
    await vi.advanceTimersByTimeAsync(600000);
    expect(page).toHaveBeenCalledTimes(1);
    const close = worker.close();
    release({ nextBookingId: null, failures: [] });
    await close;
  });
});
