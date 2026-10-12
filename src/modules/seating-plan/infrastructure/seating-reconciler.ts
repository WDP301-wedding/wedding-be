import type { SeatingService } from '../application/seating.service.js';
/** Bounded sweep; live print/confirmation also recheck, independently of delivery. */
export function startSeatingReconciler(
  service: SeatingService,
  report: (failures: readonly string[]) => void,
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
  const timer = setInterval(tick, 300000);
  timer.unref();
  return {
    async close() {
      clearInterval(timer);
      await active;
    },
  };
}
