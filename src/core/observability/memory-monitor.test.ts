import { afterEach, describe, expect, it, vi } from 'vitest';
import { startMemoryMonitor } from './memory-monitor.js';
import type { Logger } from 'pino';

afterEach(() => vi.useRealTimers());
describe('runtime memory monitor', () => {
  it('logs numeric heap and realtime load at startup, then stops on close', () => {
    vi.useFakeTimers();
    const info = vi.fn<(record: Record<string, unknown>, message: string) => void>();
    const monitor = startMemoryMonitor({ info } as unknown as Logger, () => 3);
    const record = info.mock.calls[0]?.[0];
    expect(record?.event).toBe('runtime_memory_sample');
    expect(record?.realtimeClients).toBe(3);
    for (const field of ['heapUsed', 'heapLimit', 'rss'])
      expect(typeof record?.[field]).toBe('number');
    vi.advanceTimersByTime(15_000);
    expect(info).toHaveBeenCalledTimes(2);
    monitor.close();
    vi.advanceTimersByTime(30_000);
    expect(info).toHaveBeenCalledTimes(2);
  });
});
