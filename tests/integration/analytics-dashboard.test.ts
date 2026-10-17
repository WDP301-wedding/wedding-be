import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/core/logging/logger.js';
import { createAnalyticsServices } from '../../src/modules/analytics-dashboard/infrastructure/analytics.composition.js';
import { createAnalyticsRouter } from '../../src/modules/analytics-dashboard/http/analytics.router.js';
import { analyticsResultSchemas } from '../../src/modules/analytics-dashboard/http/analytics.schemas.js';
import { createStaffServices } from '../../src/modules/staff-operations/infrastructure/staff.composition.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';
import { bookingAnalyticsSchema } from '../../src/modules/booking-lifecycle/application/analytics-reporting.js';
import type {
  AnalyticsObservation,
  AnalyticsObserver,
} from '../../src/modules/analytics-dashboard/application/analytics-observation.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)('SPEC-10 real owners and HTTP', () => {
  const db = new CatalogTestDatabase('analytics');
  beforeAll(() => db.connect(), 60000);
  afterAll(() => db.disconnect());
  async function fixture(observe?: AnalyticsObserver) {
    const f = await studioFixture(db.prisma),
      s = createAnalyticsServices(db.prisma, undefined, observe),
      b = await db.prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
    const date = b.eventDate.toISOString().slice(0, 10),
      filter = `dateFrom=${date}&dateTo=${date}&hallId=${b.hallId}`;
    const context = {
      authority: 'AUTHENTICATED' as const,
      actorAccountId: f.manager.actorId,
      requestId: randomUUID(),
      causationId: randomUUID(),
    };
    const app = createApp({
      logger: createLogger({ level: 'silent', runtimeEnvironment: 'test' }),
      registerRoutes: (a) =>
        a.use('/api/v1', createAnalyticsRouter(s.service, s.resolver, s.audit)),
    });
    const get = (report: string, token = f.manager.accessToken, query = filter) =>
      request(app)
        .get('/api/v1/management/analytics/' + report + '?' + query)
        .auth(token, { type: 'bearer' });
    return { f, s, b, context, app, get, filter, date };
  }
  it('PERF-10 correlates four real HTTP reads to one refresh and keeps subsequent warm reads separate', async () => {
    const observations: AnalyticsObservation[] = [];
    const { f, s, get } = await fixture((event) => {
      observations.push(event);
    });
    const read = s.sources.booking.readPage.bind(s.sources.booking);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = vi
      .spyOn(s.sources.booking, 'readPage')
      .mockImplementationOnce(async (query, context) => {
        const page = await read(query, context);
        await blocked;
        return page;
      });
    const requests = Promise.all(
      Array.from({ length: 4 }, () => get('overview').then((response) => response)),
    );
    try {
      await vi.waitFor(
        () =>
          expect(
            observations.filter(
              (event) =>
                event.event === 'analytics_query_decision' && event.path === 'refresh-joined',
            ),
          ).toHaveLength(3),
        { timeout: 10000 },
      );
    } finally {
      release();
    }
    const responses = await requests;
    original.mockRestore();
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
    const starts = observations.filter((event) => event.event === 'analytics_refresh_started');
    const completed = observations.filter((event) => event.event === 'analytics_refresh_completed');
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({ entryPoint: 'http', mode: 'incremental' });
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ outcome: 'published', sourcePageCount: 6 });
    const decisions = observations.filter((event) => event.event === 'analytics_query_decision');
    expect(new Set(decisions.map((event) => event.requestId))).toEqual(
      new Set(responses.map((response) => response.headers['x-request-id'] as string)),
    );
    expect((await get('overview')).status).toBe(200);
    expect(observations.at(-1)).toMatchObject({ event: 'analytics_query_decision', path: 'warm' });
    expect(
      observations.filter((event) => event.event === 'analytics_refresh_started'),
    ).toHaveLength(1);
    expect(JSON.stringify(observations)).not.toContain(f.manager.accessToken);
    expect(JSON.stringify(observations)).not.toContain(f.manager.actorId);
  }, 30000);

  it('PERF-10 rechecks the requesting session after waiting for projection refresh', async () => {
    const { f, s, get } = await fixture();
    const read = s.sources.booking.readPage.bind(s.sources.booking);
    const pending = vi.spyOn(s.sources.booking, 'readPage').mockImplementationOnce(async (q, c) => {
      const rows = await read(q, c);
      await db.prisma.session.update({
        where: { id: f.manager.sessionId },
        data: { status: 'REVOKED' },
      });
      return rows;
    });
    try {
      expect((await get('overview')).status).toBe(401);
    } finally {
      pending.mockRestore();
    }
  });
  it('mounts five strict reports, rechecks roles, minimizes data, and supports no names/NONE', async () => {
    const { f, s, b, context, app, get } = await fixture();
    for (const report of Object.keys(
      analyticsResultSchemas,
    ) as (keyof typeof analyticsResultSchemas)[]) {
      const r = await get(report);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      analyticsResultSchemas[report].parse((r.body as { data: unknown }).data);
      expect(r.headers['cache-control']).toBe('no-store');
      expect((await get(report, f.couple.accessToken)).status).toBe(403);
    }
    expect((await request(app).get('/api/v1/management/analytics/overview')).status).toBe(401);
    const exported = await request(app)
      .get('/api/v1/management/analytics/exports/overview')
      .query({
        dateFrom: b.eventDate.toISOString().slice(0, 10),
        dateTo: b.eventDate.toISOString().slice(0, 10),
        hallId: b.hallId,
      })
      .auth(f.manager.accessToken, { type: 'bearer' });
    expect(exported.status).toBe(200);
    expect(exported.headers['content-disposition']).toContain('analytics-overview.json');
    const audit = await db.prisma.auditLog.findFirst({
      where: { action: 'analytics.exported', actorId: f.manager.actorId },
    });
    expect(audit?.metadata).toMatchObject({ resultSize: 1, filters: { hallId: b.hallId } });
    expect(JSON.stringify(audit?.metadata)).not.toMatch(
      /menuPopularity|servicePopularity|checkedInGuestCount/u,
    );
    const proposal = await db.prisma.bookingProposalSnapshot.findUniqueOrThrow({
      where: { bookingId: f.bookingId },
    });
    for (const filters of [
      {
        dateFrom: b.eventDate.toISOString().slice(0, 10),
        dateTo: b.eventDate.toISOString().slice(0, 10),
      },
      {
        dateFrom: b.eventDate.toISOString().slice(0, 10),
        dateTo: b.eventDate.toISOString().slice(0, 10),
        phase: 'CONFIRMED',
        menuPackageId: proposal.menuPackageId,
      },
    ]) {
      const extra = await request(app)
        .get('/api/v1/management/analytics/exports/overview')
        .query(filters)
        .auth(f.manager.accessToken, { type: 'bearer' });
      expect(extra.status, JSON.stringify(extra.body)).toBe(200);
    }
    const attendance = analyticsResultSchemas.attendance.parse(
      ((await get('attendance')).body as { data: unknown }).data,
    );
    expect(attendance.items).toContainEqual({
      bookingId: f.bookingId,
      planningHeadcount: b.planningHeadcount,
      listedGuestCount: 0,
      checkInMode: 'NONE',
      measurementStatus: 'NOT_RECORDED',
      checkedInGuestCount: null,
      byGuestGroup: [],
    });
    expect(JSON.stringify(attendance)).not.toMatch(
      /phone|operationalNote|tokenHash|accessToken|turnoutRate|responseStatus/u,
    );
    const before = await s.store.load(context.actorAccountId);
    await s.projector.refresh(context.actorAccountId, context, true);
    expect(
      (await s.store.load(context.actorAccountId))?.rows
        .map((r) => [r.owner, r.recordId, r.sequence, r.value])
        .sort(),
    ).toEqual(before?.rows.map((r) => [r.owner, r.recordId, r.sequence, r.value]).sort());
    await db.prisma.accountRole.deleteMany({
      where: { accountId: f.manager.actorId, role: 'MANAGER' },
    });
    expect((await get('attendance')).status).toBe(403);
    await expect(
      s.sources.booking.readPage({ afterSequence: 0, limit: 1 }, context),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('projects real enable/check-in/retry/undo/archive and retained Group history independently of planning', async () => {
    const { f, b, s, get } = await fixture();
    const staff = createStaffServices(db.prisma);
    const [group] = await staff.guests.guests.groups(f.bookingId, f.couple);
    const guest = await staff.guests.guests.createGuest(
      f.bookingId,
      {
        guestGroupId: group!.guestGroupId,
        name: 'Nguyễn An',
        phone: '+84912345678',
        operationalNote: 'PRIVATE-CANARY',
      },
      randomUUID(),
      f.couple,
    );
    await staff.staff.configure(
      f.bookingId,
      { checkInMode: 'BY_GUEST_NAME', expectedRevision: 1 },
      randomUUID(),
      f.couple,
    );
    let result = analyticsResultSchemas.attendance.parse(
      ((await get('attendance')).body as { data: unknown }).data,
    );
    expect(result.items[0]).toMatchObject({
      planningHeadcount: b.planningHeadcount,
      listedGuestCount: 1,
      checkedInGuestCount: 0,
      measurementStatus: 'LISTED_GUESTS_ONLY',
    });
    const key = randomUUID(),
      record = await staff.journal.checkIn(
        f.bookingId,
        guest.guestId,
        { overrideReason: 'Isolated analytics test' },
        key,
        f.manager,
      );
    expect(
      await staff.journal.checkIn(
        f.bookingId,
        guest.guestId,
        { overrideReason: 'Isolated analytics test' },
        key,
        f.manager,
      ),
    ).toEqual(record);
    await staff.guests.guests.updateGroup(
      f.bookingId,
      group!.guestGroupId,
      { expectedRevision: 1, name: 'Renamed group' },
      randomUUID(),
      f.couple,
    );
    await staff.guests.guests.updateGuest(
      f.bookingId,
      guest.guestId,
      { expectedRevision: 1, status: 'ARCHIVED' },
      randomUUID(),
      f.couple,
    );
    result = analyticsResultSchemas.attendance.parse(
      ((await get('attendance')).body as { data: unknown }).data,
    );
    expect(result.items[0]).toMatchObject({
      planningHeadcount: b.planningHeadcount,
      listedGuestCount: 0,
      checkedInGuestCount: 1,
      byGuestGroup: [
        {
          guestGroupId: group!.guestGroupId,
          groupNameSnapshot: group!.name,
          checkedInGuestCount: 1,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE-CANARY');
    // Undo still requires the named Guest to be active; restore before the authorized correction.
    await staff.guests.guests.updateGuest(
      f.bookingId,
      guest.guestId,
      { expectedRevision: 2, status: 'ACTIVE' },
      randomUUID(),
      f.couple,
    );
    await staff.journal.undo(
      f.bookingId,
      guest.guestId,
      {
        checkInRecordId: record.checkInRecordId,
        expectedLedgerRevision: 1,
        reason: 'Correction',
        overrideReason: 'Isolated analytics test',
      },
      randomUUID(),
      f.manager,
    );
    result = analyticsResultSchemas.attendance.parse(
      ((await get('attendance')).body as { data: unknown }).data,
    );
    expect(result.items[0]).toMatchObject({
      listedGuestCount: 1,
      checkedInGuestCount: 0,
      planningHeadcount: b.planningHeadcount,
    });
    expect(
      (await db.prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } })).planningHeadcount,
    ).toBe(b.planningHeadcount);
    expect(
      (
        await s.sources.staff.readPage(
          { afterSequence: 0, limit: 500 },
          {
            authority: 'AUTHENTICATED',
            actorAccountId: f.manager.actorId,
            requestId: randomUUID(),
            causationId: randomUUID(),
          },
        )
      ).rows.length,
    ).toBeGreaterThan(1);
  });
  it('rejects invalid filters/cursors; freezes owner fences, survives refresh races/rollback and audits rebuild', async () => {
    const { f, s, context, get, app, filter } = await fixture();
    for (const q of [
      'dateFrom=2026-02-30&dateTo=2026-03-01',
      'dateFrom=2025-01-01&dateTo=2026-10-13',
      filter + '&pageSize=101',
      filter + '&unknown=1',
      filter + '&cursor=bad',
    ])
      expect((await get('bookings', f.manager.accessToken, q)).status).toBe(422);
    const page = await s.sources.booking.readPage({ afterSequence: 0, limit: 1 }, context);
    expect(page.nextCursor).not.toBeNull();
    const next = await s.sources.booking.readPage(
      {
        afterSequence: 0,
        limit: 1,
        throughSequence: page.throughSequence,
        cursor: page.nextCursor!,
      },
      context,
    );
    expect(next.throughSequence).toBe(page.throughSequence);
    await expect(
      s.sources.booking.readPage(
        {
          afterSequence: 0,
          limit: 1,
          throughSequence: page.throughSequence + 1,
          cursor: page.nextCursor!,
        },
        context,
      ),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      s.sources.guest.readPage(
        {
          afterSequence: 0,
          limit: 1,
          cursor: page.nextCursor!,
          throughSequence: page.throughSequence,
        },
        context,
      ),
    ).rejects.toMatchObject({ status: 422 });
    await s.projector.refresh(context.actorAccountId, context);
    const initial = await s.store.load(context.actorAccountId);
    const race = await Promise.allSettled([
      s.store.publish(context.actorAccountId, initial!.generationId, initial!),
      s.store.publish(context.actorAccountId, initial!.generationId, initial!),
    ]);
    expect(race.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(race.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { code: 'ANALYTICS_REFRESH_CONFLICT' },
    });
    const snapshot = await s.store.load(context.actorAccountId);
    await expect(
      db.prisma.$transaction(async (tx) => {
        await tx.reportingFact.updateMany({
          where: { owner: 'booking' },
          data: { recordId: 'changed' },
        });
      }),
    ).rejects.toThrow();
    expect(await s.store.load(context.actorAccountId)).toEqual(snapshot);
    const r = await request(app)
      .post('/api/v1/management/analytics/rebuild')
      .auth(f.manager.accessToken, { type: 'bearer' })
      .send({ reason: 'Isolated deterministic rebuild' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(
      await db.prisma.auditLog.findFirst({
        where: { action: 'analytics.rebuilt', actorId: f.manager.actorId },
      }),
    ).toMatchObject({ metadata: { reason: 'Isolated deterministic rebuild' } });
  });
  it('filters inside PostgreSQL before row budgets so narrow/empty reports work with a large unrelated history', async () => {
    const { f, s, context, get } = await fixture();
    await s.projector.refresh(context.actorAccountId, context);
    const snapshot = await s.store.load(context.actorAccountId),
      template = bookingAnalyticsSchema.parse(
        snapshot!.rows.find((r) => r.owner === 'booking' && r.recordId === f.bookingId)!.value,
      );
    // Synthetic projection-only scale fixture; this creates no domain/ledger/provider evidence.
    for (let offset = 0; offset < 10050; offset += 500) {
      await db.prisma.analyticsProjection.createMany({
        data: Array.from({ length: Math.min(500, 10050 - offset) }, () => {
          const bookingId = randomUUID();
          return {
            generationId: snapshot!.generationId,
            owner: 'booking',
            recordId: bookingId,
            sequence: 1,
            value: { ...template, bookingId, eventDate: '2025-01-01', phase: 'DRAFT' },
          };
        }),
      });
    }
    const narrow = await get('bookings');
    expect(narrow.status, JSON.stringify(narrow.body)).toBe(200);
    expect(
      analyticsResultSchemas.bookings
        .parse((narrow.body as { data: unknown }).data)
        .items.map((b) => b.bookingId),
    ).toEqual([f.bookingId]);
    const empty = await get(
      'bookings',
      f.manager.accessToken,
      'dateFrom=2024-01-01&dateTo=2024-01-01',
    );
    expect(empty.status).toBe(200);
    expect(
      analyticsResultSchemas.bookings.parse((empty.body as { data: unknown }).data).items,
    ).toEqual([]);
    const broad = await get(
      'bookings',
      f.manager.accessToken,
      'dateFrom=2025-01-01&dateTo=2025-01-01',
    );
    expect(broad.status).toBe(422);
    expect(broad.body as unknown).toMatchObject({ error: { code: 'ANALYTICS_QUERY_TOO_BROAD' } });
  }, 60000);
});
