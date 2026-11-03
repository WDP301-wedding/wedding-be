import { performance } from 'node:perf_hooks';
import type { Logger } from 'pino';

/** Opt-in allocation attribution. Numeric counters and static task labels only.
 * Heap deltas include concurrent work; they are not proof of retained memory.
 */
export async function measureRuntimeTask<T>(
  task: string,
  work: () => Promise<T>,
  logger?: Logger,
): Promise<T> {
  if (!logger || process.env.RUNTIME_TASK_MEMORY_ENABLED !== 'true') return work();
  const before = process.memoryUsage();
  const began = performance.now();
  logger.info(
    { event: 'runtime_task_started', task, heapUsed: before.heapUsed, rss: before.rss },
    'Runtime task started',
  );
  let outcome = 'failed';
  try {
    const result = await work();
    outcome = 'completed';
    return result;
  } finally {
    const after = process.memoryUsage();
    logger.info(
      {
        event: 'runtime_task_memory',
        task,
        outcome,
        durationMs: Math.round(performance.now() - began),
        heapBefore: before.heapUsed,
        heapAfter: after.heapUsed,
        heapDelta: after.heapUsed - before.heapUsed,
        rssBefore: before.rss,
        rssAfter: after.rss,
        external: after.external,
      },
      'Runtime task memory sample',
    );
  }
}
