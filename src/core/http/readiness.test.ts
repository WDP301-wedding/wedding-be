import { describe, expect, it, vi } from 'vitest';

import { createReadinessCheck, type ReadinessProbe } from './readiness.js';

describe('createReadinessCheck', () => {
  it('shares concurrent probes and checks dependencies again after completion', async () => {
    let finish!: () => void;
    const probe = vi
      .fn<ReadinessProbe>()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      )
      .mockRejectedValueOnce(new Error('dependency offline'));
    const check = createReadinessCheck(probe);
    const first = check();
    const second = check();
    expect(second).toBe(first);
    await Promise.resolve();
    expect(probe).toHaveBeenCalledTimes(1);
    finish();
    await expect(first).resolves.toBe(true);
    await expect(check()).resolves.toBe(false);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it.each([0, Number.POSITIVE_INFINITY])(
    'rejects an invalid readiness timeout of %s before calling the probe',
    (timeoutMs) => {
      const probe = vi.fn<ReadinessProbe>().mockResolvedValue(undefined);

      expect(() => createReadinessCheck(probe, timeoutMs)).toThrow(RangeError);
      expect(probe).not.toHaveBeenCalled();
    },
  );
});
