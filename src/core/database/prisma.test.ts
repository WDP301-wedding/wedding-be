import { describe, expect, it } from 'vitest';

import { DatabaseConfigurationError, createPrismaClient } from './prisma.js';

describe('createPrismaClient', () => {
  it('creates a Prisma 7 client backed by the PostgreSQL driver adapter', async () => {
    const client = createPrismaClient('postgresql://runtime:secret@localhost:5432/wedding');

    expect(typeof client.$connect).toBe('function');
    expect(typeof client.$transaction).toBe('function');

    await client.$disconnect();
  });

  it('fails before creating a pool when DATABASE_URL is unavailable', () => {
    expect(() => createPrismaClient('')).toThrow(DatabaseConfigurationError);
  });
});
