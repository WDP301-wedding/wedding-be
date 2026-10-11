import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';
import { studioFixture } from './studio-fixture.js';
import { insertDatabaseMedia } from './media-database-fixtures.js';
import { createStudioRouter } from '../../../src/modules/invitation-studio/http/studio.router.js';
import { createErrorHandler } from '../../../src/core/errors/error-handler.js';
import { createCorsMiddleware } from '../../../src/core/http/security.js';
import { PrintFileService } from '../../../src/modules/invitation-studio/infrastructure/print-file.service.js';

const database = new CatalogTestDatabase('printfile');
(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'immutable printable file with native owner authorization',
  () => {
    beforeAll(() => database.connect(), 60000);
    afterAll(() => database.disconnect());
    async function fixture(withImage = false) {
      const f = await studioFixture(database.prisma);
      const assetId = randomUUID();
      let object: Awaited<ReturnType<typeof f.storage.provider.put>> | undefined;
      if (withImage) {
        const source = await f.prisma.$transaction((tx) =>
          insertDatabaseMedia(tx, f.bookingId, f.bytes.length),
        );
        const file = await f.prisma.invitationMediaFile.findFirstOrThrow({
          where: { assetId: source },
        });
        object = await f.storage.provider.put({
          bytes: f.bytes,
          contentType: 'image/png',
          purpose: 'PRIVATE_WEDDING_MEDIA',
          resourceId: assetId,
        });
        await f.prisma.invitationDerivedAsset.create({
          data: {
            id: assetId,
            bookingId: f.bookingId,
            sourceFileId: file.id,
            object: { ...object },
            width: 5,
            height: 4,
            publicSlug: randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''),
          },
        });
      }
      const d = await f.services.designs.create(
        {
          bookingId: f.bookingId,
          content: { ...f.content, derivedAssetIds: withImage ? [assetId] : [] },
          idempotencyKey: randomUUID(),
        },
        f.couple,
      );
      await f.services.publication.publish(
        {
          bookingId: f.bookingId,
          designId: d.designId,
          designRevisionId: d.revisionId,
          expectedRevision: d.revisionNumber,
          expectedPublicationRevision: 0,
          idempotencyKey: randomUUID(),
        },
        f.couple,
      );
      const captured = await f.services.boundary.run(
        { bookingId: f.bookingId, context: f.contract },
        (scope) =>
          f.services.printable.capture(
            { bookingId: f.bookingId, designRevisionId: d.revisionId },
            scope,
          ),
      );
      return { f, d, captured, assetId, object };
    }
    it('returns the same retained bytes after newer designs/unpublication, without ledger changes', async () => {
      const { f, d, captured } = await fixture(true);
      const before = await f.services.printFiles.read(
        f.bookingId,
        captured.printableRevisionId,
        f.couple,
      );
      await f.services.designs.edit(
        {
          bookingId: f.bookingId,
          designId: d.designId,
          expectedRevision: 1,
          textFields: { greeting: 'Lời mời mới' },
          idempotencyKey: randomUUID(),
        },
        f.couple,
      );
      await f.services.publication.unpublish(
        {
          bookingId: f.bookingId,
          designId: d.designId,
          expectedRevision: 1,
          idempotencyKey: randomUUID(),
        },
        f.couple,
      );
      const after = await f.services.printFiles.read(
        f.bookingId,
        captured.printableRevisionId,
        f.manager,
      );
      expect(before.bytes.equals(after.bytes)).toBe(true);
      expect(after.contentDigest).toBe(captured.contentDigest);
      expect(
        await f.prisma.billingLedgerEntry.count({
          where: { bookingId: f.bookingId, sourceType: 'PRINT_ORDER' },
        }),
      ).toBe(0);
      expect(f.storage.bucket.remove).not.toHaveBeenCalled();
    }, 30000);
    it('denies strangers, Staff, revoked sessions and unknown/cross-booking revisions', async () => {
      const { f, captured } = await fixture();
      for (const actor of [await f.actor('COUPLE'), await f.actor('STAFF')])
        await expect(
          f.services.printFiles.read(f.bookingId, captured.printableRevisionId, actor),
        ).rejects.toMatchObject({ status: 404 });
      await expect(
        f.services.printFiles.read(f.bookingId, randomUUID(), f.couple),
      ).rejects.toMatchObject({ status: 404 });
      const other = await fixture();
      await expect(
        other.f.services.printFiles.read(
          other.f.bookingId,
          captured.printableRevisionId,
          other.f.couple,
        ),
      ).rejects.toMatchObject({ status: 404 });
      await f.prisma.session.update({
        where: { id: f.couple.sessionId },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
      await expect(
        f.services.printFiles.read(f.bookingId, captured.printableRevisionId, f.couple),
      ).rejects.toMatchObject({ status: 401 });
    }, 30000);
    it('fails closed on corrupted transport and missing retained provider support', async () => {
      const { f, captured, object } = await fixture(true);
      const service = new PrintFileService(f.services.studioRepository, f.services.designs.access, {
        ...f.storage.provider,
        read: undefined,
      } as never);
      await expect(
        service.read(f.bookingId, captured.printableRevisionId, f.couple),
      ).rejects.toMatchObject({ status: 503 });
      f.storage.objects.get(object!.objectKey)!.bytes = new Uint8Array([1]);
      await expect(
        f.services.printFiles.read(f.bookingId, captured.printableRevisionId, f.couple),
      ).rejects.toMatchObject({ status: 502 });
    }, 30000);
    it('reauthorizes after provider IO before releasing private bytes', async () => {
      const { f, captured } = await fixture(true);
      const service = new PrintFileService(f.services.studioRepository, f.services.designs.access, {
        put: f.storage.provider.put.bind(f.storage.provider),
        delete: f.storage.provider.delete.bind(f.storage.provider),
        createSignedReadUrl: f.storage.provider.createSignedReadUrl.bind(f.storage.provider),
        read: async (ref) => {
          const bytes = await f.storage.provider.read(ref);
          await f.prisma.session.update({
            where: { id: f.couple.sessionId },
            data: { status: 'REVOKED', revokedAt: new Date() },
          });
          return bytes;
        },
      });
      await expect(
        service.read(f.bookingId, captured.printableRevisionId, f.couple),
      ).rejects.toMatchObject({ status: 401 });
    }, 30000);
    it('mounts strict authenticated binary preview/download HTTP with digest headers', async () => {
      const { f, captured } = await fixture();
      const app = express();
      app.use((req, _res, next) => {
        req.requestId = randomUUID();
        next();
      });
      app.use(createCorsMiddleware({ allowedOrigins: ['https://client.example.test'] }));
      app.use(createStudioRouter(f.services, f.services.identity.resolver));
      app.use(createErrorHandler());
      const path = `/bookings/${f.bookingId}/printable-revisions/${captured.printableRevisionId}/file`;
      await request(app).get(path).expect(401);
      await request(app)
        .get(path + '?extra=1')
        .auth(f.couple.accessToken, { type: 'bearer' })
        .expect(422);
      const preview = await request(app)
        .get(path)
        .set('Origin', 'https://client.example.test')
        .auth(f.couple.accessToken, { type: 'bearer' })
        .expect(200);
      const download = await request(app)
        .get(path + '?disposition=attachment')
        .auth(f.manager.accessToken, { type: 'bearer' })
        .expect(200);
      expect(preview.headers['content-type']).toContain('application/pdf');
      expect(preview.headers['x-content-sha256']).toBe(download.headers['x-content-sha256']);
      expect(preview.headers['x-printable-content-digest']).toBe(captured.contentDigest);
      expect(download.headers['content-disposition']).toContain('attachment');
      expect(download.headers['cache-control']).toBe('private, no-store');
      expect(preview.headers['access-control-allow-origin']).toBe('https://client.example.test');
      expect(
        String(preview.headers['access-control-expose-headers']).toLowerCase().split(', '),
      ).toEqual(
        expect.arrayContaining([
          'content-disposition',
          'x-content-sha256',
          'x-printable-content-digest',
          'x-renderer-version',
          'x-request-id',
        ]),
      );
      await request(app)
        .get(path)
        .set('Origin', 'https://unapproved.example.test')
        .auth(f.couple.accessToken, { type: 'bearer' })
        .expect(403);
    }, 30000);
  },
);
