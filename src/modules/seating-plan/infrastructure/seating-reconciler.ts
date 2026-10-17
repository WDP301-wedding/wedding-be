import type { SeatingService } from '../application/seating.service.js';
/** Bounded sweep; live print/confirmation also recheck, independently of delivery. */
export function startSeatingReconciler(
  service: SeatingService,
  report: (failures: readonly string[]) => void,
  enabled = true,
) {
  let cursor: string | undefined, active: Promise<void> | undefined;
  const tick = () => {
    if (active !== undefined) return;
    active = (async () => {
      do {
        const page = await service.reconcilePage(cursor);
        cursor = page.nextBookingId ?? undefined;
        if (page.failures.length) report(page.failures);
      } while (cursor !== undefined);
    })()
      .catch(() => report(['SEATING_RECONCILIATION_FAILED']))
      .finally(() => {
        active = undefined;
      });
  };
  // Explicitly disabled experiments must not perform background reads or repairs.
  // Foreground confirmation, print and read revalidation remain independent.
  const timer = enabled ? setInterval(tick, 300000) : undefined;
  timer?.unref();
  return {
    async close() {
      clearInterval(timer);
      await active;
    },
  };
}
