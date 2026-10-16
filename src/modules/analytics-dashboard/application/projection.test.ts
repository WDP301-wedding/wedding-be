import { describe, expect, it } from 'vitest';
import { AnalyticsProjector, type Projection, type ProjectionStore } from './projection.js';
import { type ReportingReader } from '../../../core/reporting/reporting-feed.js';
const context = {
  actorAccountId: 'manager',
  authority: 'AUTHENTICATED' as const,
  requestId: 'r',
  causationId: 'r',
};
function fixture() {
  let saved: Projection | null = null;
  const store: ProjectionStore = {
    load: async () => await Promise.resolve(saved),
    publish: async (_scope, expected, p) => {
      await Promise.resolve();
      expect(expected).toBe(saved?.generationId ?? null);
      saved = { ...p, generationId: String(Number(saved?.generationId ?? '0') + 1) };
      return saved.generationId;
    },
  };
  const empty: ReportingReader = {
    readPage: async () => await Promise.resolve({ throughSequence: 0, nextCursor: null, rows: [] }),
  };
  const sources = {
    booking: empty,
    billing: empty,
    invitation: empty,
    guest: empty,
    staff: empty,
    venue: empty,
  };
  const projector = new AnalyticsProjector(sources, store, () => new Date('2026-10-13T00:00:00Z'));
  return { store, sources, projector };
}
describe('ANL-W2 source fences', () => {
  it('reads independent owners concurrently with at most three active source pages', async () => {
    const f = fixture();
    let active = 0,
      peak = 0;
    for (const owner of Object.keys(f.sources) as (keyof typeof f.sources)[]) {
      f.sources[owner] = {
        readPage: async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 1));
          active--;
          return { throughSequence: 0, nextCursor: null, rows: [] };
        },
      };
    }
    await f.projector.refresh('s', context);
    expect(peak).toBe(3);
    expect((await f.store.load('s'))?.checkpoints.map((c) => c.owner)).toEqual(
      Object.keys(f.sources),
    );
  });
  it('pins all real owners to the same committed head observation without comparing their sequence values', async () => {
    const f = fixture();
    const through = { booking: 3, billing: 0, invitation: 0, guest: 0, staff: 0, venue: 0 };
    f.sources.booking = {
      readPage: (q) => {
        expect(q.throughSequence).toBe(3);
        return Promise.resolve({ throughSequence: 3, nextCursor: null, rows: [] });
      },
    };
    const projector = new AnalyticsProjector(
      f.sources,
      f.store,
      () => new Date('2026-10-13T00:00:00Z'),
      () => Promise.resolve(through),
    );
    await projector.refresh('s', context, true);
    expect((await f.store.load('s'))?.checkpoints[0]?.throughSequence).toBe(3);
  });
  it('applies duplicates/out of order monotonically and commits only complete pages', async () => {
    const f = fixture();
    f.sources.booking = {
      readPage: async (q) =>
        await Promise.resolve({
          throughSequence: 3,
          nextCursor: q.cursor ? null : 'next',
          rows: [
            {
              recordId: 'b',
              sequence: q.cursor ? 1 : 3,
              changedAt: 'now',
              value: q.cursor ? 'old' : 'new',
            },
          ],
        }),
    };
    await f.projector.refresh('s', context);
    expect((await f.store.load('s'))?.rows[0]?.value).toBe('new');
    f.sources.booking = {
      readPage: async () =>
        await Promise.resolve({ throughSequence: 3, rows: [], nextCursor: null }),
    };
    await f.projector.refresh('s', context);
    expect((await f.store.load('s'))?.rows).toHaveLength(1);
  });
  it('preserves old rows/fence on a failed later page and rejects partial rebuild', async () => {
    const f = fixture();
    f.sources.booking = {
      readPage: async () =>
        await Promise.resolve({
          throughSequence: 1,
          nextCursor: null,
          rows: [{ recordId: 'b', sequence: 1, changedAt: 'now', value: 'old' }],
        }),
    };
    await f.projector.refresh('s', context);
    f.sources.booking = {
      readPage: async (q) => {
        await Promise.resolve();
        if (q.cursor) throw new Error('offline');
        return {
          throughSequence: 2,
          nextCursor: 'next',
          rows: [{ recordId: 'b', sequence: 2, changedAt: 'now', value: 'new' }],
        };
      },
    };
    await f.projector.refresh('s', context);
    const previous = await f.store.load('s');
    expect(previous?.rows[0]?.value).toBe('old');
    expect(previous?.checkpoints[0]).toMatchObject({ throughSequence: 1, status: 'STALE' });
    await expect(f.projector.refresh('s', context, true)).rejects.toMatchObject({
      code: 'ANALYTICS_REBUILD_FAILED',
    });
    expect(await f.store.load('s')).toEqual(previous);
  });
  it('marks absent sources unavailable and rejects changing fences/cursor cycles', async () => {
    const f = fixture();
    f.sources.staff = {
      readPage: async () => {
        await Promise.resolve();
        throw new Error('not ready');
      },
    };
    f.sources.guest = {
      readPage: async () =>
        await Promise.resolve({ throughSequence: 0, rows: [], nextCursor: 'loop' }),
    };
    f.sources.booking = {
      readPage: async (q) =>
        await Promise.resolve({
          throughSequence: q.cursor ? 2 : 1,
          rows: [],
          nextCursor: q.cursor ? null : 'next',
        }),
    };
    await f.projector.refresh('s', context);
    expect(
      (await f.store.load('s'))?.checkpoints
        .filter((c) => c.status === 'SOURCE_NOT_READY')
        .map((c) => c.owner),
    ).toEqual(['booking', 'guest', 'staff']);
  });
  it('rebuilds deterministically and refuses source rows outside the fence', async () => {
    const f = fixture();
    f.sources.billing = {
      readPage: async () =>
        await Promise.resolve({
          throughSequence: 1,
          rows: [{ recordId: 'b', sequence: 2, changedAt: 'now', value: 'invalid' }],
          nextCursor: null,
        }),
    };
    await f.projector.refresh('s', context);
    expect((await f.store.load('s'))?.rows).toEqual([]);
    f.sources.billing = {
      readPage: async () =>
        await Promise.resolve({
          throughSequence: 1,
          rows: [{ recordId: 'b', sequence: 1, changedAt: 'now', value: 'valid' }],
          nextCursor: null,
        }),
    };
    await f.projector.refresh('s', context, true);
    const first = await f.store.load('s');
    await f.projector.refresh('s', context, true);
    expect((await f.store.load('s'))?.rows).toEqual(first?.rows);
  });
});
