import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../core/errors/app-error.js';
import { reportingOwners, type ReportingReader } from '../../../core/reporting/reporting-feed.js';
import { AnalyticsProjector, type Projection, type ProjectionStore } from './projection.js';
import type { AnalyticsObservation, AnalyticsObserver } from './analytics-observation.js';

function fixture() {
  let saved: Projection | null = null;
  const generationId = randomUUID();
  const observations: AnalyticsObservation[] = [];
  const observe = vi.fn<AnalyticsObserver>((event) => {
    observations.push(event);
  });
  const load = vi.fn<ProjectionStore['load']>(() => Promise.resolve(saved));
  const publish = vi.fn<ProjectionStore['publish']>((_scope, _expected, projection) => {
    saved = { ...projection, generationId };
    return Promise.resolve(generationId);
  });
  const store: ProjectionStore = { load, publish };
  const source = () => ({
    readPage: vi.fn<ReportingReader['readPage']>(() =>
      Promise.resolve({ throughSequence: 0, rows: [], nextCursor: null }),
    ),
  });
  const sources = {
    booking: source(),
    billing: source(),
    invitation: source(),
    guest: source(),
    staff: source(),
    venue: source(),
  };
  const context = {
    authority: 'AUTHENTICATED' as const,
    actorAccountId: randomUUID(),
    requestId: randomUUID(),
    causationId: randomUUID(),
  };
  const projector = new AnalyticsProjector(
    sources,
    store,
    () => new Date('2026-10-17T02:00:00Z'),
    undefined,
    observe,
  );
  return { sources, store, load, publish, projector, context, observations, observe, generationId };
}

describe('PERF-10 actual refresh observations', () => {
  it('counts source work and attributes scheduler publication without logging actor scope', async () => {
    const state = fixture();
    const result = await state.projector.refresh(
      state.context.actorAccountId,
      state.context,
      false,
      'scheduler',
    );
    expect(result).toBe(state.generationId);
    expect(state.observations).toHaveLength(2);
    const started = state.observations.find(
      (event) => event.event === 'analytics_refresh_started',
    )!;
    const completed = state.observations.find(
      (event) => event.event === 'analytics_refresh_completed',
    )!;
    expect(started).toMatchObject({
      event: 'analytics_refresh_started',
      entryPoint: 'scheduler',
      mode: 'incremental',
      requestId: state.context.requestId,
      scopeDigest: createHash('sha256').update(state.context.actorAccountId).digest('hex'),
    });
    expect(completed).toMatchObject({
      event: 'analytics_refresh_completed',
      refreshId: started.refreshId,
      entryPoint: 'scheduler',
      outcome: 'published',
      generationId: state.generationId,
      sourcePageCount: 6,
      sourceRowCount: 0,
      sourceFailures: 0,
    });
    expect(
      completed.owners.map((owner) => ({
        owner: owner.owner,
        pages: owner.pages,
        rows: owner.rows,
        status: owner.status,
      })),
    ).toEqual(reportingOwners.map((owner) => ({ owner, pages: 1, rows: 0, status: 'READY' })));
    for (const owner of completed.owners) expect(owner.durationMs).toBeGreaterThanOrEqual(0);
    expect(completed.durationMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(state.observations)).not.toContain(state.context.actorAccountId);
  });

  it('retains publication conflicts as conflicts and preserves the exact rejection', async () => {
    const state = fixture();
    const failure = new AppError({
      status: 409,
      code: 'ANALYTICS_REFRESH_CONFLICT',
      message: 'private failure detail',
    });
    state.publish.mockRejectedValueOnce(failure);
    await expect(
      state.projector.refresh(state.context.actorAccountId, state.context, false, 'http'),
    ).rejects.toBe(failure);
    expect(state.observations.at(-1)).toMatchObject({
      entryPoint: 'http',
      outcome: 'conflict',
      errorCode: 'ANALYTICS_REFRESH_CONFLICT',
      sourcePageCount: 6,
    });
    expect(JSON.stringify(state.observations)).not.toContain(failure.message);
  });

  it('reports early failures without exposing their contents or inventing source work', async () => {
    const state = fixture();
    const failure = new Error('secret@example.test credential payload');
    state.load.mockRejectedValueOnce(failure);
    await expect(state.projector.refresh(state.context.actorAccountId, state.context)).rejects.toBe(
      failure,
    );
    expect(state.observations.at(-1)).toMatchObject({
      entryPoint: 'cli',
      outcome: 'failed',
      errorCode: 'ANALYTICS_REFRESH_FAILED',
      sourcePageCount: 0,
      sourceRowCount: 0,
    });
    expect(JSON.stringify(state.observations)).not.toContain(failure.message);
  });

  it('distinguishes degraded incremental publication from a failed rebuild', async () => {
    const state = fixture();
    vi.mocked(state.sources.billing.readPage).mockRejectedValue(
      new Error('private source payload'),
    );
    await state.projector.refresh(state.context.actorAccountId, state.context, false, 'http');
    expect(state.observations.at(-1)).toMatchObject({
      outcome: 'published',
      sourceFailures: 1,
    });
    await expect(
      state.projector.refresh(state.context.actorAccountId, state.context, true, 'http'),
    ).rejects.toMatchObject({ code: 'ANALYTICS_REBUILD_FAILED' });
    expect(state.observations.at(-1)).toMatchObject({
      mode: 'rebuild',
      outcome: 'failed',
      errorCode: 'ANALYTICS_REBUILD_FAILED',
    });
    expect(JSON.stringify(state.observations)).not.toContain('private source payload');
  });

  it('counts multiple source pages and rows without serializing source contents', async () => {
    const state = fixture();
    state.sources.booking.readPage.mockImplementation((query) =>
      Promise.resolve({
        throughSequence: 2,
        nextCursor: query.cursor ? null : 'next',
        rows: [
          {
            recordId: query.cursor ? 'second' : 'first',
            sequence: query.cursor ? 2 : 1,
            changedAt: '2026-10-17T02:00:00Z',
            value: { email: 'never-log@example.test', amountVnd: 987654321 },
          },
        ],
      }),
    );
    await state.projector.refresh(state.context.actorAccountId, state.context);
    expect(state.observations.at(-1)).toMatchObject({
      sourcePageCount: 7,
      sourceRowCount: 2,
      sourceFailures: 0,
    });
    expect(JSON.stringify(state.observations)).not.toContain('never-log@example.test');
    expect(JSON.stringify(state.observations)).not.toContain('987654321');
    const failure = new AppError({
      status: 500,
      code: 'UNTRUSTED_SECRET_CODE',
      message: 'private',
    });
    state.load.mockRejectedValueOnce(failure);
    await expect(state.projector.refresh(state.context.actorAccountId, state.context)).rejects.toBe(
      failure,
    );
    expect(state.observations.at(-1)).toMatchObject({ errorCode: 'ANALYTICS_REFRESH_FAILED' });
    expect(JSON.stringify(state.observations)).not.toContain(failure.code);
  });

  it('never lets an observation sink replace a successful result or a domain failure', async () => {
    const state = fixture();
    state.observe.mockImplementation(() => {
      throw Error('observer unavailable');
    });
    await expect(
      state.projector.refresh(state.context.actorAccountId, state.context),
    ).resolves.toBe(state.generationId);
    const failure = new Error('source store unavailable');
    state.load.mockRejectedValueOnce(failure);
    await expect(state.projector.refresh(state.context.actorAccountId, state.context)).rejects.toBe(
      failure,
    );
  });
});
