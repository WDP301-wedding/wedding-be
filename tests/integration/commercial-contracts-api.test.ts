import { registerAnalyticsCommercialCases } from './analytics-commercial-cases.js';
import { registerDepositPolicyCases } from './deposit-policy-api-cases.js';
import { registerIncidentalApprovalCases } from './incidental-approval-api-cases.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { registerPrintAppendixRequestCases } from './print-appendix-requests-api-cases.js';
import { registerGuestCompletionCases } from './guest-management-completion-cases.js';
import { registerReleaseDemoCases } from './release-demo-cases.js';
import { registerPerformanceBookingCases } from './performance-booking-cases.js';
import { createStaffSeatingServices } from '../../src/modules/staff-operations/infrastructure/staff-seating.composition.js';
import { registerStepSixApiCases } from './commercial-step6-api-cases.js';
import { registerCommercialAcceptanceCases } from './commercial-acceptance-api-cases.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import request, { type Response } from 'supertest';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createInvitationStudioServices } from '../../src/modules/invitation-studio/infrastructure/studio.composition.js';
import { createStudioRouter } from '../../src/modules/invitation-studio/http/studio.router.js';
import { controlledStorage } from './invitation-studio/controlled-storage.js';
import { parseEnvironment } from '../../src/config/env.js';
import { CATALOG_SEED_IDS, seedVenueCatalog } from '../../scripts/catalog-seed.js';
import { createBookingLifecycleRuntime } from '../../src/modules/booking-lifecycle/booking-lifecycle.runtime.js';
import { overviewResponseSchema } from '../../src/modules/booking-lifecycle/http/experience.schemas.js';
import { createVenueCatalogRuntime } from '../../src/modules/venue-catalog/venue-catalog.runtime.js';
import { createPaymentsBillingProviders } from '../../src/modules/payments-billing/payments-billing.providers.js';
import { createPaymentsBillingHttpServices } from '../../src/modules/payments-billing/http/payments-billing.http-services.js';
import { createPaymentsBillingRouter } from '../../src/modules/payments-billing/http/payments-billing.router.js';
import { createPrismaSessionRepository } from '../../src/modules/identity-access/session/session.repository.js';
import { hashOpaqueToken } from '../../src/modules/identity-access/crypto/token.js';
import { createAuthenticatedActorResolver } from '../../src/modules/identity-access/authorization/authenticated-actor.middleware.js';
import {
  checkedSum,
  contractDeposit,
  contractPreviewResponseSchema,
  contractResponseSchema,
  contractsResponseSchema,
  documentDigest,
} from '../../src/modules/booking-lifecycle/domain/commercial-contract.js';
import { createCommercialSelectionReader } from '../../src/modules/venue-catalog/application/commercial-selection.reader.js';
import { selectionResponseSchema } from '../../src/modules/booking-lifecycle/domain/commercial-selections.js';
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
  let lockObserver: Client | undefined;
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
  const total = 46_500_000,
    deposit = 13_950_000;

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
    const nativeNow = new Date(),
      nativeExpires = new Date(nativeNow.getTime() + 3_600_000);
    tokens.android = 'wia_' + randomBytes(32).toString('base64url');
    await sessions.createSession({
      accountId: accounts.own,
      clientKind: 'ANDROID',
      accessTokenHash: hashOpaqueToken(tokens.android, 'access'),
      refreshTokenHash: hashOpaqueToken(randomBytes(32).toString('hex'), 'refresh'),
      accessExpiresAt: nativeExpires,
      idleExpiresAt: nativeExpires,
      absoluteExpiresAt: nativeExpires,
      now: nativeNow,
    });
    url.pathname = '/' + database.databaseName;
    url.searchParams.delete('schema');
    url.searchParams.delete('options');
    // Synthetic blocker/observer are test infrastructure, outside owner pools.
    // Competing commands retain the same bounded runtime clients as production.
    lockObserver = new Client({
      connectionString: url.toString(),
      connectionTimeoutMillis: 2000,
      statement_timeout: 2000,
      application_name: 'commercial-race-observer',
    });
    await lockObserver.connect();
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
      // The full API matrix sends >1,000 requests/minute. Production defaults and
      // dedicated rate-limit tests remain unchanged.
      securityConfig: {
        ...config.security,
        rateLimit: { ...config.security.rateLimit, maxRequests: 10000 },
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
    await lockObserver?.end();
    await database.disconnect();
  });
  async function fixture(names = true, couple = 'own') {
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
      couple,
    );
    expect(saved.status).toBe(201);
    let timeline = timelineResultResponseSchema.parse(saved.body as unknown).data;
    for (const who of ['manager', couple]) {
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
    await lockObserver!.query('BEGIN');
    let responses: Promise<Response[]>;
    let waiters = 0;
    try {
      await lockObserver!.query('SELECT pg_advisory_xact_lock(hashtext($1))', [f.id]);
      await lockObserver!.query('SELECT id FROM "Booking" WHERE id=$1::uuid FOR UPDATE', [f.id]);
      responses = Promise.all(commands.map((command) => command()));
      for (let i = 0; i < 100 && waiters < 2; i++) {
        // The blocker transaction must not reuse its first activity snapshot.
        await lockObserver!.query('SELECT pg_stat_clear_snapshot()');
        const { rows } = await lockObserver!.query<{ count: string }>(`
          SELECT count(*) FROM pg_stat_activity
          WHERE datname=current_database() AND wait_event_type='Lock'
        `);
        waiters = Number(rows[0]!.count);
        if (waiters < 2) await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } finally {
      await lockObserver!.query('ROLLBACK');
    }
    const resolved = await responses;
    expect(waiters).toBe(2);
    return resolved;
  }
  const paidLines = () => lines.filter(({ category }) => category !== 'PRINT');
  const draftBody = (f: Fixture) => ({
    expectedRevision: f.revision,
    predecessorRevisionId: null,
    timelineRevisionId: f.timelineId,
    lines: paidLines(),
  });
  async function submitSelections(f: Fixture, selections = paidLines(), couple = 'own') {
    const path = `/bookings/${f.id}/contract-selections`;
    const saved = await post(
      path + '/drafts',
      { expectedRevision: f.revision, lines: selections },
      couple,
    );
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const draft = selectionResponseSchema.parse(saved.body as unknown).data;
    const submitted = await post(
      path + '/submissions',
      {
        expectedRevision: draft.bookingRevision,
        selectionRevisionId: draft.selection.revisionId,
      },
      couple,
    );
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    return {
      ...f,
      revision: selectionResponseSchema.parse(submitted.body as unknown).data.bookingRevision,
    };
  }
  async function createDraft(f: Fixture) {
    const r = await post(f.path, draftBody(f));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return contractResponseSchema.parse(r.body as unknown).data;
  }
  async function draft(f: Fixture, couple = 'own') {
    return createDraft(await submitSelections(f, paidLines(), couple));
  }
  async function approved(f: Fixture, initial?: Awaited<ReturnType<typeof draft>>, couple = 'own') {
    let d = initial ?? (await draft(f, couple));
    if (d.contract.state === 'DRAFT') {
      const submitted = await post(`${f.path}/${d.contract.revisionId}/submissions`, {
        expectedRevision: d.bookingRevision,
      });
      expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
      d = contractResponseSchema.parse(submitted.body as unknown).data;
    }
    for (const who of ['manager', couple]) {
      const r = await post(
        `${f.path}/${d.contract.revisionId}/approvals`,
        { expectedRevision: d.bookingRevision },
        who,
      );
      expect(r.status).toBe(200);
      d = contractResponseSchema.parse(r.body as unknown).data;
    }
    expect(d.contract.state).toBe('APPROVED');
    return d;
  }
  async function historicalPrintContract(f: Fixture, selections: typeof lines) {
    // Historical contracts included print before deposit. Seed that retained input in
    // the disposable database, then exercise approvals and fulfillment through HTTP.
    const withoutPrint = selections.filter(({ category }) => category !== 'PRINT');
    const selected = await submitSelections(f, withoutPrint);
    const response = await post(f.path + '/preview', {
      ...draftBody(selected),
      lines: withoutPrint,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const document = contractPreviewResponseSchema.parse(response.body as unknown).data.document;
    delete document.standardTerms;
    const catalog = createCommercialSelectionReader(database.prisma);
    const resolved = await catalog.requireSelections(selections, document.restaurantId);
    document.lines = selections.map((line) => resolved.get(line.category + line.sourceId)!);
    document.contractTotalVnd = checkedSum(document.lines.map((line) => line.lineTotalVnd));
    document.depositAmountVnd = contractDeposit(document.contractTotalVnd);
    const revisionId = randomUUID();
    await database.prisma.$transaction(async (tx) => {
      await tx.commercialContract.create({ data: { bookingId: f.id } });
      await tx.commercialContractRevision.create({
        data: {
          id: revisionId,
          bookingId: f.id,
          revisionNumber: 1,
          timelineRevisionId: f.timelineId,
          document,
          documentDigest: documentDigest(document),
          contractTotalVnd: document.contractTotalVnd,
          depositAmountVnd: document.depositAmountVnd,
          createdByAccountId: accounts.manager,
          createdAt: new Date(),
          lines: {
            create: document.lines.map((line, displayOrder) => ({
              ...line,
              id: randomUUID(),
              displayOrder,
            })),
          },
        },
      });
      await tx.commercialContract.update({
        where: { bookingId: f.id },
        data: { currentRevisionId: revisionId },
      });
      await tx.commercialContractRevision.update({
        where: { id: revisionId },
        data: { state: 'AWAITING_APPROVAL', submittedAt: new Date() },
      });
      await tx.booking.update({ where: { id: f.id }, data: { revision: { increment: 1 } } });
    });
    const state = contractsResponseSchema.parse((await get(f.path, 'own')).body as unknown).data;
    return approved(f, { contract: state.revisions[0]!, bookingRevision: state.bookingRevision });
  }
  async function paidFixture(
    past = false,
    historicalSelections?: typeof lines,
    incidentalPolicy: 'legacy' | 'current' = 'legacy',
  ) {
    const f = await fixture();
    if (incidentalPolicy === 'legacy') {
      // Baseline settlement cases exercise pre-amendment agreements. Seed that
      // historical shape before any contract/payment exists, in this disposable
      // database only. Current-policy acceptance explicitly selects 'current'.
      await database.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          'ALTER TABLE "Booking" DISABLE TRIGGER booking_incidental_pricing',
        );
        await tx.booking.update({
          where: { id: f.id },
          data: { incidentalPolicyVersion: null, incidentalPricing: Prisma.DbNull },
        });
        await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
        await tx.$executeRawUnsafe(
          'ALTER TABLE "Booking" ENABLE TRIGGER booking_incidental_pricing',
        );
      });
    }
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
    const d = historicalSelections
      ? await historicalPrintContract(f, historicalSelections)
      : await approved(f);
    const payment = await post('/management/billing/payments/manual', {
      bookingId: f.id,
      purpose: 'DEPOSIT',
      contractRevisionId: d.contract.revisionId,
      documentDigest: d.contract.documentDigest,
      amountVnd: d.contract.document.depositAmountVnd,
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
    submitSelections,
    historicalPrintContract,
    approved,
    paidFixture,
    race,
    getLines: () => lines,
    accounts,
    total,
    deposit,
  };
  registerCommercialAcceptanceCases(harness);
  registerDepositPolicyCases(harness);
  registerIncidentalApprovalCases(harness);
  registerPrintAppendixRequestCases(harness);
  registerAnalyticsCommercialCases(harness);
  registerStepSixApiCases(harness);
  registerReleaseDemoCases(harness, () => ({
    studio,
    context: (who) => ({
      actorId: accounts[who],
      accessToken: tokens[who]!,
      requestId: randomUUID(),
    }),
  }));
  registerPerformanceBookingCases(harness, (who) => ({
    actorId: accounts[who],
    accessToken: tokens[who]!,
    requestId: randomUUID(),
  }));
  registerGuestCompletionCases(harness, () => ({
    studio,
    staffSeating,
    context: (who) => ({
      actorId: accounts[who],
      accessToken: tokens[who]!,
      requestId: randomUUID(),
    }),
  }));
  it('allows an Android Couple to complete the pre-deposit contract and checkout while retaining deposit gates', async () => {
    await database.prisma.accountRole.upsert({
      where: { accountId_role: { accountId: accounts.own, role: 'COUPLE' } },
      create: { accountId: accounts.own, role: 'COUPLE' },
      update: {},
    });
    const f = await fixture(true, 'android');
    const overview = await get('/couple/bookings?client=ANDROID', 'android');
    expect(overview.status).toBe(200);
    expect(
      overviewResponseSchema.parse(overview.body).data.find((item) => item.bookingId === f.id),
    ).toMatchObject({
      accessLevel: 'RESTRICTED',
      phase: 'DRAFT',
    });
    expect((await get(`/consultations/${f.consultationId}/couple-profile`, 'android')).status).toBe(
      200,
    );
    expect((await get(`/bookings/${f.id}/proposal`, 'android')).status).toBe(200);
    const initial = await draft(f, 'android');
    expect(
      (
        await post(
          `/bookings/${f.id}/payments/deposit`,
          { timelineRevisionId: f.timelineId },
          'android',
        )
      ).status,
    ).toBe(409);
    const d = await approved(f, initial, 'android');
    expect((await get(`${f.path}/${d.contract.revisionId}/pdf`, 'android')).status).toBe(200);
    const path = `/bookings/${f.id}/payments/deposit`;
    const body = {
      timelineRevisionId: f.timelineId,
      contractRevisionId: d.contract.revisionId,
      documentDigest: d.contract.documentDigest,
    };
    const key = randomUUID();
    const checkout = await post(path, body, 'android', key);
    expect(checkout.status).toBe(201);
    expect((await post(path, body, 'android', key)).body).toEqual(checkout.body);
    const attempt = checkoutResponseSchema.parse(checkout.body).data;
    const status = await get(`/bookings/${f.id}/payments/${attempt.paymentAttemptId}`, 'android');
    expect(status.status).toBe(200);
    expect(attemptResponseSchema.parse(status.body).data).toMatchObject({
      purpose: 'DEPOSIT',
      amountVnd: deposit,
    });
    const grant = await database.prisma.consultationAccess.findUniqueOrThrow({
      where: {
        accountId_consultationId: { accountId: accounts.own, consultationId: f.consultationId },
      },
    });
    expect(grant).toMatchObject({ level: 'RESTRICTED', sourcePaymentId: null, promotedAt: null });
    expect(
      (await get(`/bookings/${f.id}/payments/${attempt.paymentAttemptId}`, 'outsider')).status,
    ).toBe(404);
    expect((await get(`/bookings/${f.id}/billing`, 'android')).status).toBe(403);
  }, 30_000);

  it('previews the submitted terms and locks the mutually approved contract and its retained PDF', async () => {
    const f = await fixture();
    const empty = await get(f.path, 'own', 'List before the first contract');
    expect(empty.status).toBe(200);
    expect(contractsResponseSchema.parse(empty.body as unknown).data).toMatchObject({
      modelVersion: 'FULL_CONTRACT_V1',
      revisions: [],
    });
    const initial = await draft(f);
    const path = `${f.path}/${initial.contract.revisionId}`;
    expect((await get(path + '/pdf', 'own')).status).toBe(404);
    expect((await get(path + '/pdf', 'manager')).status).toBe(200);
    const submitted = await post(path + '/submissions', {
      expectedRevision: initial.bookingRevision,
    });
    expect(submitted.status).toBe(200);
    const pending = contractResponseSchema.parse(submitted.body as unknown).data;
    expect(pending.contract.document).toMatchObject({
      standardTerms: {
        version: 'WEDDING_STANDARD_V1',
        reserveMenu: {
          versionId: CATALOG_SEED_IDS.classicMenuVersion,
          name: 'Classic Celebration',
          dishes: ['Lotus Salad', 'Roasted Chicken'],
        },
      },
    });
    const preview = await get(path + '/pdf', 'own', 'Submitted PDF preview');
    expect(preview.status).toBe(200);
    let d = pending;
    for (const who of ['manager', 'own']) {
      const approval = await post(
        path + '/approvals',
        { expectedRevision: d.bookingRevision },
        who,
      );
      expect(approval.status).toBe(200);
      d = contractResponseSchema.parse(approval.body as unknown).data;
    }
    expect(d.contract.state).toBe('APPROVED');
    expect(d.contract.documentDigest).toBe(pending.contract.documentDigest);
    expect(d.contract.document).toMatchObject({
      tableCount: 12,
      contractTotalVnd: 46_500_000,
      depositAmountVnd: 13_950_000,
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
    expect(withdrawn.status).toBe(409);
    expect(withdrawn.body).toMatchObject({ error: { code: 'CONTRACT_NOT_EDITABLE' } });
    const timelineWithdrawal = await post(
      `/bookings/${f.id}/timeline-revisions/${f.timelineId}/withdrawals`,
      { expectedRevision: d.bookingRevision, reason: 'Cần đổi lịch trình' },
    );
    expect(timelineWithdrawal.status).toBe(409);
    expect(timelineWithdrawal.body).toMatchObject({ error: { code: 'CONTRACT_NOT_EDITABLE' } });
    const history = await get(f.path, 'own', 'History after withdrawal');
    expect(history.status).toBe(200);
    const snapshot = contractsResponseSchema.parse(history.body as unknown).data;
    expect(snapshot.capabilities.canWithdrawApproval).toBe(false);
    expect(snapshot.revisions).toHaveLength(1);
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
    const stale = await post(f.path, body, 'manager', randomUUID(), 'Stale booking revision');
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: { code: 'CONTRACT_REVISION_STALE' } });
    const missing = await post(
      `${f.path}/${d.contract.revisionId}/submissions`,
      { expectedRevision: d.bookingRevision },
      'manager',
      randomUUID(),
      'Missing bride/groom names',
    );
    expect(missing.status).toBe(409);
    expect(missing.body).toMatchObject({ error: { code: 'COUPLE_NAMES_INCOMPLETE' } });
  }, 30_000);
  it('serializes concurrent draft conversion and approvals into one write and a replayable stale conflict', async () => {
    const f = await submitSelections(await fixture());
    const keys = [randomUUID(), randomUUID()];
    const converted = await race(
      f,
      keys.map((key) => () => post(f.path, draftBody(f), 'manager', key)),
    );
    expect(converted.map((r) => r.status).sort()).toEqual([201, 409]);
    const winner = converted.find((r) => r.status === 201)!;
    const d = contractResponseSchema.parse(winner.body as unknown).data;
    const submitted = await post(
      `${f.path}/${d.contract.revisionId}/submissions`,
      { expectedRevision: d.bookingRevision },
      'manager',
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
    const f = await submitSelections(await fixture());
    for (const [body, code] of [
      [
        {
          ...draftBody(f),
          lines: paidLines().map((line, i) => (i === 0 ? { ...line, quantity: 501 } : line)),
        },
        'CONTRACT_CAPACITY_EXCEEDED',
      ],
      [{ ...draftBody(f), timelineRevisionId: randomUUID() }, 'COMMERCIAL_PREDECESSOR_STALE'],
      [{ ...draftBody(f), predecessorRevisionId: randomUUID() }, 'COMMERCIAL_PREDECESSOR_STALE'],
      [
        {
          ...draftBody(f),
          lines: paidLines().map((line, i) =>
            i === 0 ? { ...line, sourceRevisionId: randomUUID() } : line,
          ),
        },
        'COMMERCIAL_PRICE_REVISION_STALE',
      ],
    ] as const) {
      const r = await post(f.path, body);
      expect(r.status).toBe(409);
      expect(r.body).toMatchObject({ error: { code } });
    }
    const d = await createDraft(f),
      path = `${f.path}/${d.contract.revisionId}`;
    const preview = await get(path + '/pdf', 'manager');
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
      const changed = await post(path + '/submissions', { expectedRevision: d.bookingRevision });
      expect(changed.status).toBe(409);
      expect(changed.body).toMatchObject({ error: { code: 'COMMERCIAL_PRICE_REVISION_STALE' } });
    } finally {
      await database.prisma.consultation.update({
        where: { id: f.consultationId },
        data: { groomName: 'Trần Minh' },
      });
    }
    const submitted = await post(path + '/submissions', { expectedRevision: d.bookingRevision });
    const pending = contractResponseSchema.parse(submitted.body as unknown).data;
    expect(
      (await post(path + '/submissions', { expectedRevision: pending.bookingRevision })).status,
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
  it('returns a submitted contract for changes without carrying over the Manager approval', async () => {
    const f = await fixture();
    const initial = await draft(f);
    const path = `${f.path}/${initial.contract.revisionId}`;
    const submitted = await post(path + '/submissions', {
      expectedRevision: initial.bookingRevision,
    });
    const pending = contractResponseSchema.parse(submitted.body as unknown).data;
    const approvedOnce = await post(path + '/approvals', {
      expectedRevision: pending.bookingRevision,
    });
    const partial = contractResponseSchema.parse(approvedOnce.body as unknown).data;
    const reason = 'Cần điều chỉnh số bàn';
    const requestBody = { expectedRevision: partial.bookingRevision, reason };
    expect((await post(path + '/change-requests', requestBody, 'manager')).status).toBe(404);
    const response = await post(path + '/change-requests', requestBody, 'own');
    expect(response.status).toBe(200);
    const returned = contractResponseSchema.parse(response.body as unknown).data;
    expect(returned.contract).toMatchObject({
      state: 'DRAFT',
      predecessorRevisionId: initial.contract.revisionId,
      approvals: [],
    });
    const history = contractsResponseSchema.parse((await get(f.path)).body as unknown).data;
    expect(history.changeRequestReason).toBe(reason);
    expect(history.revisions[1]).toMatchObject({
      state: 'SUPERSEDED',
      approvals: [{ party: 'MANAGER' }],
    });
    expect((await get(`${f.path}/${returned.contract.revisionId}/pdf`, 'own')).status).toBe(404);
    expect(
      (await post(path + '/approvals', { expectedRevision: returned.bookingRevision }, 'own'))
        .status,
    ).toBe(404);
  }, 30_000);
  it('enforces authentication, Staff/outsider concealment and authorized idempotent replay on every contract route', async () => {
    const f = await submitSelections(await fixture()),
      key = randomUUID(),
      body = draftBody(f);
    expect((await post(f.path, body, 'own')).status).toBe(404);
    const first = await post(f.path, body, 'manager', key, 'Create with replay key');
    expect(first.status).toBe(201);
    const d = contractResponseSchema.parse(first.body as unknown).data;
    const again = await post(f.path, body, 'manager', key, 'Identical authorized replay');
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
          'manager',
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
