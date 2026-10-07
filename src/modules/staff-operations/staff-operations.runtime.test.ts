import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../../config/config.js';
import { createPrismaClient } from '../../core/database/prisma.js';
import { createStaffOperationsRuntime } from './staff-operations.runtime.js';

const prisma = vi.hoisted(() => ({
  $connect: vi.fn(() => Promise.resolve()),
  $disconnect: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../core/database/prisma.js', () => ({
  createPrismaClient: vi.fn(() => prisma),
}));

function runtimeConfig(): Config {
  return {
    database: { url: 'postgresql://test:test@127.0.0.1:5432/test', migrationUrl: undefined },
    storage: { enabled: false },
  } as Config;
}

describe('StaffOperationsRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.$connect.mockResolvedValue(undefined);
    prisma.$disconnect.mockResolvedValue(undefined);
  });

  it('composes and closes the staff operations runtime', async () => {
    const runtime = await createStaffOperationsRuntime(runtimeConfig());

    expect(runtime.router).toBeTypeOf('function');
    expect(runtime.resource.name).toBe('staff-operations-database');
    expect(createPrismaClient).toHaveBeenCalledWith('postgresql://test:test@127.0.0.1:5432/test');
    await runtime.resource.close();
    expect(prisma.$disconnect).toHaveBeenCalledOnce();
  });

  it('disconnects the database when staff operations composition fails', async () => {
    prisma.$connect.mockRejectedValueOnce(new Error('connection failed'));

    await expect(createStaffOperationsRuntime(runtimeConfig())).rejects.toThrow('connection failed');
    expect(prisma.$disconnect).toHaveBeenCalledOnce();
  });
});
