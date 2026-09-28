import { describe, expect, it, vi } from 'vitest';

import { createReadinessCheck, type ReadinessProbe } from './readiness.js';

describe('createReadinessCheck', () => {
  it.each([0, Number.POSITIVE_INFINITY])(
    'rejects an invalid readiness timeout of %s before calling the probe',
    (timeoutMs) => {
      const probe = vi.fn<ReadinessProbe>().mockResolvedValue(undefined);

      expect(() => createReadinessCheck(probe, timeoutMs)).toThrow(RangeError);
      expect(probe).not.toHaveBeenCalled();
    },
  );
});
