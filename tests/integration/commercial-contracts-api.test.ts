import { registerAnalyticsCommercialCases } from './analytics-commercial-cases.js';
import { registerGuestCompletionCases } from './guest-management-completion-cases.js';
import { createStaffSeatingServices } from '../../src/modules/staff-operations/infrastructure/staff-seating.composition.js';
import { registerStepSixApiCases } from './commercial-step6-api-cases.js';
import { registerCommercialAcceptanceCases } from './commercial-acceptance-api-cases.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createInvitationStudioServices } from '../../src/modules/invitation-studio/infrastructure/studio.composition.js';
import { createStudioRouter } from '../../src/modules/invitation-studio/http/studio.router.js';
import { controlledStorage } from './invitation-studio/controlled-storage.js';
import { parseEnvironment } from '../../src/config/env.js';
import { CATALOG_SEED_IDS, seedVenueCatalog } from '../../scripts/catalog-seed.js';
import { createBookingLifecycleRuntime } from '../../src/modules/booking-lifecycle/booking-lifecycle.runtime.js';
import { createVenueCatalogRuntime } from '../../src/modules/venue-catalog/venue-catalog.runtime.js';
import { createPaymentsBillingProviders } from '../../src/modules/payments-billing/payments-billing.providers.js';
import { createPaymentsBillingHttpServices } from '../../src/modules/payments-billing/http/payments-billing.http-services.js';
import { createPaymentsBillingRouter } from '../../src/modules/payments-billing/http/payments-billing.router.js';
import { createPrismaSessionRepository } from '../../src/modules/identity-access/session/session.repository.js';
import { hashOpaqueToken } from '../../src/modules/identity-access/crypto/token.js';
import { createAuthenticatedActorResolver } from '../../src/modules/identity-access/authorization/authenticated-actor.middleware.js';
import {
  contractResponseSchema,
  contractsResponseSchema,
} from '../../src/modules/booking-lifecycle/domain/commercial-contract.js';
import {
  consultationResponseSchema,
  bookingResponseSchema,
} from '../../src/modules/booking-lifecycle/http/booking-lifecycle.schemas.js';
import {
  proposalResponseSchema,
  holdResponseSchema,
  timelineResultResponseSchema,
} from '../../src/modules/booking-lifecycle/http/booking-lifecycle.responses.js';
import {
  billingResponseSchema,
  checkoutResponseSchema,
  attemptResponseSchema,
  paymentResponseSchema,
} from '../../src/modules/payments-billing/http/payments-billing.schemas.js';
import {
  serviceViewSchema,
  printOfferingViewSchema,
} from '../../src/modules/venue-catalog/domain/commercial-offering.js';
import { controlledVnpay, ipnFixture } from './payments-billing/vnpay-fixture.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';

const describeDb = catalogMigrationDatabaseUrl ? describe : describe.skip;
const records: object[] = [];
const directory = 'test-results/step6-api';
describeDb('BE-06–10 actual HTTP and disposable PostgreSQL API verification', () => {
  const database = new CatalogTestDatabase('commercial_contract_api');
  let app: ReturnType<typeof createApp>;
  let studio: ReturnType<typeof createInvitationStudioServices>;
  let staffSeating: ReturnType<typeof createStaffSeatingServices>;
  let booking: Awaited<ReturnType<typeof createBookingLifecycleRuntime>> | undefined;
  let venue: Awaited<ReturnType<typeof createVenueCatalogRuntime>> | undefined;
  const tokens: Record<string, string> = {};
  const accounts = {
    manager: randomUUID(),
    own: randomUUID(),
    staff: randomUUID(),
    outsider: randomUUID(),
  };
  let lines: {
    category: 'MENU' | 'SERVICE' | 'PRINT';
    sourceId: string;
    sourceRevisionId: string;
    quantity: number;
  }[];
  let day = 1;
  const total = 47_000_000,
    deposit = 14_100_000;

  function capture(label: string, method: string, path: string, response: Response, body?: object) {
    const pdf = response.headers['content-type']?.includes('application/pdf') === true;
    records.push({
      label,
      method,
      path,
      ...(body === undefined ? {} : { request: body }),
      status: response.status,
      cacheControl: response.headers['cache-control'],
      response: pdf
        ? {
            contentType: response.headers['content-type'],
            bytes: (response.body as Buffer).length,
            sha256: response.headers['x-content-sha256'],
          }
        : (response.body as unknown),
    });
    return response;
  }
  async function post(
    path: string,
    body: object,
    who = 'manager',
    key: string | null = randomUUID(),
    label = path,
  ) {
    let req = request(app).post('/api/v1' + path);
    if (who !== 'anonymous') req = req.auth(tokens[who] ?? 'invalid', { type: 'bearer' });
    if (key !== null) req = req.set('Idempotency-Key', key);
    return capture(label, 'POST', path, await req.send(body), body);
  }
  async function get(path: string, who = 'manager', label = path) {
    let req = request(app).get('/api/v1' + path);
    if (who !== 'anonymous') req = req.auth(tokens[who] ?? 'invalid', { type: 'bearer' });
    return capture(label, 'GET', path, await req);
  }
  beforeAll(async () => {
    const url = new URL(catalogMigrationDatabaseUrl!);
    if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname))
      throw new Error('This test requires disposable loopback PostgreSQL.');
    await mkdir(directory, { recursive: true });
    await database.connect();
    await seedVenueCatalog(database.prisma);
    const sessions = createPrismaSessionRepository(database.prisma);
    for (const [who, id] of Object.entries(accounts)) {
      await database.prisma.account.create({
        data: {
          id,
          emailNormalized: `${id}@example.com`,
          displayEmail: `${id}@example.com`,
          ...(who === 'manager'
            ? { roles: { create: { role: 'MANAGER' } } }
            : who === 'staff'
              ? { roles: { create: { role: 'STAFF' } } }
              : {}),
        },
      });
      const token = 'wia_' + randomBytes(32).toString('base64url');
      const now = new Date(),
        expires = new Date(now.getTime() + 3_600_000);
      await sessions.createSession({
        accountId: id,
        clientKind: 'WEB',
        accessTokenHash: hashOpaqueToken(token, 'access'),
        refreshTokenHash: hashOpaqueToken(randomBytes(32).toString('hex'), 'refresh'),
        accessExpiresAt: expires,
        idleExpiresAt: expires,
        absoluteExpiresAt: expires,
        now,
      });
      tokens[who] = token;
    }
    url.pathname = '/' + database.databaseName;
    url.searchParams.delete('schema');
    url.searchParams.delete('options');
    const config = parseEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: url.toString(),
      CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
    });
    booking = await createBookingLifecycleRuntime(config);
    venue = await createVenueCatalogRuntime(config);
    const billing = createPaymentsBillingProviders(database.prisma, {
      vnpay: controlledVnpay,
      gateway: { query: () => Promise.reject(new Error('Controlled offline gateway')) },
    });
    app = createApp({
      runtimeEnvironment: 'test',
      // This API matrix sends >100 requests/minute. Production defaults and
      // dedicated rate-limit tests remain unchanged.
      securityConfig: {
        ...config.security,
        rateLimit: { ...config.security.rateLimit, maxRequests: 1000 },
      },
      registerRoutes(express) {
        studio = createInvitationStudioServices(
          database.prisma,
          controlledStorage().provider,
          null,
          'https://wedding.example.com',
        );
        staffSeating = createStaffSeatingServices(database.prisma, studio);
        express.use(
          '/api/v1',
          createStudioRouter(studio, createAuthenticatedActorResolver(sessions)),
        );
        express.use('/api/v1', booking!.router);
        express.use('/api/v1', venue!.router);
        express.use(
          '/api/v1',
          createPaymentsBillingRouter({
            services: createPaymentsBillingHttpServices(database.prisma, billing),
            resolveActor: createAuthenticatedActorResolver(sessions),
          }),
        );
      },
    });
    const service = await post('/management/services', {
      name: 'MC',
      description: 'Dẫn chương trình',
      unit: 'buổi',
      unitPriceVnd: 2_500_000,
      active: true,
    });
    expect(service.status).toBe(201);
    const s = serviceViewSchema.parse((service.body as { data: unknown }).data);
    const templateId = randomUUID(),
      templateVersionId = randomUUID();
    await database.prisma.$transaction(async (tx) => {
      await tx.invitationTemplateVersion.create({
        data: {
          id: templateVersionId,
          templateId,
          revision: 1,
          content: {
            title: 'Thiệp truyền thống',
            textFields: {},
            sections: [],
            derivedAssetIds: [],
            includesSeating: false,
          },
        },
      });
      await tx.invitationTemplate.create({
        data: { id: templateId, currentVersionId: templateVersionId, revision: 1, active: true },
      });
    });
    const printed = await post('/management/print-offerings', {
      templateId,
      templateVersionId,
      name: 'Thiệp tiêu chuẩn',
      printType: 'Hai mặt',
      material: 'Giấy mỹ thuật',
      unitPriceVnd: 5000,
      active: true,
    });
    expect(printed.status).toBe(201);
    const p = printOfferingViewSchema.parse((printed.body as { data: unknown }).data);
    lines = [
      {
        category: 'MENU',
        sourceId: CATALOG_SEED_IDS.classicMenu,
        sourceRevisionId: CATALOG_SEED_IDS.classicMenuVersion,
        quantity: 10,
      },
      {
        category: 'MENU',
        sourceId: CATALOG_SEED_IDS.premiumMenu,
        sourceRevisionId: CATALOG_SEED_IDS.premiumMenuVersion,
        quantity: 2,
      },
      {
        category: 'SERVICE',
        sourceId: s.serviceId,
        sourceRevisionId: s.sourceRevisionId,
        quantity: 1,
      },
      {
        category: 'PRINT',
        sourceId: p.offeringId,
        sourceRevisionId: p.sourceRevisionId,
        quantity: 100,
      },
    ];
  }, 90_000);
  afterAll(async () => {
    await writeFile(
      directory + '/responses.json',
      JSON.stringify(
        {
          target: 'Express HTTP + real PostgreSQL 17; controlled VNPay, no provider network',
          records,
        },
        null,
        2,
      ),
    );
    await booking?.resource.close();
    await venue?.resource.close();
    await database.disconnect();
  });
  async function fixture(names = true) {
    const c = await post('/management/consultations', {
      intendedEmail: `${accounts.own}@example.com`,
      displayName: 'Cặp đôi thử',
      ...(names ? { brideName: 'Nguyễn Thị Ánh', groomName: 'Trần Minh' } : {}),
    });
    expect(c.status).toBe(201);
    const consultation = consultationResponseSchema.parse(c.body as unknown).data;
    await database.prisma.consultationAccess.create({
      data: {
        accountId: accounts.own,
        consultationId: consultation.consultationId,
        level: 'RESTRICTED',
      },
    });
    const b = await post('/bookings', {
      consultationId: consultation.consultationId,
      hallId: CATALOG_SEED_IDS.lotusHall,
      eventDate: new Date(Date.UTC(2027, 1, day++)).toISOString().slice(0, 10),
      shiftCode: 'DINNER',
      menuPackageVersionId: CATALOG_SEED_IDS.classicMenuVersion,
      tableCount: 10,
      planningHeadcount: 100,
      expectedRevision: consultation.revision,
    });
    expect(b.status).toBe(201);
    const id = bookingResponseSchema.parse(b.body as unknown).data.bookingId;
    const proposal = proposalResponseSchema.parse(
      (await get(`/bookings/${id}/proposal`)).body as unknown,
    ).data;
    const held = await post(`/bookings/${id}/slot-holds`, { expectedRevision: proposal.revision });
    expect(held.status).toBe(201);
    const hold = holdResponseSchema.parse(held.body as unknown).data;
    const saved = await post(
      `/bookings/${id}/timeline-revisions`,
      {
        expectedRevision: hold.bookingRevision,
        predecessorRevisionId: null,
        items: [
          { order: 0, startTime: '18:00', title: 'Đón khách' },
          { order: 1, startTime: '19:00', title: 'Lễ cưới', description: 'Gia đình chung vui' },
        ],
      },
      'own',
    );
    expect(saved.status).toBe(201);
    let timeline = timelineResultResponseSchema.parse(saved.body as unknown).data;
    for (const who of ['manager', 'own']) {
      const a = await post(
        `/bookings/${id}/timeline-revisions/${timeline.revision.revisionId}/approvals`,
        { expectedRevision: timeline.bookingRevision },
        who,
      );
      expect(a.status).toBe(200);
      timeline = timelineResultResponseSchema.parse(a.body as unknown).data;
    }
    return {
      id,
      consultationId: consultation.consultationId,
      revision: timeline.bookingRevision,
      timelineId: timeline.revision.revisionId,
      path: `/bookings/${id}/contracts`,
    };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function race(f: Fixture, commands: readonly (() => Promise<Response>)[]) {
    let unlock!: () => void;
    let locked!: () => void;
    const gate = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const blocker = database.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${f.id}))`;
        await tx.$queryRaw`SELECT id FROM "Booking" WHERE id=${f.id}::uuid FOR UPDATE`;
        locked();
        await gate;
      },
      { timeout: 30_000 },
    );
    await ready;
    const responses = Promise.all(commands.map((command) => command()));
    let waiters = 0;
    try {
      for (let i = 0; i < 100 && waiters < 2; i++) {
        const rows = await database.prisma.$queryRaw<{ count: bigint }[]>`
          SELECT count(*) FROM pg_stat_activity
          WHERE datname=current_database() AND wait_event_type='Lock'
        `;
        waiters = Number(rows[0]!.count);
        if (waiters < 2) await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } finally {
      unlock();
      await blocker;
    }
    const resolved = await responses;
    expect(waiters).toBe(2);
    return resolved;
  }
  const draftBody = (f: Fixture) => ({
    expectedRevision: f.revision,
    predecessorRevisionId: null,
    timelineRevisionId: f.timelineId,
    lines,
  });
  async function draft(f: Fixture) {
    const r = await post(f.path, draftBody(f), 'own');
    expect(r.status).toBe(201);
    return contractResponseSchema.parse(r.body as unknown).data;
  }
  async function approved(f: Fixture, initial?: Awaited<ReturnType<typeof draft>>) {
    let d = initial ?? (await draft(f));
    for (const [action, who] of [
      ['submissions', 'own'],
      ['approvals', 'manager'],
      ['approvals', 'own'],
    ] as const) {
      const r = await post(
        `${f.path}/${d.contract.revisionId}/${action}`,
        { expectedRevision: d.bookingRevision },
        who,
      );
      expect(r.status).toBe(200);
      d = contractResponseSchema.parse(r.body as unknown).data;
    }
    expect(d.contract.state).toBe('APPROVED');
    return d;
  }
  async function paidFixture(past = false) {
    const f = await fixture();
    if (past) {
      // Synthetic historical fixture, seeded BEFORE any commercial document or payment.
      // Production APIs never rewrite a signed event date to bypass the event-end gate.
      const eventDate = new Date(Date.UTC(2026, 0, day));
      await database.prisma.$transaction(async (tx) => {
        await tx.booking.update({ where: { id: f.id }, data: { eventDate } });
        await tx.bookingSlotHold.updateMany({
          where: { bookingId: f.id, status: 'ACTIVE' },
          data: { eventDate },
        });
      });
    }
    const d = await approved(f);
    const payment = await post('/management/billing/payments/manual', {
      bookingId: f.id,
      purpose: 'DEPOSIT',
      contractRevisionId: d.contract.revisionId,
      documentDigest: d.contract.documentDigest,
      amountVnd: deposit,
      settledAt: new Date().toISOString(),
      reason: 'Cọc kiểm thử quyết toán',
      evidenceReference: 'LOCAL-INVOICE',
    });
    expect(payment.status, JSON.stringify(payment.body)).toBe(201);
    return { f, d };
  }
  async function expenseMutation(
    method: 'patch' | 'delete',
    path: string,
    body: object,
    who = 'manager',
    key = randomUUID(),
  ) {
    const result = await request(app)
      [method]('/api/v1' + path)
      .auth(tokens[who]!, { type: 'bearer' })
      .set('Idempotency-Key', key)
      .send(body);
    return capture(path, method.toUpperCase(), path, result, body);
  }
  const harness = {
    database,
    post,
    get,
    expenseMutation,
    fixture,
    approved,
    paidFixture,
    race,
    getLines: () => lines,
    accounts,
    total,
    deposit,
  };
  registerCommercialAcceptanceCases(harness);
  registerAnalyticsCommercialCases(harness);
  registerStepSixApiCases(harness);
  registerGuestCompletionCases(harness, () => ({
    studio,
    staffSeating,
    context: (who) => ({
      actorId: accounts[who],
      accessToken: tokens[who]!,
      requestId: randomUUID(),
    }),
  }));
  it('lists, creates, submits, approves, downloads and withdraws the exact contract with retained PDF history', async () => {
    const f = await fixture();
    const empty = await get(f.path, 'own', 'List before conversion');
    expect(empty.status).toBe(200);
    expect(contractsResponseSchema.parse(empty.body as unknown).data).toMatchObject({
      modelVersion: 'LEGACY_PROPOSAL_V1',
      revisions: [],
    });
    const d = await approved(f);
    expect(d.contract.document).toMatchObject({
      tableCount: 12,
      contractTotalVnd: total,
      depositAmountVnd: deposit,
      incidentalClause: 'Các chi phí phát sinh sẽ được tính sau',
    });
    const pdfPath = `${f.path}/${d.contract.revisionId}/pdf`;
    const pdf = await get(pdfPath, 'own', 'Approved PDF');
    expect(pdf.status).toBe(200);
    expect(Buffer.isBuffer(pdf.body)).toBe(true);
    const bytes = pdf.body as Buffer;
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(d.contract.pdfSha256);
    await writeFile(directory + '/approved-contract.pdf', bytes);
    const withdrawn = await post(
      `${f.path}/${d.contract.revisionId}/withdrawals`,
      { expectedRevision: d.bookingRevision, reason: 'Cần xem lại dịch vụ' },
      'own',
    );
    expect(withdrawn.status).toBe(200);
    const next = contractResponseSchema.parse(withdrawn.body as unknown).data;
    expect(next.contract).toMatchObject({
      state: 'DRAFT',
      predecessorRevisionId: d.contract.revisionId,
      approvals: [],
    });
    expect(next.contract.revisionId).not.toBe(d.contract.revisionId);
    const history = await get(f.path, 'own', 'History after withdrawal');
    expect(history.status).toBe(200);
    expect(contractsResponseSchema.parse(history.body as unknown).data.revisions).toHaveLength(2);
    const retained = await get(pdfPath, 'manager', 'Retained old PDF');
    expect(retained.status).toBe(200);
    expect(retained.body).toEqual(bytes);
  }, 30_000);
  it('rejects missing names, client prices, zero/duplicate quantities and stale commands', async () => {
    const f = await fixture(false),
      body = draftBody(f);
    for (const invalid of [
      { ...body, lines: [{ ...lines[0]!, quantity: 0 }] },
      { ...body, lines: [lines[0]!, lines[0]!] },
      { ...body, contractTotalVnd: 1 },
    ]) {
      expect(
        (await post(f.path, invalid, 'own', randomUUID(), 'Invalid contract body')).status,
      ).toBe(422);
    }
    expect((await post(f.path, body, 'own', null, 'Missing idempotency key')).status).toBe(400);
    const d = await draft(f);
    const stale = await post(f.path, body, 'own', randomUUID(), 'Stale booking revision');
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: { code: 'CONTRACT_REVISION_STALE' } });
    const missing = await post(
      `${f.path}/${d.contract.revisionId}/submissions`,
      { expectedRevision: d.bookingRevision },
      'own',
      randomUUID(),
      'Missing bride/groom names',
    );
    expect(missing.status).toBe(409);
    expect(missing.body).toMatchObject({ error: { code: 'COUPLE_NAMES_INCOMPLETE' } });
  }, 30_000);
  it('serializes concurrent draft conversion and approvals into one write and a replayable stale conflict', async () => {
    const f = await fixture();
    const keys = [randomUUID(), randomUUID()];
    const converted = await race(
      f,
      keys.map((key) => () => post(f.path, draftBody(f), 'own', key)),
    );
    expect(converted.map((r) => r.status).sort()).toEqual([201, 409]);
    const winner = converted.find((r) => r.status === 201)!;
    const d = contractResponseSchema.parse(winner.body as unknown).data;
    const submitted = await post(
      `${f.path}/${d.contract.revisionId}/submissions`,
      { expectedRevision: d.bookingRevision },
      'own',
    );
    expect(submitted.status).toBe(200);
    const pending = contractResponseSchema.parse(submitted.body as unknown).data;
    const path = `${f.path}/${d.contract.revisionId}/approvals`;
    const body = { expectedRevision: pending.bookingRevision };
    const approvalKeys = [randomUUID(), randomUUID()];
    const approvals = await race(
      f,
      ['manager', 'own'].map((who, i) => () => post(path, body, who, approvalKeys[i])),
    );
    expect(approvals.map((r) => r.status).sort()).toEqual([200, 409]);
    const loser = approvals.findIndex((r) => r.status === 409);
    expect(approvals[loser]!.body).toMatchObject({ error: { code: 'CONTRACT_REVISION_STALE' } });
    const replay = await post(path, body, ['manager', 'own'][loser], approvalKeys[loser]);
    expect(replay.status).toBe(409);
    expect(replay.body).toMatchObject({ error: { code: 'CONTRACT_REVISION_STALE' } });
    expect(
      await database.prisma.commercialContractRevision.count({ where: { bookingId: f.id } }),
    ).toBe(1);
    expect(
      await database.prisma.commercialContractApproval.count({
        where: { revisionId: d.contract.revisionId },
      }),
    ).toBe(1);
  }, 30_000);
  it('rejects invalid capacity, catalog/timeline/predecessor and lifecycle transitions while retaining draft previews', async () => {
    const f = await fixture();
    for (const [body, code] of [
      [
        {
          ...draftBody(f),
          lines: lines.map((line, i) => (i === 0 ? { ...line, quantity: 501 } : line)),
        },
        'CONTRACT_CAPACITY_EXCEEDED',
      ],
      [{ ...draftBody(f), timelineRevisionId: randomUUID() }, 'COMMERCIAL_PREDECESSOR_STALE'],
      [{ ...draftBody(f), predecessorRevisionId: randomUUID() }, 'COMMERCIAL_PREDECESSOR_STALE'],
      [
        {
          ...draftBody(f),
          lines: lines.map((line, i) =>
            i === 0 ? { ...line, sourceRevisionId: randomUUID() } : line,
          ),
        },
        'COMMERCIAL_PRICE_REVISION_STALE',
      ],
    ] as const) {
      const r = await post(f.path, body, 'own');
      expect(r.status).toBe(409);
      expect(r.body).toMatchObject({ error: { code } });
    }
    const d = await draft(f),
      path = `${f.path}/${d.contract.revisionId}`;
    const preview = await get(path + '/pdf', 'own');
    expect(preview.status).toBe(200);
    expect((preview.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect(
      (await post(path + '/approvals', { expectedRevision: d.bookingRevision }, 'own')).status,
    ).toBe(409);
    const withdrawn = await post(
      path + '/withdrawals',
      { expectedRevision: d.bookingRevision, reason: 'Chưa duyệt' },
      'own',
    );
    expect(withdrawn.body).toMatchObject({ error: { code: 'CONTRACT_APPROVAL_REQUIRED' } });
    const badCursor = await get(f.path + '?cursor=' + randomUUID(), 'own');
    expect(badCursor.status).toBe(404);
    const paged = await get(f.path + '?cursor=' + d.contract.revisionId, 'own');
    expect(paged.status).toBe(200);
    expect(contractsResponseSchema.parse(paged.body as unknown).data).toMatchObject({
      revisions: [],
      nextCursor: null,
    });
    await database.prisma.consultation.update({
      where: { id: f.consultationId },
      data: { groomName: 'Tên mới' },
    });
    try {
      const changed = await post(
        path + '/submissions',
        { expectedRevision: d.bookingRevision },
        'own',
      );
      expect(changed.status).toBe(409);
      expect(changed.body).toMatchObject({ error: { code: 'COMMERCIAL_PRICE_REVISION_STALE' } });
    } finally {
      await database.prisma.consultation.update({
        where: { id: f.consultationId },
        data: { groomName: 'Trần Minh' },
      });
    }
    const submitted = await post(
      path + '/submissions',
      { expectedRevision: d.bookingRevision },
      'own',
    );
    const pending = contractResponseSchema.parse(submitted.body as unknown).data;
    expect(
      (await post(path + '/submissions', { expectedRevision: pending.bookingRevision }, 'own'))
        .status,
    ).toBe(409);
    const first = await post(
      path + '/approvals',
      { expectedRevision: pending.bookingRevision },
      'manager',
    );
    const partial = contractResponseSchema.parse(first.body as unknown).data;
    const duplicate = await post(
      path + '/approvals',
      { expectedRevision: partial.bookingRevision },
      'manager',
    );
    expect(duplicate.status).toBe(200);
    expect(contractResponseSchema.parse(duplicate.body as unknown).data).toEqual(partial);
    const completed = await post(
      path + '/approvals',
      { expectedRevision: partial.bookingRevision },
      'own',
    );
    expect(completed.status).toBe(200);
    const list = await get(f.path, 'own');
    expect(contractsResponseSchema.parse(list.body as unknown).data.eligibleForDeposit).toBe(true);
  }, 30_000);
  it('enforces authentication, Staff/outsider concealment and authorized idempotent replay on every contract route', async () => {
    const f = await fixture(),
      key = randomUUID(),
      body = draftBody(f);
    const first = await post(f.path, body, 'own', key, 'Create with replay key');
    expect(first.status).toBe(201);
    const d = contractResponseSchema.parse(first.body as unknown).data;
    const again = await post(f.path, body, 'own', key, 'Identical authorized replay');
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
    const operations = [
      ['GET', f.path, {}],
      ['POST', f.path, body],
      ...['submissions', 'approvals', 'withdrawals'].map(
        (action) =>
          [
            'POST',
            `${f.path}/${d.contract.revisionId}/${action}`,
            {
              expectedRevision: d.bookingRevision,
              ...(action === 'withdrawals' ? { reason: 'Test scope' } : {}),
            },
          ] as const,
      ),
      ['GET', `${f.path}/${d.contract.revisionId}/pdf`, {}],
    ] as const;
    for (const [method, path, input] of operations)
      for (const who of ['anonymous', 'staff', 'outsider']) {
        const r =
          method === 'GET'
            ? await get(path, who, `Access ${who} ${method}`)
            : await post(path, input, who, randomUUID(), `Access ${who} ${method}`);
        expect(r.status).toBe(who === 'anonymous' ? 401 : 404);
      }
    await database.prisma.consultationAccess.delete({
      where: {
        accountId_consultationId: { accountId: accounts.own, consultationId: f.consultationId },
      },
    });
    expect((await post(f.path, body, 'own', key, 'Replay after access revoked')).status).toBe(404);
  }, 30_000);
  it('pins full-total checkout, rejects edits, verifies controlled IPN and records exactly one obligation/payment', async () => {
    const f = await fixture();
    const path = `/bookings/${f.id}/payments/deposit`;
    const initial = await draft(f);
    expect(
      (
        await post(
          path,
          { timelineRevisionId: f.timelineId },
          'own',
          randomUUID(),
          'Deposit before contract approval',
        )
      ).status,
    ).toBe(409);
    const d = await approved(f, initial);
    const body = {
      timelineRevisionId: f.timelineId,
      contractRevisionId: d.contract.revisionId,
      documentDigest: d.contract.documentDigest,
    };
    expect(
      (
        await post(
          path,
          { timelineRevisionId: f.timelineId },
          'own',
          randomUUID(),
          'Missing exact contract identity',
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await post(
          path,
          { ...body, documentDigest: '0'.repeat(64) },
          'own',
          randomUUID(),
          'Wrong document digest',
        )
      ).status,
    ).toBe(409);
    const key = randomUUID();
    const created = await post(path, body, 'own', key, 'Full-total deposit checkout');
    expect(created.status).toBe(201);
    const attempt = checkoutResponseSchema.parse(created.body as unknown).data;
    expect(new URL(attempt.checkoutUrl).searchParams.get('vnp_Amount')).toBe(String(deposit * 100));
    const replay = await post(path, body, 'own', key, 'Replay checkout');
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(created.body);
    const statusPath = `/bookings/${f.id}/payments/${attempt.paymentAttemptId}`;
    const status = await get(statusPath, 'own', 'Pending attempt');
    expect(status.status).toBe(200);
    expect(attemptResponseSchema.parse(status.body as unknown).data).toMatchObject({
      purpose: 'DEPOSIT',
      amountVnd: deposit,
    });
    const current = contractsResponseSchema.parse((await get(f.path, 'own')).body as unknown).data;
    expect(
      (
        await post(
          f.path,
          {
            ...draftBody(f),
            expectedRevision: current.bookingRevision,
            predecessorRevisionId: d.contract.revisionId,
          },
          'own',
          randomUUID(),
          'Edit during active deposit',
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await post(
          `${f.path}/${d.contract.revisionId}/withdrawals`,
          { expectedRevision: current.bookingRevision, reason: 'Pinned' },
          'own',
          randomUUID(),
          'Withdrawal during active deposit',
        )
      ).status,
    ).toBe(409);
    const callback = '/billing/callbacks/vnpay?';
    const valid = ipnFixture(attempt.paymentAttemptId, {
      vnp_Amount: String(deposit * 100),
      vnp_PayDate: '20261011100000',
    });
    const invalid = await get(
      callback + valid.replace(/vnp_SecureHash=[a-f0-9]+/, 'vnp_SecureHash=' + '0'.repeat(128)),
      'anonymous',
      'Bad IPN signature',
    );
    expect(invalid.status).toBe(200);
    expect(invalid.body).toMatchObject({ RspCode: '97' });
    const accepted = await get(callback + valid, 'anonymous', 'Verified controlled IPN');
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ RspCode: '00' });
    const duplicate = await get(callback + valid, 'anonymous', 'Duplicate IPN');
    expect(duplicate.status).toBe(200);
    expect(duplicate.body).toMatchObject({ RspCode: '02' });
    const final = await get(statusPath, 'own', 'Settled attempt');
    expect(final.status).toBe(200);
    expect(attemptResponseSchema.parse(final.body as unknown).data).toMatchObject({
      status: 'SUCCEEDED',
      applicationStatus: 'SUCCEEDED',
    });
    const bill = await get(`/bookings/${f.id}/billing`, 'own', 'Contract billing totals');
    expect(bill.status).toBe(200);
    const result = billingResponseSchema.parse(bill.body as unknown).data;
    expect(result.totals).toMatchObject({
      acceptedChargesVnd: total,
      paidVnd: deposit,
      netPaidVnd: deposit,
      outstandingVnd: total - deposit,
    });
    expect(result.history).toHaveLength(2);
    expect(result.history.filter((e) => e.sourceType === 'CONTRACT')).toHaveLength(1);
    expect(await database.prisma.booking.findUniqueOrThrow({ where: { id: f.id } })).toMatchObject({
      phase: 'CONFIRMED',
    });
    expect((await get(f.path, 'own')).status).toBe(200);
  }, 30_000);
  it('records manual full-contract deposit atomically, rejects wrong amount/authority and replays once', async () => {
    const f = await fixture(),
      d = await approved(f),
      path = '/management/billing/payments/manual';
    const body = {
      bookingId: f.id,
      purpose: 'DEPOSIT',
      contractRevisionId: d.contract.revisionId,
      documentDigest: d.contract.documentDigest,
      amountVnd: deposit,
      settledAt: new Date().toISOString(),
      reason: 'Thu cọc thử nghiệm',
      evidenceReference: 'LOCAL-STEP4-RECEIPT',
    };
    expect(
      (await post(path, body, 'own', randomUUID(), 'Couple denied manual deposit')).status,
    ).toBe(403);
    expect(
      (await post(path, { ...body, amountVnd: 1 }, 'manager', randomUUID(), 'Wrong manual amount'))
        .status,
    ).toBe(409);
    const key = randomUUID(),
      first = await post(path, body, 'manager', key, 'Manual full-contract deposit');
    expect(first.status).toBe(201);
    paymentResponseSchema.parse(first.body as unknown);
    const replay = await post(path, body, 'manager', key, 'Replay manual deposit');
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    const bill = await get(`/bookings/${f.id}/billing`, 'own', 'Manual deposit billing');
    expect(bill.status).toBe(200);
    const result = billingResponseSchema.parse(bill.body as unknown).data;
    expect(result.history).toHaveLength(2);
    expect(result.totals).toMatchObject({
      acceptedChargesVnd: total,
      paidVnd: deposit,
      outstandingVnd: total - deposit,
    });
  }, 30_000);
});
