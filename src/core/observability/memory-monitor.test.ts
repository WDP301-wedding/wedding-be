import { afterEach, describe, expect, it, vi } from 'vitest';
import { startMemoryMonitor } from './memory-monitor.js';
import type { Logger } from 'pino';

afterEach(() => vi.useRealTimers());
describe('runtime memory monitor', () => {
  it('logs numeric heap and realtime load at startup, then stops on close', () => {
    vi.useFakeTimers();
    const info = vi.fn();
    const monitor = startMemoryMonitor({ info } as unknown as Logger, () => 3);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'runtime_memory_sample',
        heapUsed: expect.any(Number),
        heapLimit: expect.any(Number),
        rss: expect.any(Number),
        realtimeClients: 3,
      }),
      expect.any(String),
    );
    vi.advanceTimersByTime(15_000);
    expect(info).toHaveBeenCalledTimes(2);
    monitor.close();
    vi.advanceTimersByTime(30_000);
    expect(info).toHaveBeenCalledTimes(2);
  });
});
