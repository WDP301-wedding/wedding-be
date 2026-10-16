import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as AdapterModule from '@prisma/adapter-pg';
import { DiagnosticPool } from './diagnostics.js';
import { createPrismaClient } from './prisma.js';

const captured = vi.hoisted(() => [] as unknown[]);
vi.mock('@prisma/adapter-pg', async (original) => {
  const { PrismaPg } = await original<typeof AdapterModule>();
  return {
    PrismaPg: class extends PrismaPg {
      constructor(...args: ConstructorParameters<typeof PrismaPg>) {
        super(...args);
        captured.push(args[0]);
      }
    },
  };
});
afterEach(() => {
  vi.unstubAllEnvs();
  captured.length = 0;
});
describe('runtime driver pool options', () => {
  it.each([false, true])('forwards bounded idle reuse with diagnostics=%s', async (enabled) => {
    vi.stubEnv('DB_POOL_IDLE_TIMEOUT_MS', '60000');
    const client = createPrismaClient(
      'postgresql://runtime:secret@localhost:5432/wedding',
      enabled,
    );
    try {
      expect(captured).toHaveLength(1);
      const input = captured[0];
      expect(input instanceof DiagnosticPool).toBe(enabled);
      const options = input instanceof DiagnosticPool ? input.options : input;
      expect(options).toMatchObject({
        max: 3,
        connectionTimeoutMillis: 2000,
        idleTimeoutMillis: 60000,
      });
    } finally {
      await client.$disconnect();
    }
  });
});
