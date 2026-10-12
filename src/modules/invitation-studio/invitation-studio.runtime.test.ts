import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../../config/config.js';
import { createPrismaClient } from '../../core/database/prisma.js';
import { createInvitationStudioServices } from './infrastructure/studio.composition.js';
import { createInvitationStudioRuntime } from './invitation-studio.runtime.js';
import type { StorageProvider } from '../../integrations/storage/storage-provider.js';

const prisma = vi.hoisted(() => ({ $connect: vi.fn(), $disconnect: vi.fn() }));
vi.mock('../../core/database/prisma.js', () => ({ createPrismaClient: vi.fn(() => prisma) }));
vi.mock('./infrastructure/studio.composition.js', () => ({
  createInvitationStudioServices: vi.fn(() => ({ service: {}, identity: { resolver: {} } })),
}));
vi.mock('../seating-plan/infrastructure/seating.composition.js', () => ({
  createSeatingServices: vi.fn(() => ({ seating: {}, resolver: {} })),
}));

function config(storage: Config['storage'] = { enabled: false }): Config {
  return {
    database: { url: 'postgresql://local/test' },
    storage,
    runtime: { environment: 'test' },
  } as Config;
}
function storage(): StorageProvider {
  return vi.mocked(createInvitationStudioServices).mock.calls.at(-1)![1];
}

describe('InvitationStudioRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.$connect.mockResolvedValue(undefined);
    prisma.$disconnect.mockResolvedValue(undefined);
  });
  it('uses native composition and rejects disabled Storage instead of persisting fake success', async () => {
    const runtime = await createInvitationStudioRuntime(config());
    expect(createPrismaClient).toHaveBeenCalledWith('postgresql://local/test');
    expect(createInvitationStudioServices).toHaveBeenCalledWith(
      prisma,
      expect.any(Object),
      null,
      null,
      expect.any(Function),
    );
    for (const operation of [
      storage().put({
        bytes: new Uint8Array(),
        contentType: 'image/png',
        purpose: 'PRIVATE_WEDDING_MEDIA',
        resourceId: 'unused',
      }),
      storage().createSignedReadUrl({
        objectKey: 'unused' as never,
        purpose: 'PRIVATE_WEDDING_MEDIA',
        resourceId: 'unused',
      }),
      storage().delete({
        objectKey: 'unused' as never,
        purpose: 'PRIVATE_WEDDING_MEDIA',
        resourceId: 'unused',
      }),
    ])
      await expect(operation).rejects.toMatchObject({ status: 503, code: 'PROVIDER_UNAVAILABLE' });
    expect(runtime.router).toBeTypeOf('function');
    await runtime.resource.close();
    expect(prisma.$disconnect).toHaveBeenCalledOnce();
  });
  it('constructs the real Supabase adapter when configured', async () => {
    const runtime = await createInvitationStudioRuntime(
      config({
        enabled: true,
        supabaseUrl: 'https://storage.example.test',
        serviceRoleKey: 'test-key',
        bucket: 'private-media',
      }),
    );
    expect(storage().constructor.name).toBe('SupabaseStorageProvider');
    await runtime.resource.close();
  });
  it('disconnects on database connection failure', async () => {
    prisma.$connect.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(createInvitationStudioRuntime(config())).rejects.toThrow('database unavailable');
    expect(prisma.$disconnect).toHaveBeenCalledOnce();
  });
  it('disconnects on invalid Storage configuration', async () => {
    await expect(
      createInvitationStudioRuntime(
        config({
          enabled: true,
          supabaseUrl: 'http://invalid.test',
          serviceRoleKey: 'test-key',
          bucket: 'private-media',
        }),
      ),
    ).rejects.toThrow();
    expect(prisma.$disconnect).toHaveBeenCalledOnce();
  });
});
