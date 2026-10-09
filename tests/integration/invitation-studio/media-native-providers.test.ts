import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { parseEnvironment } from '../../../src/config/env.js';
import { startServer } from '../../../src/server.js';
import { createInvitationStudioRuntime } from '../../../src/modules/invitation-studio/invitation-studio.runtime.js';
import * as storageModule from '../../../src/integrations/storage/supabase-storage-provider.js';
import {
  mediaAssetResponseSchema,
  mediaPreviewResponseSchema,
} from '../../../src/modules/invitation-studio/http/media.schemas.js';
import type { ContractContext } from '../../../src/core/database/booking-boundary.js';
import { createPersistentMediaService } from '../../../src/modules/invitation-studio/infrastructure/media.composition.js';
import { issueOpaqueToken } from '../../../src/modules/identity-access/crypto/token.js';
import { createPrismaSessionRepository } from '../../../src/modules/identity-access/session/session.repository.js';
import { controlledStorage } from './controlled-storage.js';
import { nativeBookingFixture, nativeTimelineFixture } from './native-booking-fixture.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';

const describeDatabase = catalogMigrationDatabaseUrl ? describe : describe.skip;
describeDatabase('W1 native owner readers/shared transaction, controlled Storage SDK', () => {
  const database = new CatalogTestDatabase('isw1_native');
  const now = new Date('2026-10-09T00:00:00Z');
  let bytes: Buffer;
  let bookingId: string, consultationId: string, timelineId: string, paymentId: string;
  let actor: Awaited<ReturnType<typeof identityFixture>>;
  const db = () => database.prisma;

  async function identityFixture(role: 'COUPLE' | 'MANAGER' | 'STAFF' = 'COUPLE') {
    const account = await db().account.create({
      data: {
        emailNormalized: `${randomUUID()}@example.test`,
        displayEmail: 'media@example.test',
        roles: { create: { role } },
      },
    });
    const token = issueOpaqueToken('access', 32);
    const session = await createPrismaSessionRepository(db()).createSession({
      accountId: account.id,
      clientKind: 'WEB',
      accessTokenHash: token.tokenHash,
      refreshTokenHash: issueOpaqueToken('refresh', 32).tokenHash,
      now,
      accessExpiresAt: new Date('2027-01-01T00:00:00Z'),
      idleExpiresAt: new Date('2027-01-01T00:00:00Z'),
      absoluteExpiresAt: new Date('2027-01-01T00:00:00Z'),
    });
    return {
      context: { actorId: account.id, requestId: randomUUID(), accessToken: token.token },
      sessionId: session.sessionId,
    };
  }

  beforeAll(async () => {
    await database.connect();
    bytes = await sharp({ create: { width: 5, height: 4, channels: 3, background: '#abcdef' } })
      .png()
      .toBuffer();
  }, 60_000);
  beforeEach(async () => {
    await db().$executeRawUnsafe(
      'TRUNCATE "InvitationMediaAudit", "InvitationMediaReceipt", "InvitationMediaFile", "InvitationMediaAsset", "InvitationMediaUploadAttempt", "InvitationMediaPolicy", "InvitationMediaCommand", "Booking", "Account" CASCADE',
    );
    bookingId = randomUUID();
    consultationId = randomUUID();
    timelineId = randomUUID();
    paymentId = randomUUID();
    actor = await identityFixture();
    await nativeBookingFixture(db(), {
      bookingId,
      consultationId,
      timelineId,
      paymentId,
      actorId: actor.context.actorId,
      eventDate: new Date('2026-10-15'),
      now: new Date('2026-10-08T00:00:00Z'),
    });
  });
  afterAll(async () => database.disconnect());

  function harness(clock: () => Date = () => now) {
    const storage = controlledStorage();
    const h = createPersistentMediaService(db(), storage.provider, clock);
    const input = {
      bookingId,
      bytes,
      contentType: 'image/png',
      altText: 'Ảnh cưới',
      idempotencyKey: randomUUID(),
    };
    return { ...h, storage, input, upload: () => h.service.upload(input, actor.context) };
  }
  function contract(): ContractContext {
    return {
      requestId: actor.context.requestId,
      causationId: actor.context.requestId,
      actorAccountId: actor.context.actorId,
      authority: 'AUTHENTICATED',
    };
  }

  it('uses the server clock when the composition has no test clock override', () => {
    const before = Date.now();
    const h = createPersistentMediaService(db(), controlledStorage().provider);
    expect(h.service.now().getTime()).toBeGreaterThanOrEqual(before);
    expect(h.service.now().getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('serves native media through the HTTP server runtime with durable replay and private reads', async () => {
    const url = new URL(catalogMigrationDatabaseUrl!);
    url.pathname = `/${database.databaseName}`;
    url.searchParams.delete('schema');
    url.searchParams.delete('options');
    const sdk = controlledStorage();
    const factory = vi
      .spyOn(storageModule, 'createSupabaseStorageProvider')
      .mockReturnValue(sdk.provider);
    const runtime = await createInvitationStudioRuntime({
      ...parseEnvironment({ NODE_ENV: 'test', DATABASE_URL: url.toString() }),
      storage: {
        enabled: true,
        supabaseUrl: 'https://storage.example.test',
        serviceRoleKey: 'fixture-key',
        bucket: 'private-media',
      },
    });
    const server = await startServer({
      port: 0,
      host: '127.0.0.1',
      runtimeEnvironment: 'test',
      resources: [runtime.resource],
      registerRoutes: (app) => {
        app.use('/api/v1', runtime.router);
      },
    });
    try {
      const path = `/api/v1/bookings/${bookingId}/media`;
      expect((await request(server.httpServer).post(path)).status).toBe(401);
      const key = randomUUID();
      const upload = () =>
        request(server.httpServer)
          .post(path)
          .set('Authorization', `Bearer ${actor.context.accessToken}`)
          .set('Idempotency-Key', key)
          .field('altText', 'Native original')
          .attach('file', bytes, { filename: 'photo.png', contentType: 'image/png' });
      const accepted = await upload();
      expect(accepted.status).toBe(201);
      const asset = mediaAssetResponseSchema.parse(accepted.body).data;
      expect((await upload()).body).toEqual(accepted.body);
      expect(await db().invitationMediaAsset.count()).toBe(1);
      const preview = await request(server.httpServer)
        .get(asset.previewPath)
        .set('Authorization', `Bearer ${actor.context.accessToken}`);
      expect(preview.status).toBe(200);
      expect(preview.headers['cache-control']).toBe('no-store');
      expect(mediaPreviewResponseSchema.parse(preview.body).data.expiresInSeconds).toBe(900);
      expect((await request(server.httpServer).get('/health/live')).status).toBe(200);
      expect((await request(server.httpServer).get('/api/v1/unrelated')).status).toBe(404);
    } finally {
      await server.shutdown();
      factory.mockRestore();
    }
  });

  it('mounted runtime returns 503 for disabled Storage and commits no accepted image', async () => {
    const url = new URL(catalogMigrationDatabaseUrl!);
    url.pathname = `/${database.databaseName}`;
    url.searchParams.delete('schema');
    url.searchParams.delete('options');
    const runtime = await createInvitationStudioRuntime(
      parseEnvironment({ NODE_ENV: 'test', DATABASE_URL: url.toString() }),
    );
    const server = await startServer({
      port: 0,
      host: '127.0.0.1',
      runtimeEnvironment: 'test',
      resources: [runtime.resource],
      registerRoutes: (app) => {
        app.use('/api/v1', runtime.router);
      },
    });
    try {
      const result = await request(server.httpServer)
        .post(`/api/v1/bookings/${bookingId}/media`)
        .set('Authorization', `Bearer ${actor.context.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .field('altText', 'Unavailable original')
        .attach('file', bytes, { filename: 'photo.png', contentType: 'image/png' });
      expect(result.status).toBe(503);
      expect(result.body).toMatchObject({ error: { code: 'PROVIDER_UNAVAILABLE' } });
      expect(await db().invitationMediaAsset.count()).toBe(0);
      expect(await db().invitationMediaReceipt.count()).toBe(0);
    } finally {
      await server.shutdown();
    }
  });

  it('reads native confirmed deposit/effective immutable snapshot, uploads/replaces/metadata/detaches and retains private history', async () => {
    const h = harness();
    expect((await h.guard.requireAccess(bookingId, actor.context)).eventStartAt.toISOString()).toBe(
      '2026-10-15T04:00:00.000Z',
    );
    const first = await h.upload();
    expect(await h.upload()).toEqual(first);
    const replacement = await h.service.upload(
      { ...h.input, idempotencyKey: 'replace', assetId: first.id, expectedRevision: 1 },
      actor.context,
    );
    const metadata = await h.service.updateMetadata(
      {
        bookingId,
        assetId: first.id,
        expectedRevision: replacement.revision,
        altText: 'New alt',
        idempotencyKey: 'metadata',
      },
      actor.context,
    );
    const preview = await h.service.preview({ bookingId, assetId: first.id }, actor.context);
    expect(preview.altText).toBe('New alt');
    expect(preview.expiresInSeconds).toBe(900);
    expect(
      (
        await db().invitationMediaPolicy.findUniqueOrThrow({ where: { bookingId } })
      ).cutoffAt.toISOString(),
    ).toBe('2026-10-12T04:00:00.000Z');
    await h.service.detach(
      {
        bookingId,
        assetId: first.id,
        expectedRevision: metadata.revision,
        idempotencyKey: 'detach',
      },
      actor.context,
    );
    expect(await db().invitationMediaFile.count()).toBe(3);
    expect(h.storage.bucket.remove).not.toHaveBeenCalled();
    expect(JSON.stringify(await db().invitationMediaReceipt.findMany())).not.toContain(
      actor.context.accessToken,
    );
    await expect(
      h.service.preview({ bookingId, assetId: first.id }, actor.context),
    ).rejects.toMatchObject({ status: 404 });
  });

  it.each(['DRAFT', 'AWAITING_DEPOSIT', 'CANCELLED', 'COMPLETED'] as const)(
    'denies current %s phase before provider effects',
    async (phase) => {
      await db().booking.update({ where: { id: bookingId }, data: { phase } });
      const h = harness();
      await expect(h.upload()).rejects.toMatchObject({ status: 404 });
      expect(h.storage.bucket.upload).not.toHaveBeenCalled();
      expect(await db().invitationMediaUploadAttempt.count()).toBe(0);
    },
  );

  it('denies unowned/restricted/Staff/revoked current identity and missing booking/payment', async () => {
    const h = harness();
    const outsider = await identityFixture();
    await expect(h.service.upload(h.input, outsider.context)).rejects.toMatchObject({
      status: 404,
    });
    const staff = await identityFixture('STAFF');
    await expect(h.service.upload(h.input, staff.context)).rejects.toMatchObject({ status: 404 });
    await db().consultationAccess.update({
      where: { accountId_consultationId: { accountId: actor.context.actorId, consultationId } },
      data: { level: 'RESTRICTED', bookingId: null, sourcePaymentId: null, promotedAt: null },
    });
    await expect(h.upload()).rejects.toMatchObject({ status: 403 });
    await db().session.update({
      where: { id: actor.sessionId },
      data: { status: 'REVOKED', revokedAt: now, revocationReason: 'test' },
    });
    await expect(h.upload()).rejects.toMatchObject({ status: 401 });
    await expect(h.booking.requireConfirmedEventContext(randomUUID())).rejects.toMatchObject({
      status: 404,
    });
    await expect(h.billing.requireDepositSettlement(randomUUID())).rejects.toMatchObject({
      status: 404,
    });
    expect(h.storage.bucket.upload).not.toHaveBeenCalled();
  });

  it('Manager reads originals after cutoff, changes policy with audit, and cannot upload', async () => {
    let time = now;
    const h = harness(() => time);
    const first = await h.upload();
    const manager = await identityFixture('MANAGER');
    await h.service.changeCutoff(
      { bookingId, cutoffAt: '2026-10-09T00:00:00Z', expectedRevision: 0, idempotencyKey: 'close' },
      manager.context,
    );
    time = new Date('2026-10-13T00:00:00Z');
    expect(
      (await h.service.preview({ bookingId, assetId: first.id }, manager.context)).expiresInSeconds,
    ).toBe(900);
    await expect(
      h.service.upload({ ...h.input, idempotencyKey: randomUUID() }, actor.context),
    ).rejects.toMatchObject({ code: 'MEDIA_CUTOFF_REACHED' });
    await expect(h.service.upload(h.input, manager.context)).rejects.toMatchObject({ status: 404 });
    expect(
      await db().invitationMediaAudit.findFirst({ where: { action: 'media.cutoff-changed' } }),
    ).toMatchObject({
      previousCutoffAt: new Date('2026-10-12T04:00:00Z'),
      cutoffAt: new Date('2026-10-09T00:00:00Z'),
    });
  });

  it('requires dual approval and reads the canonical booking/proposal and normalized timeline items', async () => {
    const h = harness();
    const id = randomUUID();
    await nativeTimelineFixture(db(), {
      timelineId: id,
      bookingId,
      revisionNumber: 2,
      actorId: actor.context.actorId,
      now,
      approved: false,
      startTime: '11:30',
      title: 'Next',
    });
    await db().booking.update({
      where: { id: bookingId },
      data: { effectiveTimelineRevisionId: id },
    });
    await expect(h.upload()).rejects.toMatchObject({ status: 404 });
    await db().bookingTimelineRevision.update({
      where: { id },
      data: { coupleApprovedAt: now, managerApprovedAt: now, state: 'EFFECTIVE' },
    });
    expect(
      (
        await h.timeline.resolveApprovedRevision(
          { bookingId, timelineRevisionId: timelineId },
          contract(),
        )
      ).isEffective,
    ).toBe(false);
    const effective = await h.timeline.resolveApprovedRevision(
      { bookingId, timelineRevisionId: id },
      contract(),
    );
    expect(effective).toMatchObject({
      isEffective: true,
      hallName: 'Approved hall',
      shiftStartTime: '11:00',
      shiftEndTime: '14:00',
      items: [{ order: 0, startTime: '11:30', title: 'Next', description: null }],
    });
    await expect(
      db().bookingTimelineItem.create({
        data: {
          id: randomUUID(),
          timelineRevisionId: id,
          itemId: randomUUID(),
          displayOrder: 1,
          startTime: new Date('1970-01-01T12:00:00Z'),
          title: '',
        },
      }),
    ).rejects.toThrow();
    await expect(
      h.timeline.resolveApprovedRevision(
        { bookingId, timelineRevisionId: randomUUID() },
        contract(),
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(h.storage.bucket.upload).not.toHaveBeenCalled();
  });

  it('rolls back all acceptance facts in the outer owner UoW; durable intent/journal survive and reconcile on retry', async () => {
    const h = harness();
    await expect(
      h.boundary.run(
        { bookingId, context: { ...contract(), causationId: randomUUID() } },
        async (scoped) => {
          await h.service.upload(h.input, {
            ...actor.context,
            transactionScopeId: scoped.transactionScopeId!,
            causationId: scoped.causationId,
          });
          throw new Error('Owner rollback');
        },
      ),
    ).rejects.toThrow('Owner rollback');
    expect(await db().invitationMediaAsset.count()).toBe(0);
    expect(await db().invitationMediaReceipt.count()).toBe(0);
    expect(await db().invitationMediaAudit.count()).toBe(0);
    expect(await db().invitationMediaPolicy.count()).toBe(0);
    expect(await db().invitationMediaCommand.count()).toBe(1);
    expect(await db().invitationMediaUploadAttempt.count()).toBe(1);
    expect((await h.repository.recoveryPage(bookingId, 100))[0]?.outcome).toBe('UNRESOLVED');
    await h.upload();
    expect((await h.repository.recoveryPage(bookingId, 100)).map((row) => row.outcome)).toEqual([
      'REPLAY_RECONCILED',
      'ACCEPTED',
    ]);
  });

  it('only accepts an active same-booking/same-actor scope; rejects forged, expired, crossed, omitted and unscoped nesting', async () => {
    const h = harness();
    let old: ContractContext | undefined;
    await expect(
      h.boundary.run(
        { bookingId, context: { ...contract(), transactionScopeId: randomUUID() } },
        () => Promise.resolve(undefined),
      ),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      h.boundary.run(
        { bookingId, context: { ...contract(), authority: 'SYSTEM', actorAccountId: null } },
        () => Promise.resolve(undefined),
      ),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      h.boundary.run({ bookingId, context: { ...contract(), actorAccountId: null } }, () =>
        Promise.resolve(undefined),
      ),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      h.boundary.run({ bookingId, context: { ...contract(), requestId: '' } }, () =>
        Promise.resolve(undefined),
      ),
    ).rejects.toMatchObject({ status: 422 });
    await h.boundary.run({ bookingId, context: contract() }, async (scoped) => {
      old = scoped;
      expect(h.boundary.requireScope(bookingId, scoped)).toBe(h.boundary.current(bookingId));
      await expect(
        h.boundary.run({ bookingId, context: scoped }, () => Promise.resolve('nested')),
      ).resolves.toBe('nested');
      expect(() => h.boundary.current(randomUUID())).toThrow();
      expect(() =>
        h.boundary.requireScope(bookingId, { ...scoped, actorAccountId: randomUUID() }),
      ).toThrow();
      expect(() =>
        h.boundary.requireScope(bookingId, { ...scoped, requestId: randomUUID() }),
      ).toThrow();
      expect(() => h.boundary.requireScope(randomUUID(), scoped)).toThrow();
      expect(() =>
        h.boundary.requireScope(bookingId, { ...scoped, authority: 'SYSTEM' }),
      ).toThrow();
      expect(() =>
        h.boundary.requireScope(bookingId, { ...scoped, causationId: randomUUID() }),
      ).toThrow();
      await expect(
        h.identity.resolver.resolve(issueOpaqueToken('access', 32).token),
      ).rejects.toMatchObject({ status: 401 });
      await expect(
        h.boundary.run({ bookingId, context: contract() }, () => Promise.resolve(undefined)),
      ).rejects.toMatchObject({ status: 422 });
      await expect(
        h.timeline.resolveApprovedRevision(
          { bookingId, timelineRevisionId: timelineId },
          contract(),
        ),
      ).rejects.toMatchObject({ status: 422 });
      await expect(
        h.timeline.resolveApprovedRevision({ bookingId, timelineRevisionId: timelineId }, scoped),
      ).resolves.toMatchObject({ isEffective: true });
    });
    expect(() => h.boundary.requireScope(bookingId, old!)).toThrow();
    await expect(
      h.boundary.run({ bookingId, context: old! }, () => Promise.resolve(undefined)),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('native composition preserves 409 while pending, 422 for mismatched bodies and exact replay across instances', async () => {
    const h = harness(),
      second = createPersistentMediaService(db(), h.storage.provider, () => now);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((r) => {
      entered = r;
    });
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const put = h.storage.provider.put.bind(h.storage.provider);
    vi.spyOn(h.storage.provider, 'put').mockImplementationOnce(async (input) => {
      entered();
      await gate;
      return put(input);
    });
    const pending = h.upload();
    await started;
    try {
      await expect(second.service.upload(h.input, actor.context)).rejects.toMatchObject({
        code: 'REQUEST_IN_PROGRESS',
        status: 409,
      });
      await expect(
        second.service.upload({ ...h.input, altText: 'Different body' }, actor.context),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', status: 422 });
    } finally {
      release();
    }
    const accepted = await pending;
    await expect(second.service.upload(h.input, actor.context)).resolves.toEqual(accepted);
    expect(await db().invitationMediaAsset.count()).toBe(1);
  });

  it.each(['account', 'session', 'credential', 'role', 'grant', 'phase', 'timeline'])(
    'holds current %s authority/state until media commit against a real concurrent writer',
    async (kind) => {
      const h = harness();
      const successor = randomUUID();
      if (kind === 'timeline')
        await nativeTimelineFixture(db(), {
          timelineId: successor,
          bookingId,
          revisionNumber: 2,
          actorId: actor.context.actorId,
          now,
          startTime: '11:30',
          title: 'Next',
        });
      let entered!: () => void, release!: () => void;
      const enteredGate = new Promise<void>((r) => {
        entered = r;
      });
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const put = h.storage.provider.put.bind(h.storage.provider);
      vi.spyOn(h.storage.provider, 'put').mockImplementationOnce(async (command) => {
        entered();
        await gate;
        return put(command);
      });
      const pending = h.upload();
      await enteredGate;
      const query = {
        account: `UPDATE "Account" SET status='DISABLED', "disabledAt"=CURRENT_TIMESTAMP WHERE id=$1::uuid`,
        session: `UPDATE "Session" SET status='REVOKED', "revokedAt"=CURRENT_TIMESTAMP, "revocationReason"='test' WHERE id=$1::uuid`,
        credential: `UPDATE "AccessCredential" SET status='REVOKED', "revokedAt"=CURRENT_TIMESTAMP WHERE "sessionId"=$1::uuid`,
        role: `DELETE FROM "AccountRole" WHERE "accountId"=$1::uuid`,
        grant: `UPDATE "ConsultationAccess" SET level='RESTRICTED', "bookingId"=NULL, "sourcePaymentId"=NULL, "promotedAt"=NULL WHERE "accountId"=$1::uuid`,
        phase: `UPDATE "Booking" SET phase='CANCELLED' WHERE id=$1::uuid`,
        timeline: `UPDATE "Booking" SET "effectiveTimelineRevisionId"='${successor}'::uuid WHERE id=$1::uuid`,
      }[kind]!;
      const id = ['session', 'credential'].includes(kind)
        ? actor.sessionId
        : ['phase', 'timeline'].includes(kind)
          ? bookingId
          : actor.context.actorId;
      // Lock timeout proves the UPDATE actually reached PostgreSQL and was blocked,
      // rather than merely observing an unsettled JavaScript promise.
      try {
        await expect(
          db().$transaction(async (tx) => {
            await tx.$executeRawUnsafe("SET LOCAL lock_timeout='250ms'");
            await tx.$executeRawUnsafe(query, id);
          }),
        ).rejects.toThrow(/lock timeout/u);
      } finally {
        release();
        await pending;
      }
      expect(await db().invitationMediaAsset.count()).toBe(1);
      if (kind !== 'timeline') {
        await db().$executeRawUnsafe(query, id);
        await expect(
          h.service.upload({ ...h.input, idempotencyKey: randomUUID() }, actor.context),
        ).rejects.toMatchObject({
          status: kind === 'grant' ? 403 : kind === 'phase' || kind === 'role' ? 404 : 401,
        });
        expect(await db().invitationMediaAsset.count()).toBe(1);
      }
    },
  );

  it('enforces canonical proposal immutability and normalized owner references in PostgreSQL', async () => {
    await expect(
      db().bookingProposalSnapshot.update({
        where: { bookingId },
        data: { shiftStartTime: new Date('1970-01-01T10:00:00Z') },
      }),
    ).rejects.toThrow(/immutable/u);
    await expect(
      db().booking.update({
        where: { id: bookingId },
        data: { effectiveTimelineRevisionId: randomUUID() },
      }),
    ).rejects.toThrow();
    await expect(
      db().bookingDepositSettlement.create({
        data: {
          paymentId: randomUUID(),
          bookingId: randomUUID(),
          timelineRevisionId: timelineId,
          amountVnd: 1_000_000,
          settledAt: now,
        },
      }),
    ).rejects.toThrow();
    await expect(harness().upload()).resolves.toBeDefined();
  });
});
