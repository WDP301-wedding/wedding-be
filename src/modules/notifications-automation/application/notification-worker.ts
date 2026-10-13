export interface NotificationWorkerTick {
  run(): Promise<void>;
}
/** Non-overlapping, immediate first tick; graceful shutdown waits for current work.
 * Persisted leases still protect duplicate replicas and a process crash. */
export function startNotificationWorker(
  tick: NotificationWorkerTick,
  onError: () => void,
  intervalMs = 60000,
) {
  let stopped = false,
    active: Promise<void> | undefined;
  const run = () => {
    if (stopped || active !== undefined) return;
    active = tick
      .run()
      .catch(() => {
        onError();
      })
      .finally(() => {
        active = undefined;
      });
  };
  const timer = setInterval(run, intervalMs);
  timer.unref();
  run();
  return {
    name: 'notification-worker',
    async close() {
      stopped = true;
      clearInterval(timer);
      await active;
    },
  };
}
