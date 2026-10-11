import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGuestManagementRuntime } from './guest-management.runtime.js';
import type { Config } from '../../config/config.js';
const prisma = vi.hoisted(() => ({ $connect: vi.fn(), $disconnect: vi.fn() }));
vi.mock('../../core/database/prisma.js', () => ({ createPrismaClient: () => prisma }));
vi.mock('./infrastructure/guest.composition.js', () => ({
  createGuestServices: () => ({ identity: { resolver: {} }, readers: {} }),
}));
describe('Guest runtime lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.$connect.mockResolvedValue(undefined);
  });
  const config = { database: { url: 'postgresql://unused/test' } } as Config;
  it('creates its router after connection succeeds and closes its database', async () => {
    const runtime = await createGuestManagementRuntime(config);
    expect(runtime.router).toBeTypeOf('function');
    await runtime.resource.close();
    expect(prisma.$disconnect).toHaveBeenCalledOnce();
  });
  it('disconnects on startup failure', async () => {
    prisma.$connect.mockRejectedValueOnce(Error('unavailable'));
    await expect(createGuestManagementRuntime(config)).rejects.toThrow('unavailable');
    expect(prisma.$disconnect).toHaveBeenCalledOnce();
  });
});
