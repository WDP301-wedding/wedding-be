export const DEFAULT_READINESS_TIMEOUT_MS = 1_000;

export type ReadinessProbe = (signal: AbortSignal) => Promise<void>;
export type ReadinessCheck = () => Promise<boolean>;

export function createReadinessCheck(
  probe: ReadinessProbe,
  timeoutMs = DEFAULT_READINESS_TIMEOUT_MS,
): ReadinessCheck {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('The readiness timeout must be a positive finite number.');
  }

  return async () => {
    const controller = new AbortController();
    let timeout: NodeJS.Timeout | undefined;
    const probeOutcome = Promise.resolve()
      .then(async () => probe(controller.signal))
      .then(
        () => true,
        () => false,
      );
    const deadline = new Promise<false>((resolve) => {
      timeout = setTimeout(() => {
        controller.abort();
        resolve(false);
      }, timeoutMs);
    });

    try {
      return await Promise.race([probeOutcome, deadline]);
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  };
}
