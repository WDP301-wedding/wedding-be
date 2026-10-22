import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeStorageProvider } from '../../../src/integrations/storage/fake-storage-provider.js';
import type { StorageProvider } from '../../../src/integrations/storage/storage-provider.js';
import { controlledStorage } from './controlled-storage.js';
import { insertDatabaseMedia } from './media-database-fixtures.js';
import type {
  MediaAccessGuard,
  MediaRequestContext,
} from '../../../src/modules/invitation-studio/application/media.contracts.js';
import { MediaService } from '../../../src/modules/invitation-studio/application/media.service.js';
import { PrismaMediaRepository } from '../../../src/modules/invitation-studio/infrastructure/prisma-media.repository.js';
import { SharpMediaInspector } from '../../../src/modules/invitation-studio/infrastructure/sharp-media.inspector.js';
import { NotFoundError, ProviderError } from '../../../src/core/errors/app-error.js';
import { createAuthenticatedActorResolver } from '../../../src/modules/identity-access/authorization/authenticated-actor.middleware.js';
import {
  createConsultationAccessReader,
  createPrismaConsultationAccessRepository,
} from '../../../src/modules/identity-access/authorization/authorization.service.js';
import { createPrismaSessionRepository } from '../../../src/modules/identity-access/session/session.repository.js';
import { issueOpaqueToken } from '../../../src/modules/identity-access/crypto/token.js';
import {
  createMediaAccessGuard,
  type MediaBookingReader,
} from '../../../src/modules/invitation-studio/application/media-access.guard.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';

const describeDatabase = catalogMigrationDatabaseUrl ? describe : describe.skip;
describeDatabase(
  'SPEC-05 persistent media: real PostgreSQL/decoder, fake Booking and Storage',
  () => {
    const database = new CatalogTestDatabase('wedding_isw1');
    const bookingId = randomUUID(),
      actorId = randomUUID();
    const context: MediaRequestContext = { actorId, requestId: randomUUID() };
    let bytes: Buffer;
    beforeAll(async () => {
      await database.connect();
      bytes = await sharp({
        create: {
          width: 4,
          height: 3,
          channels: 3,
          background: '#abcdef',
        },
      })
        .png()
        .toBuffer();
    }, 60_000);
    beforeEach(async () => {
      // The service and fresh repository cutoff/lease checks share fixture time.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-09T00:00:00Z'));
      await database.prisma.$executeRawUnsafe(
        'TRUNCATE "InvitationMediaAudit", "InvitationMediaReceipt", "InvitationMediaFile", "InvitationMediaAsset", "InvitationMediaUploadAttempt", "InvitationMediaPolicy", "InvitationMediaCommand" CASCADE',
      );
    });
    afterEach(() => vi.useRealTimers());
    afterAll(async () => {
      await database.disconnect();
    });

    function harness(storage: StorageProvider = new FakeStorageProvider()) {
      const repository = new PrismaMediaRepository(database.prisma),
        provider = storage;
      const access: MediaAccessGuard = {
        requireAccess: () =>
          Promise.resolve({
            actorId,
            role: 'COUPLE',
            eventStartAt: new Date('2026-10-15T00:00:00Z'),
          }),
      };
      const service = new MediaService(
        repository,
        access,
        provider,
        new SharpMediaInspector(),
        () => new Date('2026-10-09T00:00:00Z'),
      );
      const upload = (extra: Record<string, unknown> = {}) =>
        service.upload(
          {
            bookingId,
            bytes,
            contentType: 'image/png',
            altText: 'Ảnh cưới',
            idempotencyKey: randomUUID(),
            ...extra,
          },
          context,
        );
      return { repository, storage, access, service, upload };
    }

    it('rejects an in-flight duplicate across repository instances, then replays after commit', async () => {
      const h = harness(),
        second = harness();
      let entered!: () => void, release!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const put = h.storage.put.bind(h.storage);
      vi.spyOn(h.storage, 'put').mockImplementationOnce(async (command) => {
        entered();
        await gate;
        return put(command);
      });
      const first = h.upload({ idempotencyKey: 'inflight' });
      await started;
      try {
        await expect(second.upload({ idempotencyKey: 'inflight' })).rejects.toMatchObject({
          status: 409,
          code: 'REQUEST_IN_PROGRESS',
        });
        await expect(
          second.upload({ idempotencyKey: 'inflight', altText: 'different body' }),
        ).rejects.toMatchObject({ status: 422, code: 'IDEMPOTENCY_KEY_REUSED' });
      } finally {
        release();
      }
      const asset = await first;
      expect(await second.upload({ idempotencyKey: 'inflight' })).toEqual(asset);
      expect(await database.prisma.invitationMediaUploadAttempt.count()).toBe(1);
    });

    it('executes production Supabase adapter with real PostgreSQL/decoder and redacted private reads', async () => {
      const sdk = controlledStorage(),
        h = harness(sdk.provider);
      const asset = await h.upload({ idempotencyKey: 'production-adapter' });
      expect(await h.upload({ idempotencyKey: 'production-adapter' })).toEqual(asset);
      expect(sdk.objects.size).toBe(1);
      const preview = await h.service.preview({ bookingId, assetId: asset.id }, context);
      expect(preview.signedUrl).toContain('token=test-900');
      expect(sdk.bucket.createSignedUrl).toHaveBeenCalledWith(
        expect.stringContaining(`private-wedding-media/${bookingId}/`),
        900,
      );
      expect(JSON.stringify(await database.prisma.invitationMediaReceipt.findMany())).not.toContain(
        'token=',
      );
      expect(JSON.stringify(await database.prisma.invitationMediaAudit.findMany())).not.toContain(
        'token=',
      );
      await h.service.detach(
        { bookingId, assetId: asset.id, expectedRevision: 1, idempotencyKey: 'retain-original' },
        context,
      );
      expect(sdk.bucket.remove).not.toHaveBeenCalled();
      expect(sdk.objects.size).toBe(1);
    });

    it('reconciles a Supabase object uploaded before info failure, without blind overwrite/deletion', async () => {
      const sdk = controlledStorage(),
        h = harness(sdk.provider);
      vi.spyOn(sdk.bucket, 'info').mockResolvedValueOnce({
        data: null,
        error: { statusCode: '503' },
      });
      await expect(h.upload({ idempotencyKey: 'unknown-effect' })).rejects.toBeInstanceOf(
        ProviderError,
      );
      expect(sdk.objects.size).toBe(1);
      expect(await database.prisma.invitationMediaAsset.count()).toBe(0);
      await h.upload({ idempotencyKey: 'unknown-effect' });
      expect(sdk.objects.size).toBe(1);
      expect(
        (await h.repository.recoveryPage(bookingId, 100)).map((a) => a.outcome).sort(),
      ).toEqual(['ACCEPTED', 'REPLAY_RECONCILED']);
      expect(sdk.bucket.remove).not.toHaveBeenCalled();
    });

    it('rejects fresh acceptance at the cutoff even when the injected service clock remains earlier', async () => {
      const h = harness();
      const put = h.storage.put.bind(h.storage);
      vi.spyOn(h.storage, 'put').mockImplementationOnce(async (input) => {
        const object = await put(input);
        // The event is October 15; the repository must enforce the exact 72-hour cutoff.
        vi.setSystemTime(new Date('2026-10-12T00:00:00Z'));
        return object;
      });
      await expect(h.upload()).rejects.toMatchObject({ code: 'MEDIA_CUTOFF_REACHED' });
      expect(await database.prisma.invitationMediaAsset.count()).toBe(0);
      expect(await database.prisma.invitationMediaFile.count()).toBe(0);
      expect(await database.prisma.invitationMediaReceipt.count()).toBe(0);
      expect((await h.repository.recoveryPage(bookingId, 100))[0]!.outcome).toBe('UNRESOLVED');
    });

    it('persists originals, immutable metadata and receipts across repository instances', async () => {
      const h = harness(),
        asset = await h.upload({ idempotencyKey: 'stable' });
      const second = harness();
      expect(await second.upload({ idempotencyKey: 'stable' })).toEqual(asset);
      expect(await database.prisma.invitationMediaFile.count()).toBe(1);
      expect(await database.prisma.invitationMediaReceipt.count()).toBe(1);
      const file = await database.prisma.invitationMediaFile.findUniqueOrThrow({
        where: { id: asset.currentFileRevisionId },
      });
      expect(file).toMatchObject({
        width: 4,
        height: 3,
        policyRevision: 0,
        contentType: 'image/png',
      });
      expect(file.objectKey).not.toContain('https');
      expect((await h.repository.recoveryPage(bookingId, 100))[0]!.outcome).toBe('ACCEPTED');
      await expect(h.repository.recoveryPage(bookingId, 101)).rejects.toThrow();
    });

    it('canonicalizes UUID casing before ownership/digest/advisory lock and asset lookup', async () => {
      const h = harness();
      const asset = await h.upload({
        idempotencyKey: 'canonical',
        bookingId: bookingId.toUpperCase(),
      });
      expect(await h.upload({ idempotencyKey: 'canonical', bookingId })).toEqual(asset);
      expect(
        (
          await h.service.preview(
            { bookingId: bookingId.toUpperCase(), assetId: asset.id.toUpperCase() },
            context,
          )
        ).asset.id,
      ).toBe(asset.id);
      expect(await database.prisma.invitationMediaAsset.count()).toBe(1);
      expect(await database.prisma.invitationMediaReceipt.count()).toBe(1);
    });

    it('rolls back acceptance on a deferred commit failure, retaining the pre-upload journal', async () => {
      const h = harness();
      await database.prisma.$executeRawUnsafe(`
        CREATE FUNCTION media_acceptance_commit_fault() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'controlled deferred acceptance failure'; END $$`);
      await database.prisma.$executeRawUnsafe(
        'CREATE CONSTRAINT TRIGGER media_acceptance_commit_fault AFTER INSERT ON "InvitationMediaReceipt" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION media_acceptance_commit_fault()',
      );
      try {
        await expect(h.upload({ idempotencyKey: 'retry' })).rejects.toThrow(
          'controlled deferred acceptance failure',
        );
      } finally {
        await database.prisma.$executeRawUnsafe(
          'DROP TRIGGER media_acceptance_commit_fault ON "InvitationMediaReceipt"',
        );
        await database.prisma.$executeRawUnsafe('DROP FUNCTION media_acceptance_commit_fault()');
      }
      expect(await database.prisma.invitationMediaAsset.count()).toBe(0);
      expect(await database.prisma.invitationMediaFile.count()).toBe(0);
      expect(await database.prisma.invitationMediaReceipt.count()).toBe(0);
      expect(await database.prisma.invitationMediaAudit.count()).toBe(0);
      expect((await h.repository.recoveryPage(bookingId, 100))[0]!.outcome).toBe('UNRESOLVED');
      await h.upload({ idempotencyKey: 'retry' });
      expect(
        (await h.repository.recoveryPage(bookingId, 100)).map((a) => a.outcome).sort(),
      ).toEqual(['ACCEPTED', 'REPLAY_RECONCILED']);
    });

    it('serializes real concurrent quota/CAS across separate repository instances', async () => {
      const h = harness();
      // Stay below decoder concurrency limits; two instances share PostgreSQL lane.
      for (let i = 0; i < 99; i++) await h.upload();
      const second = harness();
      const outcomes = await Promise.allSettled([h.upload(), second.upload()]);
      expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(
        await database.prisma.invitationMediaAsset.count({ where: { detachedAt: null } }),
      ).toBe(100);
      const current = await database.prisma.invitationMediaAsset.findFirstOrThrow();
      const replacements = await Promise.allSettled([
        h.upload({ assetId: current.id, expectedRevision: 1 }),
        second.upload({ assetId: current.id, expectedRevision: 1 }),
      ]);
      expect(replacements.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    }, 120_000);

    it('enforces the exact 1GiB accepted-byte boundary in PostgreSQL without allocating files', async () => {
      await database.prisma.$transaction(
        async (tx) => {
          for (let i = 0; i < 40; i++) await insertDatabaseMedia(tx, bookingId, 25 * 1024 * 1024);
          await insertDatabaseMedia(tx, bookingId, 24 * 1024 * 1024);
        },
        { timeout: 30_000 },
      );
      expect(await database.prisma.invitationMediaAsset.count()).toBe(41);
      await expect(
        database.prisma.$transaction((tx) => insertDatabaseMedia(tx, bookingId, 1)),
      ).rejects.toThrow('MEDIA_QUOTA_EXCEEDED');
      expect(await database.prisma.invitationMediaAsset.count()).toBe(41);
      const asset = await database.prisma.invitationMediaAsset.findFirstOrThrow();
      await database.prisma.invitationMediaAsset.update({
        where: { id: asset.id },
        data: { detachedAt: new Date() },
      });
      await database.prisma.$transaction((tx) => insertDatabaseMedia(tx, bookingId, 1));
      expect(
        await database.prisma.invitationMediaAsset.count({ where: { detachedAt: null } }),
      ).toBe(41);
    });

    it('allows only one concurrent DB transaction to consume the final quota byte', async () => {
      await database.prisma.$transaction(
        async (tx) => {
          for (let i = 0; i < 40; i++) await insertDatabaseMedia(tx, bookingId, 25 * 1024 * 1024);
          await insertDatabaseMedia(tx, bookingId, 24 * 1024 * 1024 - 1);
        },
        { timeout: 30_000 },
      );
      const results = await Promise.allSettled([
        database.prisma.$transaction((tx) => insertDatabaseMedia(tx, bookingId, 1)),
        database.prisma.$transaction((tx) => insertDatabaseMedia(tx, bookingId, 1)),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await database.prisma.invitationMediaAsset.count()).toBe(42);
    });

    it('loads bounded active/current working sets and preserves historical rows without hydrating them', async () => {
      const h = harness(),
        asset = await h.upload();
      for (let revision = 1; revision <= 6; revision++)
        await h.service.updateMetadata(
          {
            bookingId,
            assetId: asset.id,
            expectedRevision: revision,
            altText: `revision ${revision}`,
            idempotencyKey: `metadata-${revision}`,
          },
          context,
        );
      expect(await database.prisma.invitationMediaFile.count()).toBe(7);
      expect(await database.prisma.invitationMediaReceipt.count()).toBe(7);
      await h.repository.runLocked(bookingId, (state) => {
        expect(state.assets.size).toBe(1);
        expect(state.files.size).toBe(1);
        expect(state.receipts.size).toBe(0);
        expect(state.audit).toEqual([]);
        return Promise.resolve();
      });
      await h.service.detach(
        { bookingId, assetId: asset.id, expectedRevision: 7, idempotencyKey: 'history-detach' },
        context,
      );
      await h.repository.runLocked(bookingId, (state) => {
        expect(state.assets.size).toBe(0);
        expect(state.files.size).toBe(0);
        return Promise.resolve();
      });
      expect(await database.prisma.invitationMediaFile.count()).toBe(7);
      expect(await h.upload({ idempotencyKey: 'original-intent-not-used' })).toMatchObject({
        revision: 1,
      });
    });

    it('recovery uses insertion sequence and repeats full sweeps for late commits instead of persisting a UUID watermark', async () => {
      const h = harness();
      await h.upload();
      const firstPage = await h.repository.recoveryPage(bookingId, 1);
      const first = await database.prisma.invitationMediaUploadAttempt.findUniqueOrThrow({
        where: { id: firstPage[0]!.attemptId },
      });
      await database.prisma.invitationMediaUploadAttempt.create({
        data: {
          id: '00000000-0000-4000-8000-000000000001',
          bookingId,
          objectKey: first.objectKey,
          checksumSha256: first.checksumSha256,
          contentType: first.contentType,
          sizeBytes: first.sizeBytes,
          intentKeyDigest: 'a'.repeat(64),
          commandDigest: 'b'.repeat(64),
          createdAt: new Date(),
          policyRevision: 0,
        },
      });
      expect((await h.repository.recoveryPage(bookingId, 1, first.id))[0]!.attemptId).toBe(
        '00000000-0000-4000-8000-000000000001',
      );
      const sweep = h.repository.recoverySweep(bookingId, 1);
      const ids: string[] = [];
      for await (const page of sweep) ids.push(...page.map((a) => a.attemptId));
      expect(ids).toHaveLength(2);
      // An attempt committed after a finished sweep is included by a fresh sweep.
      await h.upload();
      const repeated: string[] = [];
      for await (const page of h.repository.recoverySweep(bookingId, 1))
        repeated.push(...page.map((a) => a.attemptId));
      expect(repeated).toHaveLength(3);
      expect(repeated).toEqual(expect.arrayContaining(ids));
      await expect(database.prisma.invitationMediaUploadAttempt.deleteMany()).rejects.toThrow();
    });

    it('failed provider replacement preserves accepted original and historical references', async () => {
      const h = harness(),
        asset = await h.upload();
      vi.spyOn(h.storage, 'put').mockRejectedValueOnce(new ProviderError('timeout'));
      await expect(h.upload({ assetId: asset.id, expectedRevision: 1 })).rejects.toBeInstanceOf(
        ProviderError,
      );
      expect(await database.prisma.invitationMediaFile.count()).toBe(1);
      await h.service.detach(
        { bookingId, assetId: asset.id, expectedRevision: 1, idempotencyKey: 'detach' },
        context,
      );
      expect(await database.prisma.invitationMediaFile.count()).toBe(1);
      await expect(database.prisma.invitationMediaFile.deleteMany()).rejects.toThrow();
      await expect(database.prisma.invitationMediaReceipt.deleteMany()).rejects.toThrow();
      await expect(
        database.prisma.invitationMediaFile.update({
          where: { id: asset.currentFileRevisionId },
          data: { altText: 'rewrite' },
        }),
      ).rejects.toThrow();
    });

    it('writes redacted denied-access audit outside acceptance rollback', async () => {
      const h = harness();
      vi.spyOn(h.access, 'requireAccess').mockRejectedValue(new NotFoundError());
      await expect(h.upload()).rejects.toMatchObject({ status: 404 });
      expect(await database.prisma.invitationMediaAudit.findFirst()).toMatchObject({
        action: 'media.access-denied',
        actorId,
        assetId: null,
      });
      expect(await database.prisma.invitationMediaUploadAttempt.count()).toBe(0);
    });
    it('rejects an in-memory rewrite of persisted history and bounds recovery cursors', async () => {
      const h = harness(),
        asset = await h.upload();
      await expect(
        h.repository.runLocked(bookingId, (state) => {
          const file = state.files.get(asset.currentFileRevisionId)!;
          state.files.set(file.id, { ...file, altText: 'illegal rewrite' });
          return Promise.resolve();
        }),
      ).rejects.toThrow('Immutable media file changed');
      const page = await h.repository.recoveryPage(bookingId, 1);
      expect(await h.repository.recoveryPage(bookingId, 1, page[0]!.attemptId)).toEqual([]);
    });

    it('checks real Identity/session/FULL access state; Booking/calendar remain doubles', async () => {
      // Credential timestamps default to the real PostgreSQL clock in this case.
      vi.useRealTimers();
      const consultationId = randomUUID();
      await database.prisma.account.create({
        data: {
          id: actorId,
          emailNormalized: 'isw1@example.test',
          displayEmail: 'isw1@example.test',
          roles: { create: { role: 'COUPLE' } },
        },
      });
      await database.prisma.consultationAccess.create({
        data: {
          accountId: actorId,
          consultationId,
          bookingId,
          level: 'FULL',
          promotedAt: new Date(),
          sourcePaymentId: randomUUID(),
        },
      });
      // Credential rows use PostgreSQL's real createdAt default. Start the fixture
      // clock at wall time so a fixed historical access expiry cannot violate it.
      let time = new Date();
      const eventStartAt = new Date(time.getTime() + 6 * 86_400_000);
      const sessions = createPrismaSessionRepository(database.prisma);
      const resolver = createAuthenticatedActorResolver(sessions, () => time);
      const access = createConsultationAccessReader(
        createPrismaConsultationAccessRepository(database.prisma),
      );
      const booking: MediaBookingReader = {
        async requireBookingAccess(input) {
          if (input.bookingId !== bookingId) throw new NotFoundError();
          await access.requireAccess({
            accountId: input.accountId,
            consultationId,
            minimum: input.minimum,
          });
          return { bookingId, consultationId, phase: 'CONFIRMED' };
        },
        requireConfirmedEventContext: () =>
          Promise.resolve({
            bookingId,
            consultationId,
            hallId: randomUUID(),
            shiftCode: 'DINNER',
            eventDate: eventStartAt.toISOString().slice(0, 10),
            effectiveTimelineRevisionId: randomUUID(),
            planningHeadcount: 100,
          }),
      };
      const repository = new PrismaMediaRepository(database.prisma),
        storage = new FakeStorageProvider();
      const service = new MediaService(
        repository,
        createMediaAccessGuard(resolver, booking, () => Promise.resolve(eventStartAt)),
        storage,
        new SharpMediaInspector(),
        () => time,
      );
      async function credential() {
        const token = issueOpaqueToken('access', 32),
          refresh = issueOpaqueToken('refresh', 32);
        const created = await sessions.createSession({
          accountId: actorId,
          clientKind: 'WEB',
          accessTokenHash: token.tokenHash,
          refreshTokenHash: refresh.tokenHash,
          now: time,
          accessExpiresAt: new Date(time.getTime() + 600_000),
          idleExpiresAt: new Date(time.getTime() + 3_600_000),
          absoluteExpiresAt: new Date(time.getTime() + 86_400_000),
        });
        return { ...created, context: { ...context, accessToken: token.token } };
      }
      const first = await credential();
      const asset = await service.upload(
        {
          bookingId,
          bytes,
          contentType: 'image/png',
          altText: 'private',
          idempotencyKey: 'identity',
        },
        first.context,
      );
      await database.prisma.consultationAccess.update({
        where: { accountId_consultationId: { accountId: actorId, consultationId } },
        data: { level: 'RESTRICTED', promotedAt: null, sourcePaymentId: null },
      });
      await expect(
        service.preview({ bookingId, assetId: asset.id }, first.context),
      ).rejects.toMatchObject({ status: 403 });
      await database.prisma.consultationAccess.update({
        where: { accountId_consultationId: { accountId: actorId, consultationId } },
        data: { level: 'FULL', promotedAt: new Date(), sourcePaymentId: randomUUID() },
      });
      await sessions.revokeSession({
        sessionId: first.sessionId,
        reason: 'test revoke',
        now: time,
      });
      await expect(
        service.preview({ bookingId, assetId: asset.id }, first.context),
      ).rejects.toMatchObject({ status: 401 });
      const second = await credential();
      await database.prisma.account.update({
        where: { id: actorId },
        data: { status: 'DISABLED', disabledAt: time },
      });
      await expect(
        service.preview({ bookingId, assetId: asset.id }, second.context),
      ).rejects.toMatchObject({ status: 401 });
      await database.prisma.account.update({
        where: { id: actorId },
        data: { status: 'ACTIVE', disabledAt: null },
      });
      await database.prisma.accountRole.updateMany({
        where: { accountId: actorId },
        data: { role: 'STAFF' },
      });
      await expect(
        service.preview({ bookingId, assetId: asset.id }, second.context),
      ).rejects.toMatchObject({ status: 404 });
      await database.prisma.accountRole.updateMany({
        where: { accountId: actorId },
        data: { role: 'MANAGER' },
      });
      time = new Date(eventStartAt.getTime() - 2 * 86_400_000);
      const manager = await credential();
      expect(
        (await service.preview({ bookingId, assetId: asset.id }, manager.context)).expiresInSeconds,
      ).toBe(900);
      const audits = await database.prisma.invitationMediaAudit.findMany();
      expect(audits.filter((a) => a.action === 'media.access-denied')).toHaveLength(4);
      expect(JSON.stringify(audits)).not.toContain('wia_');
      expect(JSON.stringify(await database.prisma.invitationMediaReceipt.findMany())).not.toContain(
        'wia_',
      );
    });
  },
);
