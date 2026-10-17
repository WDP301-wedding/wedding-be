import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AnalyticsService } from './analytics.service.js';
import {
  AnalyticsProjector,
  type Projection,
  type ProjectionStore,
  type ProjectionRow,
} from './projection.js';
import {
  reportingOwners,
  type ReportingReader,
  type ReportingOwner,
} from '../../../core/reporting/reporting-feed.js';
import { analyticsResultSchemas } from '../http/analytics.schemas.js';
import type { BookingAnalyticsRow } from '../../booking-lifecycle/application/analytics-reporting.js';
import type { BillingAnalyticsRow } from '../../payments-billing/application/analytics-reporting.js';
import type { AnalyticsObserver } from './analytics-observation.js';
const now = '2026-10-13T00:00:00.000Z',
  hall = randomUUID(),
  menu = randomUUID(),
  serviceId = randomUUID(),
  version = randomUUID();
const ctx = {
  authority: 'AUTHENTICATED' as const,
  actorAccountId: randomUUID(),
  requestId: randomUUID(),
  causationId: randomUUID(),
};
const query = { dateFrom: '2026-10-13', dateTo: '2026-10-13' };
function booking(value: Partial<BookingAnalyticsRow> = {}): BookingAnalyticsRow {
  return {
    bookingId: randomUUID(),
    phase: 'CONFIRMED',
    eventDate: query.dateFrom,
    hallId: hall,
    hallNameSnapshot: 'Historical hall',
    shiftCode: 'LUNCH',
    menuPackageId: menu,
    menuNameSnapshot: 'Legacy menu',
    tableCount: 2,
    baseChargeVnd: 100,
    confirmedAt: now,
    cancelledAt: null,
    planningHeadcount: 300,
    originalContractTotalVnd: 200,
    approvedAppendixDeltaVnd: -20,
    effectiveAgreedTotalVnd: 180,
    commercialLines: [
      {
        category: 'MENU',
        sourceId: menu,
        sourceRevisionId: version,
        name: 'Historical menu',
        quantity: 2,
      },
      {
        category: 'SERVICE',
        sourceId: serviceId,
        sourceRevisionId: version,
        name: 'Historical MC',
        quantity: 1,
      },
    ],
    ...value,
  };
}
function bill(bookingId: string): BillingAnalyticsRow {
  return {
    bookingId,
    acceptedChargesVnd: 200,
    paidVnd: 120,
    refundedVnd: 10,
    outstandingVnd: 90,
    creditVnd: 0,
    finalInvoiceRevisionId: randomUUID(),
    finalizedIncidentalTotalVnd: 20,
    finalInvoiceTotalVnd: 200,
    ledger: [
      {
        ledgerEntryId: randomUUID(),
        kind: 'PAYMENT',
        amountVnd: 120,
        occurredAt: '2026-10-12T17:00:00Z',
        sourceRevisionId: null,
      },
      {
        ledgerEntryId: randomUUID(),
        kind: 'REFUND',
        amountVnd: 10,
        occurredAt: now,
        sourceRevisionId: null,
      },
      {
        ledgerEntryId: randomUUID(),
        kind: 'CHARGE',
        amountVnd: 200,
        occurredAt: now,
        sourceRevisionId: null,
      },
      {
        ledgerEntryId: randomUUID(),
        kind: 'PAYMENT',
        amountVnd: 999,
        occurredAt: '2026-10-13T17:00:00Z',
        sourceRevisionId: null,
      },
      {
        ledgerEntryId: randomUUID(),
        kind: 'PAYMENT',
        amountVnd: 999,
        occurredAt: '2026-10-12T16:59:59Z',
        sourceRevisionId: null,
      },
    ],
  };
}
function fixture() {
  const b = booking(),
    b2 = booking({ phase: 'CANCELLED', bookingId: randomUUID(), eventDate: '2026-10-15' });
  const rows: ProjectionRow[] = [];
  const add = (owner: ReportingOwner, recordId: string, value: unknown) =>
    rows.push({ owner, recordId, sequence: 1, changedAt: now, value });
  add('booking', b.bookingId, b);
  add('booking', b2.bookingId, b2);
  add('billing', b.bookingId, bill(b.bookingId));
  add('billing', b2.bookingId, { ...bill(b2.bookingId), creditVnd: 40 });
  add('guest', b.bookingId, {
    bookingId: b.bookingId,
    planningHeadcount: 300,
    listedGuestCount: 20,
    planSourceSequence: 4,
  });
  add('staff', b.bookingId, {
    bookingId: b.bookingId,
    checkInMode: 'NONE',
    measurementStatus: 'NOT_RECORDED',
    checkedInGuestCount: null,
    byGuestGroup: [],
    ledgerRevision: 0,
  });
  add('venue', '1', {
    observedAt: '2026-10-01T00:00:00Z',
    halls: [{ id: hall, active: true }],
    shifts: [
      { id: 'LUNCH', active: true },
      { id: 'DINNER', active: true },
    ],
  });
  add('invitation', randomUUID(), {
    bookingId: b.bookingId,
    printOrderId: randomUUID(),
    status: 'QUOTED',
    commercialRevisionId: null,
    receivableChargeId: null,
    acceptedAmountVnd: 0,
    approvedAt: null,
    updatedAt: now,
  });
  const p: Projection = {
    generationId: randomUUID(),
    rows,
    checkpoints: reportingOwners.map((owner) => ({
      owner,
      throughSequence: 1,
      refreshedAt: now,
      status: 'READY',
    })),
  };
  const store: ProjectionStore = {
    load: async () => await Promise.resolve(p),
    publish: async () => await Promise.resolve(p.generationId),
  };
  const empty: ReportingReader = {
    readPage: async () => await Promise.resolve({ throughSequence: 1, nextCursor: null, rows: [] }),
  };
  const projector = new AnalyticsProjector(
    { booking: empty, billing: empty, invitation: empty, guest: empty, staff: empty, venue: empty },
    store,
    () => new Date(now),
  );
  const api = new AnalyticsService(projector, store, () => new Date(now));
  return { b, b2, p, store, api, projector, add };
}
describe('ANL-W1/W3 deterministic source formulas and bounded queries', () => {
  it('shares only identical pending snapshots, then performs a new warm read', async () => {
    const state = fixture();
    let release!: (projection: Projection) => void;
    const pending = new Promise<Projection>((resolve) => {
      release = resolve;
    });
    const load = vi.spyOn(state.store, 'load').mockReturnValueOnce(pending);
    const reads = Array.from({ length: 4 }, () => state.api.query('revenue', query, ctx));
    expect(load).toHaveBeenCalledTimes(1);
    release(state.p);
    await Promise.all(reads);
    await state.api.query('revenue', query, ctx);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('does not share snapshots across scope or filters and evicts a rejected load', async () => {
    const state = fixture();
    let release!: (projection: Projection) => void;
    const pending = new Promise<Projection>((resolve) => {
      release = resolve;
    });
    const load = vi.spyOn(state.store, 'load').mockReturnValue(pending);
    const reads = [
      state.api.query('revenue', query, ctx),
      state.api.query('revenue', query, { ...ctx, actorAccountId: randomUUID() }),
      state.api.query('revenue', { ...query, hallId: randomUUID() }, ctx),
      state.api.query('attendance', query, ctx),
    ];
    expect(load).toHaveBeenCalledTimes(4);
    release(state.p);
    await Promise.all(reads);
    const failure = new Error('snapshot unavailable');
    load.mockRejectedValueOnce(failure).mockResolvedValue(state.p);
    await expect(state.api.query('revenue', query, ctx)).rejects.toBe(failure);
    await expect(state.api.query('revenue', query, ctx)).resolves.toBeDefined();
    expect(load).toHaveBeenCalledTimes(6);
  });
  it('propagates a shared snapshot rejection to all readers without retaining the failure', async () => {
    const state = fixture();
    let reject!: (error: Error) => void;
    const pending = new Promise<Projection>((_resolve, rejectPromise) => {
      reject = rejectPromise;
    });
    const load = vi
      .spyOn(state.store, 'load')
      .mockReturnValueOnce(pending)
      .mockResolvedValue(state.p);
    const reads = Array.from({ length: 4 }, () => state.api.query('revenue', query, ctx));
    const settled = Promise.allSettled(reads);
    const failure = new Error('pool unavailable');
    reject(failure);
    expect(
      (await settled).every((result) => result.status === 'rejected' && result.reason === failure),
    ).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    await expect(state.api.query('revenue', query, ctx)).resolves.toBeDefined();
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('does not join a pre-publication snapshot when reloading after refresh', async () => {
    const state = fixture();
    const stale: Projection = {
      ...state.p,
      checkpoints: state.p.checkpoints.map((checkpoint) => ({ ...checkpoint, status: 'STALE' })),
    };
    let releaseLoad!: (projection: Projection) => void;
    const loading = new Promise<Projection>((resolve) => {
      releaseLoad = resolve;
    });
    let releaseRefresh!: (generation: string) => void;
    const refreshing = new Promise<string>((resolve) => {
      releaseRefresh = resolve;
    });
    const load = vi
      .spyOn(state.store, 'load')
      .mockResolvedValueOnce(stale)
      .mockReturnValueOnce(loading)
      .mockResolvedValue(state.p);
    const refresh = vi
      .spyOn(state.projector, 'refresh')
      .mockReturnValueOnce(refreshing)
      .mockResolvedValue(state.p.generationId);
    const first = state.api.query('revenue', query, ctx);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    const second = state.api.query('revenue', query, ctx);
    expect(load).toHaveBeenCalledTimes(2);
    releaseRefresh(state.p.generationId);
    try {
      await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(3), { timeout: 1000 });
    } finally {
      releaseLoad(stale);
      await Promise.all([first, second]);
    }
  });
  it('observes one actual HTTP refresh leader and three waiters separately from warm reads', async () => {
    const state = fixture();
    state.p.checkpoints[0]!.status = 'STALE';
    const observe = vi.fn<AnalyticsObserver>();
    const service = new AnalyticsService(
      state.projector,
      state.store,
      () => new Date(now),
      undefined,
      observe,
    );
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const refresh = vi.spyOn(state.projector, 'refresh').mockImplementation(async () => {
      await blocked;
      state.p.checkpoints[0]!.status = 'READY';
      return state.p.generationId;
    });
    const requests = Array.from({ length: 4 }, () => ({ ...ctx, requestId: randomUUID() }));
    const reads = requests.map((context) => service.query('revenue', query, context));
    await vi.waitFor(() => expect(observe).toHaveBeenCalledTimes(4));
    const decisions = observe.mock.calls
      .map(([event]) => event)
      .filter((event) => event.event === 'analytics_query_decision');
    expect(decisions).toHaveLength(4);
    expect(decisions.map((event) => event.path).sort()).toEqual([
      'refresh-joined',
      'refresh-joined',
      'refresh-joined',
      'refresh-started',
    ]);
    expect(new Set(decisions.map((event) => event.requestId)).size).toBe(4);
    release();
    await Promise.all(reads);
    expect(refresh).toHaveBeenCalledExactlyOnceWith(ctx.actorAccountId, requests[0], false, 'http');
    await service.query('revenue', query, { ...ctx, requestId: randomUUID() });
    expect(observe).toHaveBeenLastCalledWith(
      expect.objectContaining({
        event: 'analytics_query_decision',
        path: 'warm',
        report: 'revenue',
        entryPoint: 'http',
      }),
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('distinguishes TTL, source failure, invalidation and missing generation without refreshing a pinned cursor', async () => {
    const state = fixture();
    const observe = vi.fn<AnalyticsObserver>();
    const invalidated = vi.fn(() => Promise.resolve(false));
    const service = new AnalyticsService(
      state.projector,
      state.store,
      () => new Date(now),
      invalidated,
      observe,
    );
    const refresh = vi.spyOn(state.projector, 'refresh').mockResolvedValue(state.p.generationId);
    state.p.checkpoints[0]!.refreshedAt = '2026-10-12T00:00:00.000Z';
    await service.query('revenue', query, ctx);
    expect(observe).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: 'refresh-started', reason: 'ttl' }),
    );
    state.p.checkpoints[0]!.status = 'SOURCE_NOT_READY';
    await service.query('revenue', query, ctx);
    expect(observe).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: 'source-not-ready' }),
    );
    state.p.checkpoints[0]!.status = 'READY';
    state.p.checkpoints[0]!.refreshedAt = now;
    invalidated.mockResolvedValueOnce(true);
    await service.query('revenue', query, ctx);
    expect(observe).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'invalidated' }));
    const extra = booking();
    state.add('booking', extra.bookingId, extra);
    const first = analyticsResultSchemas.bookings.parse(
      await service.query('bookings', { ...query, pageSize: 1 }, ctx),
    );
    expect(first.nextCursor).not.toBeNull();
    const refreshes = refresh.mock.calls.length;
    state.p.checkpoints[0]!.status = 'STALE';
    await service.query('bookings', { ...query, pageSize: 1, cursor: first.nextCursor }, ctx);
    expect(observe).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: 'pinned', reason: 'source-not-ready' }),
    );
    expect(refresh).toHaveBeenCalledTimes(refreshes);
    state.store.load = () => Promise.resolve(null);
    await expect(service.query('revenue', query, ctx)).rejects.toMatchObject({
      code: 'ANALYTICS_NOT_READY',
    });
    expect(observe).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: 'refresh-started', reason: 'missing' }),
    );
  });

  it('coalesces concurrent automatic refreshes by actor scope without caching warm responses', async () => {
    const f = fixture();
    f.p.checkpoints.forEach((c) => {
      c.status = 'STALE';
    });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const refresh = vi.spyOn(f.projector, 'refresh').mockImplementation(async () => {
      await blocked;
      f.p.checkpoints.forEach((c) => {
        c.status = 'READY';
      });
      return f.p.generationId;
    });
    const reads = Array.from({ length: 4 }, () => f.api.query('revenue', query, ctx));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    release();
    const results = await Promise.all(reads);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.meta.generationId === f.p.generationId)).toBe(true);
    await f.api.query('revenue', query, ctx);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it('never coalesces different Manager scopes and clears failed refresh work', async () => {
    const f = fixture();
    f.p.checkpoints[0]!.status = 'STALE';
    const refresh = vi
      .spyOn(f.projector, 'refresh')
      .mockRejectedValue(new Error('source unavailable'));
    await expect(
      Promise.all([
        f.api.query('revenue', query, ctx),
        f.api.query('revenue', query, { ...ctx, actorAccountId: randomUUID() }),
      ]),
    ).rejects.toThrow('source unavailable');
    expect(refresh).toHaveBeenCalledTimes(2);
    refresh.mockResolvedValue(f.p.generationId);
    await f.api.query('revenue', query, ctx);
    expect(refresh).toHaveBeenCalledTimes(3);
  });
  it('separates cash dates from event dates and takes balances from Billing once', async () => {
    const f = fixture();
    const r = analyticsResultSchemas.revenue.parse(await f.api.query('revenue', query, ctx));
    expect(r).toMatchObject({
      grossCashReceivedVnd: 240,
      cashRefundedVnd: 20,
      netCashRevenueVnd: 220,
      receivablesVnd: 90,
      creditBalanceVnd: 0,
      acceptedChargesVnd: 200,
      settledPaymentsVnd: 120,
      settledRefundsVnd: 10,
      netSettledVnd: 110,
      originalContractTotalVnd: 200,
      approvedAppendixDeltaVnd: -20,
      effectiveAgreedTotalVnd: 180,
      finalizedIncidentalTotalVnd: 20,
      finalInvoiceTotalVnd: 200,
      finalizedInvoiceCount: 1,
    });
    const r2 = analyticsResultSchemas.revenue.parse(
      await f.api.query('revenue', { ...query, dateTo: '2026-10-15' }, ctx),
    );
    expect(r2.creditBalanceVnd).toBe(40);
  });
  it('uses immutable multi-menu/service versions and proves date-start availability independently of other filters', async () => {
    const f = fixture();
    const overview = analyticsResultSchemas.overview.parse(
      await f.api.query(
        'overview',
        { ...query, hallId: hall, phase: 'CONFIRMED', menuPackageId: menu },
        ctx,
      ),
    );
    expect(overview.hallUtilization).toEqual({
      occupiedSlots: 1,
      availableSlots: 2,
      rate: 0.5,
      status: 'READY',
    });
    expect(overview.servicePopularity[0]).toMatchObject({
      sourceId: serviceId,
      nameSnapshot: 'Historical MC',
      quantity: 1,
      bookingCount: 1,
    });
    const b3 = booking({
      shiftCode: 'DINNER',
      commercialLines: [
        {
          category: 'MENU',
          sourceId: menu,
          sourceRevisionId: version,
          name: 'Historical menu',
          quantity: 3,
        },
        {
          category: 'MENU',
          sourceId: randomUUID(),
          sourceRevisionId: randomUUID(),
          name: 'Menu B',
          quantity: 2,
        },
      ],
    });
    f.add('booking', b3.bookingId, b3);
    const report = analyticsResultSchemas.bookings.parse(await f.api.query('bookings', query, ctx));
    expect(report.items.find((b) => b.bookingId === b3.bookingId)?.tableCount).toBe(5);
    expect(report.menuPopularity.find((p) => p.sourceId === menu)?.bookingCount).toBe(2);
    expect(report.menuPopularity.find((p) => p.sourceId === menu)?.quantity).toBe(5);
    expect(
      analyticsResultSchemas.bookings.parse(
        await f.api.query('bookings', { ...query, phase: 'DRAFT' }, ctx),
      ).items,
    ).toEqual([]);
    expect(
      analyticsResultSchemas.bookings.parse(
        await f.api.query('bookings', { ...query, menuPackageId: randomUUID() }, ctx),
      ).items,
    ).toEqual([]);
  });
  it('returns unknown historical availability and zero-denominator null separately', async () => {
    const f = fixture();
    const old = analyticsResultSchemas.bookings.parse(
      await f.api.query('bookings', { dateFrom: '2026-09-01', dateTo: '2026-09-01' }, ctx),
    );
    expect(old.hallUtilization).toMatchObject({
      availableSlots: null,
      rate: null,
      status: 'SOURCE_NOT_READY',
    });
    const unavailable = analyticsResultSchemas.bookings.parse(
      await f.api.query('bookings', { ...query, hallId: randomUUID() }, ctx),
    );
    expect(unavailable.hallUtilization).toMatchObject({
      availableSlots: 0,
      rate: null,
      status: 'NO_AVAILABLE_SLOTS',
    });
  });
  it('bounds calendar iteration at year 9999 and normalizes UUID filters', async () => {
    const f = fixture();
    const result = analyticsResultSchemas.bookings.parse(
      await f.api.query('bookings', { dateFrom: '9999-12-31', dateTo: '9999-12-31' }, ctx),
    );
    expect(result.items).toEqual([]);
    expect(result.hallUtilization.availableSlots).toBe(2);
    expect(
      analyticsResultSchemas.bookings.parse(
        await f.api.query(
          'bookings',
          { ...query, hallId: hall.toUpperCase(), menuPackageId: menu.toUpperCase() },
          ctx,
        ),
      ).items,
    ).toHaveLength(1);
    await expect(
      f.api.query('bookings', { dateFrom: '0001-01-01', dateTo: '0001-01-01' }, ctx),
    ).rejects.toMatchObject({ status: 422 });
  });
  it('preserves legacy menu history and handles bookings without a menu', async () => {
    const f = fixture();
    const legacy = booking({ commercialLines: [], menuNameSnapshot: null });
    f.add('booking', legacy.bookingId, legacy);
    const noMenu = booking({ commercialLines: [], menuPackageId: null });
    f.add('booking', noMenu.bookingId, noMenu);
    const report = analyticsResultSchemas.bookings.parse(
      await f.api.query('bookings', { ...query, menuPackageId: menu }, ctx),
    );
    expect(report.items).toHaveLength(2);
    expect(report.menuPopularity.some((p) => p.sourceRevisionId === null)).toBe(true);
    expect(
      analyticsResultSchemas.bookings.parse(await f.api.query('bookings', query, ctx)).items,
    ).toHaveLength(3);
  });
  it('marks inconsistent owner inventory unavailable instead of emitting an impossible ratio', async () => {
    const f = fixture();
    f.p.rows.splice(0, f.p.rows.length, ...f.p.rows.filter((r) => r.owner !== 'venue'));
    f.add('venue', '1', { observedAt: '2026-10-01T00:00:00Z', halls: [], shifts: [] });
    const r = analyticsResultSchemas.bookings.parse(await f.api.query('bookings', query, ctx));
    expect(r.hallUtilization).toMatchObject({
      occupiedSlots: 1,
      rate: null,
      status: 'SOURCE_NOT_READY',
    });
  });
  it('does not fabricate attendance when a provider is absent; labels known zero and partial lists', async () => {
    const f = fixture();
    f.p.rows.splice(
      0,
      f.p.rows.length,
      ...f.p.rows.filter((r) => r.owner !== 'guest' && r.owner !== 'staff'),
    );
    expect(
      analyticsResultSchemas.attendance.parse(await f.api.query('attendance', query, ctx)).items[0],
    ).toMatchObject({
      planningHeadcount: 300,
      listedGuestCount: null,
      checkInMode: null,
      measurementStatus: 'SOURCE_NOT_READY',
      checkedInGuestCount: null,
    });
    f.add('staff', f.b.bookingId, {
      bookingId: f.b.bookingId,
      checkInMode: 'BY_GUEST_NAME',
      measurementStatus: 'LISTED_GUESTS_ONLY',
      checkedInGuestCount: 0,
      byGuestGroup: [],
      ledgerRevision: 0,
    });
    expect(
      analyticsResultSchemas.attendance.parse(await f.api.query('attendance', query, ctx)).items[0]
        ?.checkedInGuestCount,
    ).toBe(0);
  });
  it('excludes quoted print amounts from receivables and reports empty matches distinctly', async () => {
    const f = fixture();
    const print = analyticsResultSchemas['print-orders'].parse(
      await f.api.query('print-orders', query, ctx),
    );
    expect(print.statusCounts).toEqual([{ status: 'QUOTED', count: 1 }]);
    expect(print.items[0]?.acceptedAmountVnd).toBe(0);
    expect(
      analyticsResultSchemas['print-orders'].parse(
        await f.api.query('print-orders', { ...query, hallId: randomUUID() }, ctx),
      ).items,
    ).toEqual([]);
  });
  it('binds cursors to generation/report/scope/filters and enforces the row budget', async () => {
    const f = fixture();
    f.add('booking', f.b2.bookingId, booking({ bookingId: f.b2.bookingId, shiftCode: 'DINNER' }));
    // Replace the old record rather than retaining two versions in a projection.
    f.p.rows.splice(
      0,
      f.p.rows.length,
      ...f.p.rows.filter(
        (r, i, all) =>
          all.findLastIndex((x) => x.owner === r.owner && x.recordId === r.recordId) === i,
      ),
    );
    const first = analyticsResultSchemas.bookings.parse(
      await f.api.query('bookings', { ...query, pageSize: 1 }, ctx),
    );
    expect(first.nextCursor).not.toBeNull();
    const second = analyticsResultSchemas.bookings.parse(
      await f.api.query('bookings', { ...query, pageSize: 1, cursor: first.nextCursor! }, ctx),
    );
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.bookingId).not.toBe(first.items[0]?.bookingId);
    for (const [report, q, c] of [
      ['bookings', { ...query, pageSize: 2 }, ctx],
      ['attendance', { ...query, pageSize: 1 }, ctx],
      ['bookings', { ...query, pageSize: 1 }, { ...ctx, actorAccountId: randomUUID() }],
    ] as const)
      await expect(
        f.api.query(report, { ...q, cursor: first.nextCursor }, c),
      ).rejects.toMatchObject({ code: 'ANALYTICS_CURSOR_STALE' });
    f.p.generationId = randomUUID();
    await expect(
      f.api.query('bookings', { ...query, pageSize: 1, cursor: first.nextCursor }, ctx),
    ).rejects.toMatchObject({ code: 'ANALYTICS_CURSOR_STALE' });
    await expect(
      f.api.query('bookings', { ...query, cursor: 'invalid' }, ctx),
    ).rejects.toMatchObject({ status: 422 });
    for (let i = 0; i < 10000; i++) f.add('booking', randomUUID(), f.b);
    await expect(f.api.query('bookings', query, ctx)).rejects.toMatchObject({
      code: 'ANALYTICS_QUERY_TOO_BROAD',
    });
  });
  it('reports stale timestamps, preserves failed sources and refreshes invalidations', async () => {
    const f = fixture();
    const refresh = vi.spyOn(f.projector, 'refresh').mockResolvedValue(f.p.generationId);
    f.p.checkpoints[0]!.refreshedAt = '2026-10-12T00:00:00.000Z';
    let r = analyticsResultSchemas.revenue.parse(await f.api.query('revenue', query, ctx));
    expect(r.meta.status).toBe('STALE');
    expect(refresh).toHaveBeenCalled();
    f.p.checkpoints.find((c) => c.owner === 'billing')!.status = 'SOURCE_NOT_READY';
    f.p.checkpoints.find((c) => c.owner === 'billing')!.refreshedAt = null;
    r = analyticsResultSchemas.revenue.parse(await f.api.query('revenue', query, ctx));
    expect(r.meta.status).toBe('SOURCE_NOT_READY');
    expect(r.netCashRevenueVnd).toBeNull();
    f.p.checkpoints.forEach((c) => {
      c.refreshedAt = null;
      c.status = 'SOURCE_NOT_READY';
    });
    expect(
      analyticsResultSchemas.revenue.parse(await f.api.query('revenue', query, ctx)).meta
        .refreshedAt,
    ).toBeNull();
    const normal = fixture();
    const r2 = vi.spyOn(normal.projector, 'refresh').mockResolvedValue(normal.p.generationId);
    const api = new AnalyticsService(
      normal.projector,
      normal.store,
      () => new Date(now),
      async () => await Promise.resolve(true),
    );
    await api.query('revenue', query, ctx);
    expect(r2).toHaveBeenCalled();
  });
  it('recovers a concurrent refresh winner, propagates failures and rejects missing sources/invalid dates', async () => {
    const f = fixture();
    f.p.checkpoints[0]!.status = 'STALE';
    const { AppError } = await import('../../../core/errors/app-error.js');
    const refresh = vi
      .spyOn(f.projector, 'refresh')
      .mockRejectedValue(
        new AppError({ status: 409, code: 'ANALYTICS_REFRESH_CONFLICT', message: 'retry' }),
      );
    await expect(f.api.query('revenue', query, ctx)).resolves.toBeDefined();
    refresh.mockRejectedValue(new Error('failed'));
    await expect(f.api.query('revenue', query, ctx)).rejects.toThrow('failed');
    refresh.mockResolvedValue(randomUUID());
    f.store.load = async () => await Promise.resolve(null);
    await expect(f.api.query('revenue', query, ctx)).rejects.toMatchObject({
      code: 'ANALYTICS_NOT_READY',
    });
    await expect(
      f.api.query('revenue', { ...query, dateTo: '2026-10-12' }, ctx),
    ).rejects.toMatchObject({ status: 422 });
  });
});
