import { describe, expect, it } from 'vitest';

import { DatabaseConfigurationError, createPrismaClient } from './prisma.js';

describe('createPrismaClient', () => {
  it.each([false, true])('creates a PostgreSQL adapter with diagnostics=%s', async (enabled) => {
    const client = createPrismaClient(
      'postgresql://runtime:secret@localhost:5432/wedding',
      enabled,
    );

    expect(typeof client.$connect).toBe('function');
    expect(typeof client.$transaction).toBe('function');

    await client.$disconnect();
  });

  it('fails before creating a pool when DATABASE_URL is unavailable', () => {
    expect(() => createPrismaClient('')).toThrow(DatabaseConfigurationError);
  });
});
