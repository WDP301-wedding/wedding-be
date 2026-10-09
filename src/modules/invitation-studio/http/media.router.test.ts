import { randomBytes, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import sharp from 'sharp';
import request from 'supertest';
import { z } from 'zod';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app.js';
import {
  AuthenticationRequiredError,
  type AuthenticatedActorResolver,
} from '../../identity-access/authorization/authenticated-actor.middleware.js';
import { NotFoundError } from '../../../core/errors/app-error.js';
import { FakeStorageProvider } from '../../../integrations/storage/fake-storage-provider.js';
import {
  createMediaAccessGuard,
  type MediaBookingReader,
} from '../application/media-access.guard.js';
import { MediaService } from '../application/media.service.js';
import { MemoryMediaRepository } from '../infrastructure/memory-media.repository.js';
import { SharpMediaInspector } from '../infrastructure/sharp-media.inspector.js';
import { MEDIA_LIMITS } from '../domain/media-policy.js';
import { createMediaRouter } from './media.router.js';
import { mediaAssetResponseSchema, mediaPreviewResponseSchema } from './media.schemas.js';

describe('SPEC-05 bounded private multipart transport', () => {
  const bookingId = randomUUID(),
    actorId = randomUUID(),
    consultationId = randomUUID();
  const assetResponse = z.object({
    data: z.object({ mediaAssetId: z.uuid(), revision: z.number() }),
  });
  let png: Buffer;
  beforeAll(async () => {
    png = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#abcdef' } })
      .png()
      .toBuffer();
  });
  function harness(maxConcurrent = 2) {
    const repository = new MemoryMediaRepository(),
      storage = new FakeStorageProvider();
    const resolver: AuthenticatedActorResolver = {
      resolve: (token) => {
        if (!['couple', 'manager', 'staff'].includes(token))
          return Promise.reject(new AuthenticationRequiredError());
        return Promise.resolve({
          accountId: actorId,
          sessionId: randomUUID(),
          displayEmail: 'hidden@example.test',
          roles:
            token === 'manager'
              ? (['MANAGER'] as const)
              : token === 'staff'
                ? (['STAFF'] as const)
                : (['COUPLE'] as const),
        });
      },
    };
    const booking: MediaBookingReader = {
      requireBookingAccess: (input) => {
        if (input.bookingId !== bookingId) return Promise.reject(new NotFoundError());
        return Promise.resolve({ bookingId, consultationId, phase: 'CONFIRMED' as const });
      },
      requireConfirmedEventContext: (id) => {
        if (id !== bookingId) return Promise.reject(new NotFoundError());
        return Promise.resolve({
          bookingId,
          consultationId,
          hallId: randomUUID(),
          shiftCode: 'DINNER' as const,
          eventDate: '2026-10-15',
          effectiveTimelineRevisionId: randomUUID(),
          planningHeadcount: 100,
        });
      },
    };
    const guard = createMediaAccessGuard(resolver, booking, () =>
      Promise.resolve(new Date('2026-10-15T11:00:00Z')),
    );
    const service = new MediaService(
      repository,
      guard,
      storage,
      new SharpMediaInspector(),
      () => new Date('2026-10-09T00:00:00Z'),
    );
    const app = createApp({
      runtimeEnvironment: 'test',
      registerRoutes: (app) => {
        app.use('/api/v1', createMediaRouter(service, resolver, maxConcurrent));
      },
    });
    const upload = (key: string = randomUUID()) =>
      request(app)
        .post(`/api/v1/bookings/${bookingId}/media`)
        .set('Authorization', 'Bearer couple')
        .set('Idempotency-Key', key)
        .field('altText', 'Ảnh cưới')
        .attach('file', png, { filename: '../untrusted.png', contentType: 'image/png' });
    return { app, service, storage, repository, booking, resolver, upload };
  }

  it('accepts multipart >1MiB without weakening the global JSON bound and replays a safe result', async () => {
    const h = harness();
    const large = await sharp(randomBytes(1024 * 512 * 3), {
      raw: { width: 1024, height: 512, channels: 3 },
    })
      .png()
      .toBuffer();
    expect(large.length).toBeGreaterThan(1024 * 1024);
    const response = await request(h.app)
      .post(`/api/v1/bookings/${bookingId}/media`)
      .set('Authorization', 'Bearer couple')
      .set('Idempotency-Key', 'large')
      .field('altText', 'a')
      .attach('file', large, { contentType: 'image/png', filename: 'large.png' });
    expect(response.status).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    const first = await h.upload('stable'),
      replay = await h.upload('stable');
    expect(replay.body).toEqual(first.body);
    const hugeJson = await request(h.app)
      .patch(`/api/v1/bookings/${bookingId}/media/${randomUUID()}`)
      .set('Authorization', 'Bearer couple')
      .set('Idempotency-Key', 'json')
      .send({ altText: 'x'.repeat(1024 * 1024 + 1), expectedRevision: 1 });
    expect(hugeJson.status).toBe(413);
  });

  it('denies unauthenticated/Staff/unowned/pre-deposit before multipart storage or decoding', async () => {
    const h = harness(),
      put = vi.spyOn(h.storage, 'put');
    for (const token of ['missing', 'staff']) {
      const response = await request(h.app)
        .post(`/api/v1/bookings/${bookingId}/media`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', randomUUID())
        .field('altText', 'a')
        .attach('file', png, { contentType: 'image/png', filename: 'a.png' });
      expect(response.status).toBe(token === 'missing' ? 401 : 404);
    }
    const unowned = await request(h.app)
      .post(`/api/v1/bookings/${randomUUID()}/media`)
      .set('Authorization', 'Bearer couple')
      .set('Idempotency-Key', 'unowned')
      .field('altText', 'a')
      .attach('file', png, 'a.png');
    expect(unowned.status).toBe(404);
    vi.spyOn(h.booking, 'requireBookingAccess').mockResolvedValueOnce({
      bookingId,
      consultationId,
      phase: 'AWAITING_DEPOSIT',
    });
    expect((await h.upload()).status).toBe(404);
    expect(put).not.toHaveBeenCalled();
  });

  it('requires the durable key and rejects unknown fields, duplicate files, MIME mismatch and over-limit file', async () => {
    const h = harness();
    const missingKey = await request(h.app)
      .post(`/api/v1/bookings/${bookingId}/media`)
      .set('Authorization', 'Bearer couple')
      .field('altText', 'a')
      .attach('file', png, 'a.png');
    expect(missingKey.status).toBe(400);
    for (const response of [
      await h.upload().field('objectKey', 'private/forged'),
      await h.upload().attach('file', png, 'second.png'),
      await request(h.app)
        .post(`/api/v1/bookings/${bookingId}/media`)
        .set('Authorization', 'Bearer couple')
        .set('Idempotency-Key', 'mime')
        .field('altText', 'a')
        .attach('file', png, { contentType: 'image/jpeg', filename: 'a.jpg' }),
      await request(h.app)
        .post(`/api/v1/bookings/${bookingId}/media`)
        .set('Authorization', 'Bearer couple')
        .set('Idempotency-Key', 'big')
        .field('altText', 'a')
        .attach('file', Buffer.alloc(MEDIA_LIMITS.fileBytes + 1), 'a.png'),
    ])
      expect(response.status).toBe(422);
    expect(h.repository.states.get(bookingId)?.assets.size ?? 0).toBe(0);
  });

  it('preserves exact revision through metadata/replacement/delete and authorized preview', async () => {
    const h = harness(),
      id = assetResponse.parse((await h.upload()).body).data.mediaAssetId;
    const metadata = await request(h.app)
      .patch(`/api/v1/bookings/${bookingId}/media/${id}`)
      .set('Authorization', 'Bearer couple')
      .set('Idempotency-Key', 'metadata')
      .send({ altText: 'new', expectedRevision: 1 });
    expect(metadata.status).toBe(200);
    expect(assetResponse.parse(metadata.body).data.revision).toBe(2);
    const bad = await request(h.app)
      .patch(`/api/v1/bookings/${bookingId}/media/${id}`)
      .set('Authorization', 'Bearer couple')
      .set('Idempotency-Key', 'bad')
      .field('altText', 'new')
      .field('expectedRevision', '2')
      .field('unexpected', 'x')
      .attach('file', png, 'a.png');
    expect(bad.status).toBe(422);
    const replacement = await request(h.app)
      .patch(`/api/v1/bookings/${bookingId}/media/${id}`)
      .set('Authorization', 'Bearer couple')
      .set('Idempotency-Key', 'replace')
      .field('altText', 'new')
      .field('expectedRevision', '2')
      .attach('file', png, 'a.png');
    expect(replacement.status).toBe(200);
    const preview = await request(h.app)
      .get(`/api/v1/bookings/${bookingId}/media/${id}`)
      .set('Authorization', 'Bearer manager');
    expect(preview.body).toMatchObject({ data: { expiresInSeconds: 900 } });
    expect(mediaPreviewResponseSchema.safeParse(preview.body).success).toBe(true);
    expect(mediaAssetResponseSchema.safeParse(replacement.body).success).toBe(true);
    expect(JSON.stringify(preview.body)).not.toMatch(
      /currentFileRevisionId|objectKey|uploadAttemptId|accessToken/u,
    );
    const removed = await request(h.app)
      .delete(`/api/v1/bookings/${bookingId}/media/${id}`)
      .set('Authorization', 'Bearer couple')
      .set('Idempotency-Key', 'delete')
      .send({ expectedRevision: 3 });
    expect(removed.status).toBe(200);
    expect(
      (
        await request(h.app)
          .get(`/api/v1/bookings/${bookingId}/media/${id}`)
          .set('Authorization', 'Bearer manager')
      ).status,
    ).toBe(404);
    expect(h.repository.states.get(bookingId)!.files.size).toBe(3);
  });

  it('leaves unrelated routes to the app and rejects query authority on media endpoints', async () => {
    const h = harness();
    expect((await request(h.app).get('/api/v1/unrelated')).status).toBe(404);
    expect((await request(h.app).get('/health/live')).status).toBe(200);
    const response = await request(h.app)
      .get(`/api/v1/bookings/${bookingId}/media/${randomUUID()}?actorId=forged`)
      .set('Authorization', 'Bearer couple');
    expect(response.status).toBe(422);
  });

  it('Manager cutoff policy is explicit and Couple cannot change it', async () => {
    const h = harness(),
      policy = { cutoffAt: '2026-10-20T00:00:00Z', expectedRevision: 0 };
    expect(
      (
        await request(h.app)
          .patch(`/api/v1/management/bookings/${bookingId}/media-policy`)
          .set('Authorization', 'Bearer couple')
          .set('Idempotency-Key', 'denied')
          .send(policy)
      ).status,
    ).toBe(404);
    expect(
      (
        await request(h.app)
          .patch(`/api/v1/management/bookings/${bookingId}/media-policy`)
          .set('Authorization', 'Bearer manager')
          .set('Idempotency-Key', 'policy')
          .send(policy)
      ).status,
    ).toBe(200);
  });

  it('keeps bounded upload capacity until storage completes and releases it afterward', async () => {
    const h = harness(1),
      put = h.storage.put.bind(h.storage);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(h.storage, 'put').mockImplementationOnce(async (command) => {
      entered();
      await gate;
      return put(command);
    });
    const first = h.upload().then((response) => response);
    await started;
    expect((await h.upload()).status).toBe(429);
    release();
    expect((await first).status).toBe(201);
    expect((await h.upload()).status).toBe(201);
  });

  it('bounds chunked multipart preamble as part of the complete request', async () => {
    const h = harness(),
      server = h.app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const address = server.address();
      if (address === null || typeof address === 'string')
        throw new Error('Missing listener address');
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const client = httpRequest(
          {
            hostname: '127.0.0.1',
            port: address.port,
            path: `/api/v1/bookings/${bookingId}/media`,
            method: 'POST',
            headers: {
              Authorization: 'Bearer couple',
              'Idempotency-Key': 'chunked',
              'Content-Type': 'multipart/form-data; boundary=wedding-boundary',
              'Transfer-Encoding': 'chunked',
            },
          },
          (response) => {
            response.resume();
            response.on('end', () => resolve(response.statusCode));
          },
        );
        client.on('error', reject);
        client.write(Buffer.alloc(MEDIA_LIMITS.fileBytes + 64 * 1024 + 1, 0x61));
        client.end('\r\n--wedding-boundary--\r\n');
      });
      expect(status).toBe(413);
      expect(h.repository.states.size).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('rejects malformed multipart/params/missing files and oversized complete bodies', async () => {
    const h = harness();
    expect(() => createMediaRouter(h.service, h.resolver, 0)).toThrow(RangeError);
    const missing = await request(h.app)
      .post(`/api/v1/bookings/${bookingId}/media`)
      .set('Authorization', 'Bearer couple')
      .set('Idempotency-Key', 'missing')
      .field('altText', 'a');
    expect(missing.status).toBe(422);
    const malformed = await request(h.app)
      .post(`/api/v1/bookings/${bookingId}/media`)
      .set('Authorization', 'Bearer couple')
      .set('Idempotency-Key', 'malformed')
      .set('Content-Type', 'multipart/form-data; boundary=invalid')
      .send('invalid data');
    expect(malformed.status).toBe(422);
    const badUuid = await request(h.app)
      .post('/api/v1/bookings/not-a-uuid/media')
      .set('Authorization', 'Bearer couple')
      .set('Idempotency-Key', 'params')
      .field('altText', 'a');
    expect(badUuid.status).toBe(422);
    const oversized = await request(h.app)
      .post(`/api/v1/bookings/${bookingId}/media`)
      .set('Authorization', 'Bearer couple')
      .set('Idempotency-Key', 'whole')
      .set('Content-Type', 'multipart/form-data; boundary=invalid')
      .set('Content-Length', String(MEDIA_LIMITS.fileBytes + 64 * 1024 + 1))
      .send('small body rejected before parsing');
    expect(oversized.status).toBe(413);
  });
});
