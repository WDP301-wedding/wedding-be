import { getHeapStatistics } from 'node:v8';
import type { Logger } from 'pino';

/** Numeric process counters only: no request payloads, tokens or customer data. */
export function startMemoryMonitor(logger: Logger, realtimeClients: () => number) {
  const sample = () => {
    logger.info(
      {
        event: 'runtime_memory_sample',
        ...process.memoryUsage(),
        heapLimit: getHeapStatistics().heap_size_limit,
        uptimeSeconds: Math.round(process.uptime()),
        realtimeClients: realtimeClients(),
      },
      'Runtime memory and realtime connection sample',
    );
  };
  sample();
  const timer = setInterval(sample, 15_000);
  timer.unref();
  return { close: () => clearInterval(timer) };
}
