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
  it.each(['unexpected', 'toString', '__proto__'])(
    'rejects an unrecognized JavaScript pool owner %s before creating an adapter',
    (owner) => {
      expect(() =>
        Reflect.apply(createPrismaClient, undefined, [
          'postgresql://runtime:secret@localhost:5432/wedding',
          false,
          owner,
        ]),
      ).toThrow('pool owner');
      expect(captured).toHaveLength(0);
    },
  );
  it.each([false, true])(
    'routes each measured owner maximum with diagnostics=%s',
    async (enabled) => {
      vi.stubEnv('DB_POOL_MAX', '1');
      vi.stubEnv('DB_POOL_MAX_VENUE_CATALOG', '3');
      vi.stubEnv('DB_POOL_MAX_ANALYTICS', '2');
      vi.stubEnv('DB_CONNECTION_RESERVE', '36');
      const clients = [
        createPrismaClient(
          'postgresql://runtime:secret@localhost:5432/wedding',
          enabled,
          'venue-catalog',
        ),
        createPrismaClient(
          'postgresql://runtime:secret@localhost:5432/wedding',
          enabled,
          'analytics',
        ),
        createPrismaClient('postgresql://runtime:secret@localhost:5432/wedding', enabled),
      ];
      try {
        expect(
          captured.map((input) =>
            input instanceof DiagnosticPool ? input.options.max : (input as { max: number }).max,
          ),
        ).toEqual([3, 2, 1]);
      } finally {
        await Promise.all(clients.map((client) => client.$disconnect()));
      }
    },
  );
  it.each([false, true])(
    'uses the budgeted catalog maximum only for that owner, diagnostics=%s',
    async (enabled) => {
      vi.stubEnv('DB_POOL_MAX', '2');
      vi.stubEnv('DB_POOL_MAX_VENUE_CATALOG', '3');
      vi.stubEnv('DB_CONNECTION_RESERVE', '24');
      const clients = [
        createPrismaClient(
          'postgresql://runtime:secret@localhost:5432/wedding',
          enabled,
          'venue-catalog',
        ),
        createPrismaClient('postgresql://runtime:secret@localhost:5432/wedding', enabled),
      ];
      try {
        expect(captured).toHaveLength(2);
        expect(
          captured.map((input) =>
            input instanceof DiagnosticPool ? input.options.max : (input as { max: number }).max,
          ),
        ).toEqual([3, 2]);
      } finally {
        await Promise.all(clients.map((client) => client.$disconnect()));
      }
    },
  );
  it.each([
    { enabled: false, max: 1 },
    { enabled: true, max: 1 },
    { enabled: false, max: 2 },
    { enabled: true, max: 2 },
    { enabled: false, max: 3 },
    { enabled: true, max: 3 },
  ])(
    'forwards max=$max and bounded idle reuse with diagnostics=$enabled',
    async ({ enabled, max }) => {
      vi.stubEnv('DB_POOL_MAX', String(max));
      vi.stubEnv('DB_POOL_MAX_VENUE_CATALOG', undefined);
      vi.stubEnv('DB_POOL_MAX_ANALYTICS', undefined);
      vi.stubEnv('DB_POOL_ACQUIRE_TIMEOUT_MS', '2000');
      vi.stubEnv('DB_PLANNED_PROCESSES', '2');
      vi.stubEnv('DB_MAX_CONNECTIONS', '60');
      vi.stubEnv('DB_CONNECTION_RESERVE', '10');
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
          max,
          connectionTimeoutMillis: 2000,
          idleTimeoutMillis: 60000,
        });
      } finally {
        await client.$disconnect();
      }
    },
  );
});
