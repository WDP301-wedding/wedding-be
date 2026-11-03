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
  it('does not disconnect the application-owned client when its runtime closes or fails', async () => {
    const shared = { $connect: vi.fn().mockResolvedValue(undefined), $disconnect: vi.fn() };
    const borrowed = shared as unknown as Parameters<typeof createGuestManagementRuntime>[1];
    const runtime = await createGuestManagementRuntime(config, borrowed);
    await runtime.resource.close();
    expect(shared.$disconnect).not.toHaveBeenCalled();
    shared.$connect.mockRejectedValueOnce(new Error('connection failed'));
    await expect(createGuestManagementRuntime(config, borrowed)).rejects.toThrow(
      'connection failed',
    );
    expect(shared.$disconnect).not.toHaveBeenCalled();
    expect(prisma.$connect).not.toHaveBeenCalled();
  });
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
