import { randomBytes, randomUUID } from 'node:crypto';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createApp } from '../../src/app.js';
import { parseEnvironment } from '../../src/config/env.js';
import { CATALOG_SEED_IDS as ids, seedVenueCatalog } from '../../scripts/catalog-seed.js';
import { createLayoutService } from '../../src/modules/venue-catalog/application/layout.service.js';
import { createBookingLifecycleRuntime } from '../../src/modules/booking-lifecycle/booking-lifecycle.runtime.js';
import { readEffectiveTablePage } from '../../src/modules/booking-lifecycle/infrastructure/effective-table-page.reader.js';
import { createPrismaSessionRepository } from '../../src/modules/identity-access/session/session.repository.js';
import { hashOpaqueToken } from '../../src/modules/identity-access/crypto/token.js';
import { createAuthenticatedActorResolver } from '../../src/modules/identity-access/authorization/authenticated-actor.middleware.js';
import { createPaymentsBillingProviders } from '../../src/modules/payments-billing/payments-billing.providers.js';
import { createPaymentsBillingHttpServices } from '../../src/modules/payments-billing/http/payments-billing.http-services.js';
import { createPaymentsBillingRouter } from '../../src/modules/payments-billing/http/payments-billing.router.js';
import { createInvitationStudioServices } from '../../src/modules/invitation-studio/infrastructure/studio.composition.js';
import { createStaffSeatingServices } from '../../src/modules/staff-operations/infrastructure/staff-seating.composition.js';
import { createGuestRouter } from '../../src/modules/guest-management/http/guest.router.js';
import {
  consultationResponseSchema,
  bookingResponseSchema,
} from '../../src/modules/booking-lifecycle/http/booking-lifecycle.schemas.js';
import {
  proposalResponseSchema,
  holdResponseSchema,
  timelineResultResponseSchema,
} from '../../src/modules/booking-lifecycle/http/booking-lifecycle.responses.js';
import { selectionResponseSchema } from '../../src/modules/booking-lifecycle/domain/commercial-selections.js';
import {
  contractResponseSchema,
  type CommercialSelection,
} from '../../src/modules/booking-lifecycle/domain/commercial-contract.js';
import {
  appendixResponseSchema,
  appendicesResponseSchema,
} from '../../src/modules/booking-lifecycle/domain/commercial-appendix.js';
import { bookingPageResponse } from '../../src/modules/booking-lifecycle/http/booking-navigation.schemas.js';
import {
  responseSchema,
  planSchema,
} from '../../src/modules/guest-management/http/guest.schemas.js';
import { controlledStorage } from './invitation-studio/controlled-storage.js';
import { controlledVnpay } from './payments-billing/vnpay-fixture.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';

const describeDb = catalogMigrationDatabaseUrl ? describe : describe.skip;

describeDb('fixed ten-person table capacity with real owner APIs and PostgreSQL', () => {
  const database = new CatalogTestDatabase('table_capacity');
  const accounts = { manager: randomUUID(), couple: randomUUID() };
  const tokens = { manager: '', couple: '' };
  let app: ReturnType<typeof createApp>;
  let booking: Awaited<ReturnType<typeof createBookingLifecycleRuntime>> | undefined;
  let observer: Client | undefined;
  let lotusLayoutId: string;
  let day = 1;

  async function layout(hallId: string, count: number, seats: number, publish = true) {
    const service = createLayoutService(database.prisma);
    const templateId = randomUUID(),
      versionId = randomUUID();
    const context = { actorId: accounts.manager, requestId: randomUUID() };
    const created = await service.createTemplate({
      templateId,
      versionId,
      hallId,
      displayOrder: 20 + count,
      name: `Sơ đồ ${count} bàn ${templateId}`,
      description: 'Synthetic layout for capacity regression.',
      minGuests: 1,
      maxGuests: Math.min(count * seats, hallId === ids.orchidHall ? 120 : 300),
      tables: Array.from({ length: count }, (_, index) => ({
        tableId: randomUUID(),
        displayOrder: index + 1,
        label: `B${index + 1}`,
        shape: 'ROUND' as const,
        seatCapacity: seats,
        x: (index % 6) * 1400,
        y: Math.floor(index / 6) * 1400,
        width: 1000,
        height: 1000,
        rotationDegrees: 0,
      })),
      context,
    });
    if (publish)
      await service.publish({ templateId, versionId, expectedRevision: created.revision, context });
    return { templateId, versionId };
  }

  beforeAll(async () => {
    const target = new URL(catalogMigrationDatabaseUrl!);
    if (!['localhost', '127.0.0.1', '::1'].includes(target.hostname))
      throw new Error('Disposable loopback PostgreSQL is required.');
    await database.connect();
    await seedVenueCatalog(database.prisma);
    const sessions = createPrismaSessionRepository(database.prisma);
    for (const who of ['manager', 'couple'] as const) {
      const accountId = accounts[who];
      await database.prisma.account.create({
        data: {
          id: accountId,
          emailNormalized: `${accountId}@example.com`,
          displayEmail: `${accountId}@example.com`,
          roles: { create: { role: who === 'manager' ? 'MANAGER' : 'COUPLE' } },
        },
      });
      tokens[who] = `wia_${randomBytes(32).toString('base64url')}`;
      const now = new Date(),
        expires = new Date(now.getTime() + 3600000);
      await sessions.createSession({
        accountId,
        clientKind: 'WEB',
        accessTokenHash: hashOpaqueToken(tokens[who], 'access'),
        refreshTokenHash: hashOpaqueToken(randomBytes(32).toString('hex'), 'refresh'),
        accessExpiresAt: expires,
        idleExpiresAt: expires,
        absoluteExpiresAt: expires,
        now,
      });
    }
    // Geometry deliberately retains eight-seat metadata. The approved product rule
    // uses exactly ten places per table, independently of this old metadata.
    await layout(ids.orchidHall, 12, 8);
    // Old shared seed layouts have only two/three geometries with 60/80 seats each.
    // Add a genuine thirty-table fixture; never treat those large seat counts as tables.
    lotusLayoutId = (await layout(ids.lotusHall, 30, 10)).templateId;
    target.pathname = '/' + database.databaseName;
    target.searchParams.delete('schema');
    target.searchParams.delete('options');
    observer = new Client({ connectionString: target.toString() });
    await observer.connect();
    const config = parseEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: target.toString(),
      CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
    });
    booking = await createBookingLifecycleRuntime(config);
    const studio = createInvitationStudioServices(
      database.prisma,
      controlledStorage().provider,
      null,
      'https://wedding.example.test',
    );
    const combined = createStaffSeatingServices(database.prisma, studio);
    const billing = createPaymentsBillingProviders(database.prisma, {
      vnpay: controlledVnpay,
      gateway: {
        query: () => Promise.reject(new Error('No live payment calls in capacity tests')),
      },
    });
    app = createApp({
      runtimeEnvironment: 'test',
      securityConfig: {
        ...config.security,
        rateLimit: { ...config.security.rateLimit, maxRequests: 10000 },
      },
      registerRoutes(server) {
        server.use('/api/v1', booking!.router);
        server.use('/api/v1', createGuestRouter(combined.staff.guests));
        server.use(
          '/api/v1',
          createPaymentsBillingRouter({
            services: createPaymentsBillingHttpServices(database.prisma, billing),
            resolveActor: createAuthenticatedActorResolver(sessions),
          }),
        );
      },
    });
  }, 120000);

  afterAll(async () => {
    await booking?.resource.close();
    await observer?.end();
    await database.disconnect();
  }, 60000);

  const post = (path: string, body: object, who: keyof typeof tokens = 'manager') =>
    request(app)
      .post('/api/v1' + path)
      .auth(tokens[who], { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send(body);
  const get = (path: string, who: keyof typeof tokens = 'manager') =>
    request(app)
      .get('/api/v1' + path)
      .auth(tokens[who], { type: 'bearer' });
  const patch = (path: string, body: object) =>
    request(app)
      .patch('/api/v1' + path)
      .auth(tokens.couple, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send(body);
  const menu = (quantity: number): CommercialSelection[] => [
    {
      category: 'MENU',
      sourceId: ids.classicMenu,
      sourceRevisionId: ids.classicMenuVersion,
      quantity,
    },
  ];
  const ok = (response: Response, status: number) =>
    expect(response.status, JSON.stringify(response.body)).toBe(status);
  const conflict = (response: Response, code: string) => {
    ok(response, 409);
    expect(response.body).toMatchObject({ error: { code } });
  };
  const proposal = async (id: string) => {
    const r = await get(`/bookings/${id}/proposal`);
    ok(r, 200);
    return proposalResponseSchema.parse(r.body as unknown).data;
  };

  async function intake(label = `Capacity ${randomUUID()}`) {
    const r = await post('/management/consultations', {
      intendedEmail: `${accounts.couple}@example.com`,
      displayName: label,
      brideName: 'Ánh',
      groomName: 'Minh',
    });
    ok(r, 201);
    const c = consultationResponseSchema.parse(r.body as unknown).data;
    await database.prisma.consultationAccess.create({
      data: { accountId: accounts.couple, consultationId: c.consultationId, level: 'RESTRICTED' },
    });
    return c;
  }
  async function initial(
    tables = 10,
    headcount = 100,
    label?: string,
    hallId: string = ids.orchidHall,
  ) {
    const c = await intake(label);
    const body = {
      consultationId: c.consultationId,
      hallId,
      eventDate: new Date(Date.UTC(2027, 1, day++)).toISOString().slice(0, 10),
      shiftCode: 'DINNER',
      menuPackageVersionId: ids.classicMenuVersion,
      tableCount: tables,
      planningHeadcount: headcount,
      expectedRevision: c.revision,
    };
    const r = await post('/bookings', body);
    ok(r, 201);
    const id = bookingResponseSchema.parse(r.body as unknown).data.bookingId;
    return { id, body };
  }
  async function timeline(id: string) {
    const p = await proposal(id);
    const held = await post(`/bookings/${id}/slot-holds`, { expectedRevision: p.revision });
    ok(held, 201);
    const hold = holdResponseSchema.parse(held.body as unknown).data;
    const saved = await post(
      `/bookings/${id}/timeline-revisions`,
      {
        expectedRevision: hold.bookingRevision,
        predecessorRevisionId: null,
        items: [{ order: 0, startTime: '18:00', title: 'Đón khách' }],
      },
      'couple',
    );
    ok(saved, 201);
    let t = timelineResultResponseSchema.parse(saved.body as unknown).data;
    for (const who of ['manager', 'couple'] as const) {
      const r = await post(
        `/bookings/${id}/timeline-revisions/${t.revision.revisionId}/approvals`,
        { expectedRevision: t.bookingRevision },
        who,
      );
      ok(r, 200);
      t = timelineResultResponseSchema.parse(r.body as unknown).data;
    }
    return { revision: t.bookingRevision, timelineId: t.revision.revisionId };
  }
  async function contract(id: string, tables: number) {
    const t = await timeline(id),
      path = `/bookings/${id}/contract-selections`;
    const saved = await post(
      path + '/drafts',
      { expectedRevision: t.revision, lines: menu(tables) },
      'couple',
    );
    ok(saved, 200);
    const s = selectionResponseSchema.parse(saved.body as unknown).data;
    const sent = await post(
      path + '/submissions',
      { expectedRevision: s.bookingRevision, selectionRevisionId: s.selection.revisionId },
      'couple',
    );
    ok(sent, 200);
    const selection = selectionResponseSchema.parse(sent.body as unknown).data;
    const drafted = await post(`/bookings/${id}/contracts`, {
      expectedRevision: selection.bookingRevision,
      predecessorRevisionId: null,
      timelineRevisionId: t.timelineId,
      lines: menu(tables),
    });
    ok(drafted, 201);
    let c = contractResponseSchema.parse(drafted.body as unknown).data;
    const submitted = await post(`/bookings/${id}/contracts/${c.contract.revisionId}/submissions`, {
      expectedRevision: c.bookingRevision,
    });
    ok(submitted, 200);
    c = contractResponseSchema.parse(submitted.body as unknown).data;
    for (const who of ['manager', 'couple'] as const) {
      const r = await post(
        `/bookings/${id}/contracts/${c.contract.revisionId}/approvals`,
        { expectedRevision: c.bookingRevision },
        who,
      );
      ok(r, 200);
      c = contractResponseSchema.parse(r.body as unknown).data;
    }
    return c;
  }
  async function paid(
    tables = 10,
    headcount = 100,
    label?: string,
    originalTables = tables,
    hallId: string = ids.orchidHall,
  ) {
    const f = await initial(originalTables, headcount, label, hallId),
      c = await contract(f.id, tables);
    const r = await post('/management/billing/payments/manual', {
      bookingId: f.id,
      purpose: 'DEPOSIT',
      contractRevisionId: c.contract.revisionId,
      documentDigest: c.contract.documentDigest,
      amountVnd: c.contract.document.depositAmountVnd,
      settledAt: new Date().toISOString(),
      reason: 'Synthetic local capacity deposit',
      evidenceReference: 'LOCAL-CAPACITY',
    });
    ok(r, 201);
    return { ...f, c };
  }
  async function appendix(id: string, predecessorRevisionId: string, tables: number) {
    const path = `/bookings/${id}/contract-appendices`;
    const state = appendicesResponseSchema.parse((await get(path, 'couple')).body as unknown).data;
    const r = await post(
      path,
      {
        expectedRevision: state.bookingRevision,
        predecessorRevisionId,
        reason: 'Điều chỉnh số bàn kiểm thử',
        lines: menu(tables),
      },
      'couple',
    );
    ok(r, 201);
    let a = appendixResponseSchema.parse(r.body as unknown).data;
    const submitted = await post(
      `${path}/${a.appendix.revisionId}/submissions`,
      { expectedRevision: a.bookingRevision },
      'couple',
    );
    ok(submitted, 200);
    a = appendixResponseSchema.parse(submitted.body as unknown).data;
    return { path, a };
  }
  async function approveAppendix(
    value: Awaited<ReturnType<typeof appendix>>,
    who: keyof typeof tokens,
  ) {
    const r = await post(
      `${value.path}/${value.a.appendix.revisionId}/approvals`,
      { expectedRevision: value.a.bookingRevision },
      who,
    );
    ok(r, 200);
    return { path: value.path, a: appendixResponseSchema.parse(r.body as unknown).data };
  }

  it('rejects too few tables at creation, permits partially filled tables, and ignores old eight-seat metadata', async () => {
    const c = await intake();
    const body = {
      consultationId: c.consultationId,
      hallId: ids.orchidHall,
      eventDate: '2027-04-01',
      shiftCode: 'DINNER',
      menuPackageVersionId: ids.classicMenuVersion,
      tableCount: 9,
      planningHeadcount: 95,
      expectedRevision: c.revision,
    };
    conflict(await post('/bookings', body), 'BOOKING_TABLES_INSUFFICIENT');
    const accepted = await post('/bookings', { ...body, tableCount: 10 });
    ok(accepted, 201);
    const id = bookingResponseSchema.parse(accepted.body as unknown).data.bookingId;
    expect((await proposal(id)).proposal.tableCount).toBe(10);
  }, 60000);

  it('uses published active geometry counts, excluding larger draft and retired templates', async () => {
    await layout(ids.orchidHall, 20, 5, false);
    const retired = await layout(ids.orchidHall, 24, 5);
    const service = createLayoutService(database.prisma);
    const head = await database.prisma.layoutTemplate.findUniqueOrThrow({
      where: { id: retired.templateId },
    });
    await service.changeLifecycle({
      aggregateId: retired.templateId,
      expectedRevision: head.revision,
      transition: 'RETIRE',
      context: { actorId: accounts.manager, requestId: randomUUID() },
    });
    const c = await intake();
    conflict(
      await post('/bookings', {
        consultationId: c.consultationId,
        hallId: ids.orchidHall,
        eventDate: '2027-04-02',
        shiftCode: 'DINNER',
        menuPackageVersionId: ids.classicMenuVersion,
        tableCount: 20,
        planningHeadcount: 100,
        expectedRevision: c.revision,
      }),
      'BOOKING_LAYOUT_TABLE_LIMIT',
    );
    expect(
      await database.prisma.booking.count({ where: { consultationId: c.consultationId } }),
    ).toBe(0);
    const emptyHall = await database.prisma.hall.create({
      data: {
        name: 'Capacity empty hall',
        nameNormalized: 'capacity empty hall',
        description: 'Synthetic',
        maxGuests: 120,
        displayOrder: 100,
        updatedByAccountId: accounts.manager,
      },
    });
    conflict(
      await post('/bookings', {
        consultationId: c.consultationId,
        hallId: emptyHall.id,
        eventDate: '2027-04-02',
        shiftCode: 'DINNER',
        menuPackageVersionId: ids.classicMenuVersion,
        tableCount: 10,
        planningHeadcount: 100,
        expectedRevision: c.revision,
      }),
      'BOOKING_LAYOUT_UNAVAILABLE',
    );
  }, 60000);

  it('rejects decreasing menu quantity below the minimum before creating any contract selection', async () => {
    const f = await initial(),
      t = await timeline(f.id);
    const rejected = await post(
      `/bookings/${f.id}/contract-selections/drafts`,
      { expectedRevision: t.revision, lines: menu(9) },
      'couple',
    );
    conflict(rejected, 'BOOKING_TABLES_INSUFFICIENT');
    expect(
      await database.prisma.bookingCommercialSelectionRevision.count({
        where: { bookingId: f.id },
      }),
    ).toBe(0);
    expect((await proposal(f.id)).revision).toBe(t.revision);
  }, 60000);

  it('keeps compilation disabled only within the effective table sorting transaction', async () => {
    const tag = `Capacity compilation ${randomUUID()}`;
    const f = await initial(10, 100, tag);
    const before = await database.prisma.$queryRaw<{ value: string }[]>`
      SELECT current_setting('jit') AS value
    `;
    await database.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL jit=on`;
        await tx.$executeRaw`SET LOCAL jit_above_cost=0`;
        const page = await readEffectiveTablePage(
          tx,
          { q: tag, scope: 'mine', phase: 'ALL', order: 'asc', pageSize: 1 },
          accounts.manager,
          0,
        );
        expect(page).toEqual([f.id]);
        expect(await tx.$queryRaw`SELECT current_setting('jit') AS value`).toEqual([
          { value: 'off' },
        ]);
      },
      { timeout: 30000 },
    );
    expect(await database.prisma.$queryRaw`SELECT current_setting('jit') AS value`).toEqual(before);
  }, 60000);

  it('uses effective appendix tables and menus consistently in proposal and paginated navigation sorting', async () => {
    const tag = `Capacity sort ${randomUUID()}`;
    const f = await paid(11, 100, `${tag} A`, 10);
    const other = await initial(11, 100, `${tag} B`);
    const path =
      '/management/booking-page?scope=mine&sort=tableCount&order=asc&pageSize=1&q=' +
      encodeURIComponent(tag);
    const pending = await appendix(f.id, f.c.contract.revisionId, 12);
    const first = await approveAppendix(pending, 'manager');
    expect((await proposal(f.id)).proposal.tableCount).toBe(11);
    const complete = await approveAppendix(first, 'couple');
    const current = await proposal(f.id);
    expect(current.proposal.tableCount).toBe(12);
    expect(current.proposal.menus.reduce((sum, m) => sum + m.tableCount, 0)).toBe(12);
    expect(current.proposal.depositAmountVnd).toBe(f.c.contract.document.depositAmountVnd);
    const page1 = await get(path + '&page=1');
    ok(page1, 200);
    const firstPage = bookingPageResponse.parse(page1.body as unknown).data;
    expect(firstPage.total).toBe(2);
    expect(firstPage.items.map((b) => [b.bookingId, b.tableCount])).toEqual([[other.id, 11]]);
    const page2 = await get(path + '&page=2');
    ok(page2, 200);
    expect(
      bookingPageResponse
        .parse(page2.body as unknown)
        .data.items.map((b) => [b.bookingId, b.tableCount]),
    ).toEqual([[f.id, 12]]);
    const wildcardPage = await get(
      path.replace(
        encodeURIComponent(tag),
        encodeURIComponent(tag.replace('Capacity sort', 'Capacity_sort')),
      ) + '&page=1',
    );
    ok(wildcardPage, 200);
    const wildcardData = bookingPageResponse.parse(wildcardPage.body as unknown).data;
    expect(wildcardData.total).toBe(2);
    expect(wildcardData.items.map((b) => [b.bookingId, b.tableCount])).toEqual([[other.id, 11]]);
    await appendix(f.id, complete.a.appendix.revisionId, 10);
    expect((await proposal(f.id)).proposal.tableCount).toBe(12);
    expect(
      (
        await database.prisma.bookingProposalSnapshot.findUniqueOrThrow({
          where: { bookingId: f.id },
        })
      ).tableCount,
    ).toBe(10);
  }, 60000);

  it('checks Couple headcount against the effective agreement and rejects a smaller appendix', async () => {
    const f = await paid();
    const planPath = `/bookings/${f.id}/guest-plan`;
    const read = await get(planPath, 'couple');
    ok(read, 200);
    let p = responseSchema(planSchema).parse(read.body as unknown).data;
    conflict(
      await patch(planPath, { expectedRevision: p.revision, planningHeadcount: 101 }),
      'BOOKING_TABLES_INSUFFICIENT',
    );
    const lowered = await patch(planPath, { expectedRevision: p.revision, planningHeadcount: 95 });
    ok(lowered, 200);
    p = responseSchema(planSchema).parse(lowered.body as unknown).data;
    const state = await proposal(f.id);
    conflict(
      await post(
        `/bookings/${f.id}/contract-appendices`,
        {
          expectedRevision: state.revision,
          predecessorRevisionId: f.c.contract.revisionId,
          reason: 'Giảm bàn không đủ khách',
          lines: menu(9),
        },
        'couple',
      ),
      'BOOKING_TABLES_INSUFFICIENT',
    );
    expect((await proposal(f.id)).planningHeadcount).toBe(95);
    expect(p.planningHeadcount).toBe(95);
  }, 60000);

  it('serializes a Couple increase and the Manager final approval of fewer tables', async () => {
    const f = await paid(12);
    const planPath = `/bookings/${f.id}/guest-plan`;
    const plan = responseSchema(planSchema).parse(
      (await get(planPath, 'couple')).body as unknown,
    ).data;
    const pending = await appendix(f.id, f.c.contract.revisionId, 10);
    const first = await approveAppendix(pending, 'couple');
    await observer!.query('BEGIN');
    let responses: Promise<Response[]> | undefined;
    let waiters = 0;
    try {
      await observer!.query('SELECT pg_advisory_xact_lock(hashtext($1))', [f.id]);
      await observer!.query('SELECT id FROM "Booking" WHERE id=$1::uuid FOR UPDATE', [f.id]);
      responses = Promise.all([
        post(
          `${first.path}/${first.a.appendix.revisionId}/approvals`,
          { expectedRevision: first.a.bookingRevision },
          'manager',
        ),
        patch(planPath, { expectedRevision: plan.revision, planningHeadcount: 120 }),
      ]);
      for (let i = 0; i < 100 && waiters < 2; i++) {
        await observer!.query('SELECT pg_stat_clear_snapshot()');
        const result = await observer!.query<{ count: string }>(
          "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'",
        );
        waiters = Number(result.rows[0]!.count);
        if (waiters < 2) await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } finally {
      await observer!.query('ROLLBACK');
    }
    expect(waiters).toBeGreaterThanOrEqual(2);
    const results = await responses;
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(1);
    const result = await proposal(f.id);
    expect(result.planningHeadcount).toBeLessThanOrEqual(result.proposal.tableCount * 10);
    const deposit = await database.prisma.bookingDepositSettlement.findUniqueOrThrow({
      where: { bookingId: f.id },
    });
    expect(deposit.amountVnd.toNumber()).toBe(f.c.contract.document.depositAmountVnd);
  }, 60000);

  it('retains approved historical scale and deposit when the catalog no longer has enough tables', async () => {
    const f = await paid(20, 100, undefined, 20, ids.lotusHall);
    const service = createLayoutService(database.prisma);
    const head = await database.prisma.layoutTemplate.findUniqueOrThrow({
      where: { id: lotusLayoutId },
    });
    await service.changeLifecycle({
      aggregateId: lotusLayoutId,
      expectedRevision: head.revision,
      transition: 'RETIRE',
      context: { actorId: accounts.manager, requestId: randomUUID() },
    });
    try {
      const current = await proposal(f.id);
      expect(current.proposal.tableCount).toBe(20);
      expect(current.proposal.menus.reduce((sum, m) => sum + m.tableCount, 0)).toBe(20);
      expect(current.capacity?.issue).toBe('BOOKING_LAYOUT_TABLE_LIMIT');
      expect(current.proposal.depositAmountVnd).toBe(f.c.contract.document.depositAmountVnd);
      const contract = await database.prisma.commercialContractRevision.findUniqueOrThrow({
        where: { id: f.c.contract.revisionId },
      });
      expect(contract.document).toEqual(f.c.contract.document);
      // A historical over-capacity agreement must have a safe correction path:
      // first lower the explicit headcount, then mutually approve fewer menu tables.
      const planPath = `/bookings/${f.id}/guest-plan`;
      const plan = responseSchema(planSchema).parse(
        (await get(planPath, 'couple')).body as unknown,
      ).data;
      ok(await patch(planPath, { expectedRevision: plan.revision, planningHeadcount: 20 }), 200);
      const corrective = await appendix(f.id, f.c.contract.revisionId, 3);
      const coupleApproved = await approveAppendix(corrective, 'couple');
      await approveAppendix(coupleApproved, 'manager');
      const corrected = await proposal(f.id);
      expect(corrected.proposal.tableCount).toBe(3);
      expect(corrected.planningHeadcount).toBe(20);
      expect(corrected.capacity?.issue).toBeNull();
      expect(corrected.proposal.depositAmountVnd).toBe(f.c.contract.document.depositAmountVnd);
    } finally {
      const retired = await database.prisma.layoutTemplate.findUniqueOrThrow({
        where: { id: lotusLayoutId },
      });
      await service.changeLifecycle({
        aggregateId: lotusLayoutId,
        expectedRevision: retired.revision,
        transition: 'RESTORE',
        context: { actorId: accounts.manager, requestId: randomUUID() },
      });
    }
  }, 60000);
});
