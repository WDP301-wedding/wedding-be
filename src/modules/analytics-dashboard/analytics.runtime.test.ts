import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../../config/config.js';
const f = vi.hoisted(() => ({
  prisma: { $connect: vi.fn(), $disconnect: vi.fn(), analyticsHead: { findMany: vi.fn() } },
  services: { projector: { refresh: vi.fn() }, service: {}, resolver: {}, audit: vi.fn() },
  router: vi.fn(),
}));
vi.mock('../../core/database/prisma.js', () => ({ createPrismaClient: () => f.prisma }));
vi.mock('./infrastructure/analytics.composition.js', () => ({
  createAnalyticsServices: () => f.services,
}));
vi.mock('./http/analytics.router.js', () => ({ createAnalyticsRouter: f.router }));
import { createAnalyticsRuntime } from './analytics.runtime.js';
const config = { database: { url: 'postgresql://unused@127.0.0.1:1/unused' } } as Config;
describe('SPEC-10 scheduled projection lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    f.prisma.$connect.mockResolvedValue(undefined);
    f.prisma.$disconnect.mockResolvedValue(undefined);
    f.prisma.analyticsHead.findMany.mockResolvedValue([{ scope: 'manager' }]);
    f.services.projector.refresh.mockResolvedValue('generation');
  });
  afterEach(() => vi.useRealTimers());
  it('refreshes every 60 seconds, starts once and drains before database shutdown', async () => {
    const runtime = await createAnalyticsRuntime(config);
    runtime.start();
    runtime.start();
    await vi.advanceTimersByTimeAsync(60000);
    expect(f.services.projector.refresh).toHaveBeenCalledWith(
      'manager',
      expect.objectContaining({ authority: 'AUTHENTICATED', actorAccountId: 'manager' }),
    );
    expect(f.services.projector.refresh).toHaveBeenCalledTimes(1);
    await runtime.resource.close();
    await vi.advanceTimersByTimeAsync(120000);
    expect(f.services.projector.refresh).toHaveBeenCalledTimes(1);
    expect(f.prisma.$disconnect).toHaveBeenCalledOnce();
    await runtime.stop();
  });
  it('does not overlap slow refreshes and waits for pending work on stop', async () => {
    let finish: () => void = () => undefined;
    f.services.projector.refresh.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const runtime = await createAnalyticsRuntime(config);
    runtime.start();
    await vi.advanceTimersByTimeAsync(120000);
    expect(f.services.projector.refresh).toHaveBeenCalledOnce();
    const stopped = runtime.resource.close();
    expect(f.prisma.$disconnect).not.toHaveBeenCalled();
    finish();
    await stopped;
    expect(f.prisma.$disconnect).toHaveBeenCalledOnce();
  });
  it('continues after a failing scope or scan and cleans up failed initialization', async () => {
    f.services.projector.refresh.mockRejectedValueOnce(new Error('source offline'));
    const runtime = await createAnalyticsRuntime(config);
    runtime.start();
    await vi.advanceTimersByTimeAsync(60000);
    f.prisma.analyticsHead.findMany.mockRejectedValueOnce(new Error('database offline'));
    await vi.advanceTimersByTimeAsync(120000);
    expect(f.services.projector.refresh).toHaveBeenCalledTimes(2);
    await runtime.resource.close();
    f.prisma.$connect.mockRejectedValueOnce(new Error('failed init'));
    await expect(createAnalyticsRuntime(config)).rejects.toThrow('failed init');
    expect(f.prisma.$disconnect).toHaveBeenCalledTimes(2);
  });
  it('pages Manager scopes so accounts beyond the first batch are refreshed', async () => {
    f.prisma.analyticsHead.findMany.mockResolvedValueOnce(
      Array.from({ length: 100 }, (_, i) => ({ scope: String(i).padStart(3, '0') })),
    );
    const runtime = await createAnalyticsRuntime(config);
    runtime.start();
    await vi.advanceTimersByTimeAsync(60000);
    expect(f.services.projector.refresh).toHaveBeenCalledTimes(101);
    expect(f.prisma.analyticsHead.findMany).toHaveBeenLastCalledWith({
      take: 100,
      orderBy: { scope: 'asc' },
      where: { scope: { gt: '099' } },
    });
    await runtime.resource.close();
  });
});
