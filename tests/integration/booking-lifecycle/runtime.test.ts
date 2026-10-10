import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { seedVenueCatalog, CATALOG_SEED_IDS } from '../../../scripts/catalog-seed.js';
import { createApp } from '../../../src/app.js';
import { parseEnvironment, type BackendConfig } from '../../../src/config/env.js';
import { hashPassword } from '../../../src/modules/identity-access/crypto/password.js';
import {
  createIdentityRuntime,
  type IdentityRuntime,
} from '../../../src/modules/identity-access/identity.runtime.js';
import { issuedSessionResponseSchema } from '../../../src/modules/identity-access/identity.schemas.js';
import {
  createBookingLifecycleRuntime,
  type BookingLifecycleRuntime,
} from '../../../src/modules/booking-lifecycle/booking-lifecycle.runtime.js';
import {
  bookingResponseSchema,
  consultationResponseSchema,
} from '../../../src/modules/booking-lifecycle/http/booking-lifecycle.schemas.js';
import {
  proposalResponseSchema,
  timelineResultResponseSchema,
  holdResponseSchema,
} from '../../../src/modules/booking-lifecycle/http/booking-lifecycle.responses.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';

const describeWithDatabase = catalogMigrationDatabaseUrl ? describe : describe.skip;
const managerId = randomUUID();
const coupleId = randomUUID();
const outsiderId = randomUUID();
const password = 'booking-test-password';
const scrypt = {
  cost: 2,
  blockSize: 1,
  parallelization: 1,
  keyLengthBytes: 16,
  maxMemoryBytes: 4096,
};

describeWithDatabase('booking runtime with real identity, venue, and PostgreSQL', () => {
  const database = new CatalogTestDatabase('booking_runtime');
  let identity: IdentityRuntime | undefined;
  let booking: BookingLifecycleRuntime | undefined;
  let app: ReturnType<typeof createApp>;
  let managerToken: string;
  let coupleToken: string;
  let outsiderToken: string;
  let runtimeConfig: BackendConfig;

  beforeAll(async () => {
    await database.connect();
    const verifier = await hashPassword(password, {
      minimumCharacters: 12,
      maximumCharacters: 128,
      maximumBytes: 512,
      scrypt,
    });
    for (const [id, role] of [
      [managerId, 'MANAGER'],
      [coupleId, null],
      [outsiderId, 'COUPLE'],
    ] as const) {
      await database.prisma.account.create({
        data: {
          id,
          emailNormalized: `${id}@example.com`,
          displayEmail: `${id}@example.com`,
          ...(role === null ? {} : { roles: { create: { role } } }),
          passwordCredential: {
            create: {
              algorithm: verifier.algorithm,
              version: verifier.version,
              ...verifier.parameters,
              saltEncoded: verifier.saltEncoded,
              derivedKeyEncoded: verifier.derivedKeyEncoded,
            },
          },
        },
      });
    }
    await seedVenueCatalog(database.prisma);
    const url = new URL(catalogMigrationDatabaseUrl!);
    url.pathname = `/${database.databaseName}`;
    url.searchParams.delete('schema');
    url.searchParams.delete('options');
    const parsed = parseEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: url.toString(),
      CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
    });
    const config = {
      ...parsed,
      identityAccess: {
        ...parsed.identityAccess,
        password: { ...parsed.identityAccess.password, scrypt },
      },
    };
    runtimeConfig = config;
    identity = await createIdentityRuntime(config);
    booking = await createBookingLifecycleRuntime(config);
    app = createApp({
      runtimeEnvironment: 'test',
      registerRoutes: (express) => {
        express.use('/api/v1', identity!.router);
        express.use('/api/v1', booking!.router);
      },
    });
    const login = async (id: string) => {
      const response = await request(app)
        .post('/api/v1/auth/android-sessions')
        .send({ email: `${id}@example.com`, password });
      expect(response.status).toBe(201);
      return issuedSessionResponseSchema.parse(response.body as unknown).data.accessToken;
    };
    managerToken = await login(managerId);
    coupleToken = await login(coupleId);
    outsiderToken = await login(outsiderId);
  }, 60000);

  afterAll(async () => {
    await booking?.resource.close();
    await identity?.resource.close();
    await database.disconnect();
  });

  const post = (path: string, body: object, token = managerToken, key = randomUUID()) =>
    request(app)
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(body);
  const getProposal = async (id: string, token = managerToken) => {
    const response = await request(app)
      .get(`/api/v1/bookings/${id}/proposal`)
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    return proposalResponseSchema.parse(response.body as unknown).data;
  };

  it('composes offline fallback and configured email delivery, and disconnects on invalid production origin', async () => {
    const fallback = await createBookingLifecycleRuntime({
      ...runtimeConfig,
      cors: { allowedOrigins: [] },
    });
    await fallback.resource.close();
    const email = await createBookingLifecycleRuntime({
      ...runtimeConfig,
      email: {
        ...runtimeConfig.email,
        enabled: true,
        provider: 'resend',
        resendApiKey: 're_test_only',
        fromEmail: 'Wedding Test <notifications@example.com>',
      },
    });
    await email.resource.close();
    await expect(
      createBookingLifecycleRuntime({
        ...runtimeConfig,
        cors: { allowedOrigins: [] },
        runtime: { ...runtimeConfig.runtime, environment: 'production' },
      }),
    ).rejects.toThrow('configured Public Web origin');
    const anonymous = await request(app).get(`/api/v1/bookings/${randomUUID()}/proposal`);
    expect(anonymous.status).toBe(401);
    const denied = await post(
      '/management/consultations',
      { intendedEmail: 'other@example.com', displayName: 'Other' },
      outsiderToken,
    );
    expect(denied.status).toBe(403);
    const workerContext = {
      requestId: randomUUID(),
      causationId: randomUUID(),
      actorAccountId: null,
      authority: 'SYSTEM' as const,
    };
    const worker = booking!.providers.createAutomationWorker((context) => {
      expect(context).toEqual(workerContext);
      return Promise.resolve();
    });
    expect(
      await worker.listDue(
        { kind: 'COMPLETION', dueBefore: '2026-01-01T00:00:00.000Z', limit: 100 },
        workerContext,
      ),
    ).toEqual({ items: [], nextCursor: null });
  });

  it('delivers one consultation invitation through configured Brevo and replays its HTTP intent', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ messageId: '<booking-invitation@brevo.example>' }), {
          status: 201,
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    let configuredBooking: BookingLifecycleRuntime | undefined;
    try {
      configuredBooking = await createBookingLifecycleRuntime({
        ...runtimeConfig,
        email: {
          enabled: true,
          provider: 'brevo',
          apiKey: 'booking-test-only-key',
          fromEmail: 'Wedding Test <sender@example.com>',
        },
      });
      const configuredApp = createApp({
        runtimeEnvironment: 'test',
        registerRoutes: (express) => express.use('/api/v1', configuredBooking!.router),
      });
      const createdResponse = await request(configuredApp)
        .post('/api/v1/management/consultations')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ intendedEmail: 'brevo-couple@example.com', displayName: 'Brevo Couple' });
      expect(createdResponse.status).toBe(201);
      const created = consultationResponseSchema.parse(createdResponse.body as unknown).data;
      const key = randomUUID();
      const invite = () =>
        request(configuredApp)
          .post(`/api/v1/management/consultations/${created.consultationId}/workspace-invitations`)
          .set('Authorization', `Bearer ${managerToken}`)
          .set('Idempotency-Key', key)
          .send({ expectedRevision: created.revision });
      expect((await invite()).status).toBe(202);
      expect((await invite()).status).toBe(202);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.brevo.com/v3/smtp/email');
      const body = fetchMock.mock.calls[0]?.[1]?.body;
      if (typeof body !== 'string') throw new Error('Expected a JSON invitation request.');
      expect(JSON.parse(body) as unknown).toMatchObject({
        sender: { email: 'sender@example.com', name: 'Wedding Test' },
        to: [{ email: 'brevo-couple@example.com' }],
      });
      expect(JSON.parse(body) as unknown).toHaveProperty(
        'textContent',
        expect.stringContaining('http://localhost:3000/workspace-invitation#'),
      );
      expect(
        await database.prisma.workspaceInvitation.count({
          where: { consultationId: created.consultationId },
        }),
      ).toBe(1);
    } finally {
      await configuredBooking?.resource.close();
      vi.unstubAllGlobals();
    }
  });

  it('collaborates before deposit and retains the effective timeline until both replacement approvals commit', async () => {
    const consultation = await post('/management/consultations', {
      intendedEmail: `${coupleId}@example.com`,
      displayName: 'Garden Couple',
    });
    expect(consultation.status).toBe(201);
    const created = consultationResponseSchema.parse(consultation.body as unknown).data;
    const response = await post('/bookings', {
      consultationId: created.consultationId,
      hallId: CATALOG_SEED_IDS.lotusHall,
      eventDate: '2026-12-20',
      shiftCode: 'DINNER',
      menuPackageVersionId: CATALOG_SEED_IDS.classicMenuVersion,
      tableCount: 10,
      planningHeadcount: 100,
      expectedRevision: created.revision,
    });
    expect(response.status).toBe(201);
    const result = bookingResponseSchema.parse(response.body as unknown).data;
    expect(result.consultationRevision).toBe(2);
    const invitation = await post(
      `/management/consultations/${created.consultationId}/workspace-invitations`,
      { expectedRevision: result.consultationRevision },
    );
    expect(invitation.status).toBe(202);
    expect(
      await database.prisma.workspaceInvitation.count({
        where: { consultationId: created.consultationId },
      }),
    ).toBe(1);
    await database.prisma.consultationAccess.create({
      data: { consultationId: created.consultationId, accountId: coupleId, level: 'RESTRICTED' },
    });
    const availability = await request(app)
      .get('/api/v1/management/availability')
      .set('Authorization', `Bearer ${managerToken}`)
      .query({ hallId: CATALOG_SEED_IDS.lotusHall, eventDate: '2026-12-20', shiftCode: 'DINNER' });
    expect(availability.status).toBe(200);
    expect(availability.body).toMatchObject({ data: { available: true } });
    let proposal = await getProposal(result.bookingId, coupleToken);
    expect(proposal.capabilities.accessLevel).toBe('RESTRICTED');
    const held = await post(`/bookings/${result.bookingId}/slot-holds`, {
      expectedRevision: proposal.revision,
    });
    expect(held.status).toBe(201);
    const hold = holdResponseSchema.parse(held.body as unknown).data;
    const occupied = await request(app)
      .get('/api/v1/management/availability')
      .set('Authorization', `Bearer ${managerToken}`)
      .query({ hallId: CATALOG_SEED_IDS.lotusHall, eventDate: '2026-12-20', shiftCode: 'DINNER' });
    expect(occupied.body).toMatchObject({
      data: { available: false, activeHold: { holdId: hold.holdId } },
    });
    const items = [
      { order: 0, startTime: '18:00', title: 'Welcome' },
      { order: 1, startTime: '19:00', title: 'Ceremony', description: 'Family vows' },
    ];
    const saved = await post(
      `/bookings/${result.bookingId}/timeline-revisions`,
      { expectedRevision: hold.bookingRevision, predecessorRevisionId: null, items },
      coupleToken,
    );
    expect(saved.status).toBe(201);
    let timeline = timelineResultResponseSchema.parse(saved.body as unknown).data;
    const approve = async (token: string) => {
      const response = await post(
        `/bookings/${result.bookingId}/timeline-revisions/${timeline.revision.revisionId}/approvals`,
        { expectedRevision: timeline.bookingRevision },
        token,
      );
      expect(response.status).toBe(200);
      timeline = timelineResultResponseSchema.parse(response.body as unknown).data;
    };
    await approve(managerToken);
    await approve(coupleToken);
    const withdrawn = await post(
      `/bookings/${result.bookingId}/timeline-revisions/${timeline.revision.revisionId}/withdrawals`,
      { expectedRevision: timeline.bookingRevision, reason: 'Review welcome' },
      coupleToken,
    );
    expect(withdrawn.status).toBe(200);
    timeline = timelineResultResponseSchema.parse(withdrawn.body as unknown).data;
    expect(timeline.revision.coupleApprovedAt).toBeNull();
    await approve(coupleToken);
    const unchanged = await post(`/bookings/${result.bookingId}/timeline-revisions`, {
      expectedRevision: timeline.bookingRevision,
      predecessorRevisionId: timeline.revision.revisionId,
      items: timeline.revision.items.map(({ description, ...item }) => ({
        ...item,
        ...(description === null ? {} : { description }),
      })),
    });
    expect(unchanged.status).toBe(200);
    expect(timelineResultResponseSchema.parse(unchanged.body as unknown).data.changed).toBe(false);
    const effectiveId = timeline.revision.revisionId;
    const context = {
      requestId: randomUUID(),
      causationId: randomUUID(),
      actorAccountId: coupleId,
      authority: 'AUTHENTICATED' as const,
    };
    const eligibility = await booking!.providers.lifecycleReader.requireDepositEligibility({
      bookingId: result.bookingId,
      timelineRevisionId: effectiveId,
    });
    expect(eligibility.eligible).toBe(true);
    await expect(
      booking!.providers.boundary.run({ bookingId: result.bookingId, context }, async (scoped) => {
        const paymentAttemptId = randomUUID();
        const reserved = await booking!.providers.deposits.reserve(
          {
            bookingId: result.bookingId,
            timelineRevisionId: effectiveId,
            paymentAttemptId,
            expectedBookingRevision: timeline.bookingRevision,
            amountVnd: eligibility.depositAmountVnd,
            expiresAt: new Date(Date.now() + 900000).toISOString(),
          },
          scoped,
        );
        expect(
          (
            await booking!.providers.deposits.requireDepositEligibility(
              { bookingId: result.bookingId, timelineRevisionId: effectiveId },
              scoped,
            )
          ).bookingRevision,
        ).toBe(reserved.bookingRevision);
        await booking!.providers.deposits.recordUnknown(
          { bookingId: result.bookingId, paymentAttemptId },
          scoped,
        );
        await booking!.providers.deposits.releaseVerifiedFailure(
          { bookingId: result.bookingId, paymentAttemptId, providerEvidenceId: randomUUID() },
          scoped,
        );
        throw new Error('Abort verification fixture');
      }),
    ).rejects.toThrow('Abort verification fixture');
    await booking!.providers.deposits.reserve(
      {
        bookingId: result.bookingId,
        timelineRevisionId: effectiveId,
        paymentAttemptId: randomUUID(),
        expectedBookingRevision: timeline.bookingRevision,
        amountVnd: eligibility.depositAmountVnd,
        expiresAt: new Date(Date.now() + 900000).toISOString(),
      },
      context,
    );
    const evidence = {
      bookingId: result.bookingId,
      timelineRevisionId: effectiveId,
      paymentId: randomUUID(),
      amountVnd: eligibility.depositAmountVnd,
      settledAt: new Date(),
    };
    await expect(
      booking!.providers.boundary.run({ bookingId: result.bookingId, context }, async (scoped) => {
        await booking!.providers.deposits.recordSuccessfulDeposit(evidence, scoped);
        expect(
          await booking!.providers.lifecycleReader.requireConfirmedEventContext(result.bookingId),
        ).toMatchObject({ effectiveTimelineRevisionId: effectiveId });
        expect(
          await booking!.providers.lifecycleReader.requireBookingAccess({
            bookingId: result.bookingId,
            accountId: coupleId,
            minimum: 'FULL',
          }),
        ).toMatchObject({ phase: 'CONFIRMED' });
        expect(
          await booking!.providers.planning.getCurrent(result.bookingId, scoped),
        ).toMatchObject({ planningHeadcount: 100 });
        throw new Error('Payment owner failed after booking and identity writes');
      }),
    ).rejects.toThrow('Payment owner failed');
    expect(
      await database.prisma.bookingDepositSettlement.count({
        where: { paymentId: evidence.paymentId },
      }),
    ).toBe(0);
    expect(
      await database.prisma.consultationAccess.findUniqueOrThrow({
        where: {
          accountId_consultationId: { accountId: coupleId, consultationId: created.consultationId },
        },
      }),
    ).toMatchObject({ level: 'RESTRICTED', sourcePaymentId: null });
    expect((await getProposal(result.bookingId)).phase).toBe('AWAITING_DEPOSIT');
    await expect(
      booking!.providers.boundary.run({ bookingId: result.bookingId, context }, async (scoped) => {
        await booking!.providers.headcount.synchronize(
          {
            bookingId: result.bookingId,
            sourceGuestPlanRevisionId: randomUUID(),
            sourceSequence: 1,
            expectedAttendees: 120,
          },
          scoped,
        );
        expect(
          await booking!.providers.planning.getCurrent(result.bookingId, scoped),
        ).toMatchObject({ planningHeadcount: 120 });
        throw new Error('Guest owner failed');
      }),
    ).rejects.toThrow('Guest owner failed');
    expect(
      await database.prisma.bookingHeadcountEvidence.count({
        where: { bookingId: result.bookingId },
      }),
    ).toBe(0);
    expect(await booking!.providers.planning.getCurrent(result.bookingId, context)).toMatchObject({
      planningHeadcount: 100,
    });
    expect(await booking!.providers.deposits.recordSuccessfulDeposit(evidence)).toEqual({
      phase: 'CONFIRMED',
      replayed: false,
    });
    expect(await booking!.providers.deposits.recordSuccessfulDeposit(evidence)).toEqual({
      phase: 'CONFIRMED',
      replayed: true,
    });
    proposal = await getProposal(result.bookingId, coupleToken);
    expect(proposal.capabilities.accessLevel).toBe('FULL');
    expect(proposal.effectiveTimeline?.revisionId).toBe(effectiveId);
    const changed = await post(
      `/bookings/${result.bookingId}/change-requests`,
      {
        expectedRevision: proposal.revision,
        items: [
          {
            itemId: proposal.timeline!.items[0]!.itemId,
            order: 0,
            startTime: '18:00',
            title: 'New welcome',
          },
        ],
        reason: 'Family schedule',
      },
      coupleToken,
    );
    expect(changed.status).toBe(201);
    timeline = timelineResultResponseSchema.parse(changed.body as unknown).data;
    expect((await getProposal(result.bookingId)).effectiveTimeline?.revisionId).toBe(effectiveId);
    await approve(managerToken);
    expect((await getProposal(result.bookingId)).effectiveTimeline?.revisionId).toBe(effectiveId);
    await approve(coupleToken);
    proposal = await getProposal(result.bookingId);
    expect(proposal.effectiveTimeline?.revisionId).toBe(timeline.revision.revisionId);
    expect(proposal.effectiveTimeline?.items[0]?.title).toBe('New welcome');
    expect(
      (
        await database.prisma.bookingTimelineRevision.findUniqueOrThrow({
          where: { id: effectiveId },
        })
      ).state,
    ).toBe('SUPERSEDED');
    expect(
      await booking!.providers.timeline.resolveApprovedRevision(
        { bookingId: result.bookingId, timelineRevisionId: effectiveId },
        context,
      ),
    ).toMatchObject({ isEffective: false, items: [{ title: 'Welcome' }, { title: 'Ceremony' }] });
    expect(await booking!.providers.planning.getCurrent(result.bookingId, context)).toMatchObject({
      planningHeadcount: 100,
    });
    expect(
      await booking!.providers.commercial.getAccepted(
        { bookingId: result.bookingId, timelineRevisionId: timeline.revision.revisionId },
        context,
      ),
    ).toMatchObject({ baseChargeVnd: proposal.proposal.baseChargeVnd });
    const denied = await request(app)
      .get(`/api/v1/bookings/${result.bookingId}/proposal`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(denied.status).toBe(404);
    const notDue = await post(`/management/bookings/${result.bookingId}/completion`, {
      expectedRevision: proposal.revision,
    });
    expect(notDue.status).toBe(409);
    const cancellation = await post(
      `/bookings/${result.bookingId}/cancellation-requests`,
      { expectedRevision: proposal.revision, reason: 'Plans changed' },
      coupleToken,
    );
    expect(cancellation.status).toBe(202);
    let current = await getProposal(result.bookingId);
    const firstRequest = current.cancellationRequests![0]!;
    expect(firstRequest.reason).toBe('Plans changed');
    const decisionPath = (id: string) =>
      `/management/bookings/${result.bookingId}/cancellation-requests/${id}/decision`;
    expect(
      (
        await post(
          decisionPath(firstRequest.requestId),
          {
            expectedRevision: current.revision,
            decision: 'APPROVE',
            reason: 'Cannot decide as Couple',
          },
          coupleToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await post(decisionPath(firstRequest.requestId), {
          expectedRevision: current.revision,
          decision: 'REJECT',
          reason: 'Continue planning',
        })
      ).status,
    ).toBe(200);
    current = await getProposal(result.bookingId);
    expect(current.phase).toBe('CONFIRMED');
    expect(current.cancellationRequests).toEqual([]);
    expect(
      (
        await post(
          `/bookings/${result.bookingId}/cancellation-requests`,
          { expectedRevision: current.revision, reason: 'Final cancellation request' },
          coupleToken,
        )
      ).status,
    ).toBe(202);
    current = await getProposal(result.bookingId);
    await database.prisma.consultationAccess.create({
      data: {
        consultationId: created.consultationId,
        accountId: outsiderId,
        level: 'RESTRICTED',
      },
    });
    const cancelled = await post(decisionPath(current.cancellationRequests![0]!.requestId), {
      expectedRevision: current.revision,
      decision: 'APPROVE',
      reason: 'Approved by Manager',
    });
    expect(cancelled.status).toBe(200);
    expect((await getProposal(result.bookingId)).phase).toBe('CANCELLED');
    expect(
      await database.prisma.accountRetentionEligibilityFact.findUniqueOrThrow({
        where: {
          accountId_consultationId: { accountId: coupleId, consultationId: created.consultationId },
        },
      }),
    ).toMatchObject({ sourceBusinessRecordId: result.bookingId });
    expect(
      await database.prisma.accountRetentionEligibilityFact.count({
        where: {
          sourceBusinessRecordId: result.bookingId,
        },
      }),
    ).toBe(2);
    const events = await database.prisma.bookingOutboxEvent.findMany({
      where: { aggregateId: result.bookingId },
    });
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.eventVersion).toBe(1);
      expect(event.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    }
    const denials = await database.prisma.auditLog.findMany({
      where: { action: 'booking.access-denied' },
    });
    expect(denials.length).toBeGreaterThan(0);
    expect(JSON.stringify(denials.map((row) => row.metadata))).not.toContain('Bearer');
    const readerContext = { ...context, actorAccountId: managerId };
    const page = await booking!.providers.reporting.readPage(
      { afterSequence: 0, limit: 500 },
      readerContext,
    );
    expect(page.rows.at(-1)?.value.phase).toBe('CANCELLED');
    expect(JSON.stringify(page)).not.toContain('@example.com');
  });
});
