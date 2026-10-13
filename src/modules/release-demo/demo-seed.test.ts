import { describe, expect, it, vi } from 'vitest';
import { ensureDemoSeed, demoSeedKey, type DemoSeedPort } from './demo-seed.js';
describe('release seed ownership and replay', () => {
  const input = {
    scenario: 'no-names' as const,
    planningHeadcount: 100,
    checkInMode: 'NONE' as const,
  };
  it('creates a missing owner fixture, verifies replay and never updates it', async () => {
    let snapshot: typeof input | null = null;
    const port: DemoSeedPort<typeof input> = {
      read: () => Promise.resolve(snapshot),
      create: vi.fn(() => {
        snapshot = input;
        return Promise.resolve();
      }),
    };
    const target = {
      environment: 'test' as const,
      databaseUrl: 'postgresql://local:secret@127.0.0.1:55435/rel_test',
    };
    expect(await ensureDemoSeed(target, input, port)).toBe('CREATED');
    expect(await ensureDemoSeed(target, input, port)).toBe('VERIFIED_EXISTING');
    expect(port.create).toHaveBeenCalledOnce();
    snapshot = { ...input, planningHeadcount: 101 };
    await expect(ensureDemoSeed(target, input, port)).rejects.toThrow('DEMO_SEED_CONFLICT');
    expect(port.create).toHaveBeenCalledOnce();
  });
  it('keeps keys stable across retries and scopes them to the scenario', () => {
    expect(demoSeedKey('no-names')).toMatch(/^[a-f0-9-]{36}$/u);
    expect(demoSeedKey('no-names')).toBe(demoSeedKey('no-names'));
    expect(demoSeedKey('no-names')).not.toBe(demoSeedKey('partial-names'));
  });
  it.each([
    { environment: 'production', databaseUrl: 'postgresql://local:secret@127.0.0.1/rel_test' },
    { environment: 'staging', databaseUrl: 'postgresql://remote:secret@shared.test/db' },
    { environment: 'test', databaseUrl: 'postgresql://remote:secret@shared.test/db' },
    { environment: 'test', databaseUrl: 'postgresql://local:secret@127.0.0.1/wedding_local_demo' },
  ])('refuses an unbounded target before any provider command', async (target) => {
    const port = { read: vi.fn(), create: vi.fn() };
    await expect(ensureDemoSeed(target, input, port)).rejects.toThrow(
      'DISPOSABLE_RELEASE_TARGET_REQUIRED',
    );
    expect(port.read).not.toHaveBeenCalled();
  });
  it('fails when an owner does not persist the command, without inventing success', async () => {
    const port = { read: () => Promise.resolve(null), create: () => Promise.resolve() };
    await expect(
      ensureDemoSeed(
        { environment: 'test', databaseUrl: 'postgresql://local:secret@localhost/rel_test' },
        input,
        port,
      ),
    ).rejects.toThrow('DEMO_SEED_NOT_PERSISTED');
  });
});
