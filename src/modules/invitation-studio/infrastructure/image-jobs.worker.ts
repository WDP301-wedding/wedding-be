/** Timers never carry an HTTP context. A single local tick plus database admission
 * bounds work across processes. Shutdown drains before the Studio pool closes. */
export function startImageJobsWorker(
  service: { runNext(): Promise<boolean> },
  report: () => void,
  enabled: boolean,
) {
  let active: Promise<void> | undefined;
  let closed = false;
  const tick = () => {
    if (closed || active) return;
    active = service
      .runNext()
      .then(() => undefined)
      .catch(() => report())
      .finally(() => {
        active = undefined;
      });
  };
  const timer = setInterval(tick, enabled ? 3000 : 60_000);
  timer.unref();
  return {
    async close() {
      closed = true;
      clearInterval(timer);
      await active;
    },
  };
}
