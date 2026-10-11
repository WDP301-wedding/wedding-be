import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createGuestServices } from '../../src/modules/guest-management/infrastructure/guest.composition.js';
import { createGuestRouter } from '../../src/modules/guest-management/http/guest.router.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';
import { z } from 'zod';
import { errorResponseSchema } from '../../src/core/http/common.schemas.js';
import { createGuestImportBodyParser } from '../../src/modules/guest-management/http/guest-import.parser.js';
import {
  groupSchema,
  guestSchema,
  planSchema,
  previewSchema,
  importResultSchema,
  privateListSchema,
  issuedLinkSchema,
  sessionSchema,
  invitationViewSchema,
} from '../../src/modules/guest-management/http/guest.schemas.js';
const data = <T extends z.ZodType>(response: request.Response, schema: T): z.output<T> =>
  schema.parse(z.strictObject({ data: z.unknown() }).parse(response.body).data);
const code = (response: request.Response) => errorResponseSchema.parse(response.body).error.code;

const describeDb = catalogMigrationDatabaseUrl ? describe : describe.skip;
describeDb('GM-W4 mounted strict HTTP + real Identity/Booking/Invitation', () => {
  const db = new CatalogTestDatabase('guest_http');
  let f: Awaited<ReturnType<typeof studioFixture>>;
  let s: ReturnType<typeof createGuestServices>;
  let app: ReturnType<typeof createApp>;
  let groupId: string, guestId: string;
  beforeAll(async () => {
    await db.connect();
    f = await studioFixture(db.prisma);
    s = createGuestServices(db.prisma);
    app = createApp({
      runtimeEnvironment: 'test',
      securityConfig: {
        replicaCount: 1,
        bodyLimitBytes: 1024 * 1024,
        requestTimeoutMs: 30000,
        rateLimit: { maxRequests: 1000, windowMs: 60000 },
      },
      registerBodyParsers: (e) => e.use(createGuestImportBodyParser()),
      registerRoutes: (e) => e.use('/api/v1', createGuestRouter(s)),
    });
  }, 60000);
  afterAll(() => db.disconnect());
  const url = (path: string) => `/api/v1/bookings/${f.bookingId}/${path}`;
  const get = (path: string, token = f.couple.accessToken) =>
    request(app).get(url(path)).set('Authorization', `Bearer ${token}`);
  const post = (path: string, body: object, key: string = randomUUID()) =>
    request(app)
      .post(url(path))
      .set('Authorization', `Bearer ${f.couple.accessToken}`)
      .set('Idempotency-Key', key)
      .send(body);
  const patch = (path: string, body: object, key: string = randomUUID()) =>
    request(app)
      .patch(url(path))
      .set('Authorization', `Bearer ${f.couple.accessToken}`)
      .set('Idempotency-Key', key)
      .send(body);
  it('supports an empty named list with Group-only planning and scoped denials', async () => {
    expect((await request(app).get(url('guest-groups'))).status).toBe(401);
    const groups = await get('guest-groups');
    expect(groups.status).toBe(200);
    expect(groups.headers['cache-control']).toBe('no-store');
    expect((await request(app).get('/api/v1/unrelated')).status).toBe(404);
    groupId = data(groups, z.array(groupSchema))[0]!.guestGroupId;
    expect(data(await get('guests'), privateListSchema).items).toEqual([]);
    expect(data(await get('guest-plan'), planSchema).planningHeadcount).toBe(20);
    const outsider = await f.actor('COUPLE'),
      staff = await f.actor('STAFF');
    expect((await get('guest-groups', outsider.accessToken)).status).toBe(404);
    expect((await get('guest-groups', staff.accessToken)).status).toBe(404);
    await db.prisma.consultationAccess.create({
      data: { consultationId: f.consultationId, accountId: outsider.actorId, level: 'RESTRICTED' },
    });
    expect((await get('guest-groups', outsider.accessToken)).status).toBe(403);
    expect((await get('guest-groups', f.manager.accessToken)).status).toBe(200);
  });
  it('validates strict groups/named-person payloads, idempotency, revision and retained references', async () => {
    expect(
      (
        await request(app)
          .post(url('guests'))
          .set('Authorization', `Bearer ${f.couple.accessToken}`)
          .send({ name: 'An', guestGroupId: groupId })
      ).status,
    ).toBe(400);
    expect(
      (await post('guests', { name: 'An', guestGroupId: groupId, expectedAttendees: 5 })).status,
    ).toBe(422);
    expect(
      (await post('guests', { name: 'An', guestGroupId: groupId }, 'x'.repeat(129))).status,
    ).toBe(422);
    expect((await post('guests', { name: 'An', guestGroupId: randomUUID() })).status).toBe(404);
    const key = randomUUID(),
      input = {
        name: 'Nguyễn An',
        guestGroupId: groupId,
        phone: '+84901234567',
        operationalNote: 'Only owners',
      };
    const created = await post('guests', input, key);
    expect(created.status).toBe(201);
    guestId = data(created, guestSchema).guestId;
    expect((await post('guests', input, key)).body).toEqual(created.body);
    expect((await post('guests', { ...input, name: 'Other' }, key)).status).toBe(422);
    expect(
      (await patch(`guests/${guestId}`, { expectedRevision: 2, name: 'Another' })).status,
    ).toBe(409);
    expect(
      (await patch(`guests/${randomUUID()}`, { expectedRevision: 1, status: 'ARCHIVED' })).status,
    ).toBe(404);
    expect(
      code(await patch(`guest-groups/${groupId}`, { expectedRevision: 1, status: 'ARCHIVED' })),
    ).toBe('GUEST_GROUP_IN_USE');
    expect(
      (await patch(`guest-groups/${groupId}`, { expectedRevision: 99, name: 'Other' })).status,
    ).toBe(409);
    expect(
      (await patch(`guest-groups/${randomUUID()}`, { expectedRevision: 1, color: '#FFFFFF' }))
        .status,
    ).toBe(404);
    const custom = await post('guest-groups', { name: '  Đồng nghiệp  ', color: '#abcdef' });
    expect(custom.status).toBe(201);
    const customId = data(custom, groupSchema).guestGroupId;
    expect(code(await post('guest-groups', { name: 'ĐỒNG NGHIỆP', color: '#ABCDEF' }))).toBe(
      'GUEST_GROUP_NAME_CONFLICT',
    );
    expect(
      (await patch(`guest-groups/${customId}`, { expectedRevision: 1, status: 'ARCHIVED' })).status,
    ).toBe(200);
    expect((await post('guests', { name: 'An', guestGroupId: customId })).status).toBe(404);
    expect(
      (
        await patch(`guest-groups/${customId}`, {
          expectedRevision: 2,
          name: 'Team',
          status: 'ACTIVE',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await patch(`guests/${guestId}`, {
          expectedRevision: 1,
          guestGroupId: customId,
          phone: null,
          operationalNote: null,
          name: 'An',
        })
      ).status,
    ).toBe(200);
    expect(
      (await patch(`guests/${guestId}`, { expectedRevision: 2, status: 'ARCHIVED' })).status,
    ).toBe(200);
    expect(data(await get('guests?status=ARCHIVED'), privateListSchema).items).toHaveLength(1);
    expect(
      (await patch(`guests/${guestId}`, { expectedRevision: 3, status: 'ACTIVE' })).status,
    ).toBe(200);
    expect(data(await get('guest-plan'), planSchema).planningHeadcount).toBe(20);
    await expect(db.prisma.guest.delete({ where: { id: guestId } })).rejects.toThrow();
  });
  it('commits exact preview/imports and rejects stale/digest/row reuse without partial writes', async () => {
    const rows = [{ externalRowKey: 'key-1', name: 'Bình', guestGroupId: groupId }];
    expect(
      (await post('guests/import-previews', { rows: [{ ...rows[0], unexpectedColumn: true }] }))
        .status,
    ).toBe(422);
    const preview = data(await post('guests/import-previews', { rows }), previewSchema);
    expect(
      (await post('guests/imports', { previewId: randomUUID(), digest: preview.digest })).status,
    ).toBe(404);
    expect(
      (await post('guests/imports', { previewId: preview.previewId, digest: '0'.repeat(64) }))
        .status,
    ).toBe(409);
    const commit = { previewId: preview.previewId, digest: preview.digest },
      key = randomUUID();
    expect(data(await post('guests/imports', commit, key), importResultSchema).createdCount).toBe(
      1,
    );
    expect(data(await post('guests/imports', commit, key), importResultSchema).createdCount).toBe(
      1,
    );
    expect((await post('guests/imports', commit)).status).toBe(409);
    const changedRows = [{ ...rows[0], name: 'Bình mới' }];
    expect(code(await post('guests/import-previews', { rows: changedRows }))).toBe(
      'GUEST_IMPORT_ROW_CONFLICT',
    );
    const update = data(
      await post('guests/import-previews', { rows: changedRows, allowUpdates: true }),
      previewSchema,
    );
    expect(update.updatedCount).toBe(1);
    expect(
      data(
        await post('guests/imports', { previewId: update.previewId, digest: update.digest }),
        importResultSchema,
      ).updatedCount,
    ).toBe(1);
    const unchanged = data(
      await post('guests/import-previews', { rows: changedRows }),
      previewSchema,
    );
    expect(
      data(
        await post('guests/imports', { previewId: unchanged.previewId, digest: unchanged.digest }),
        importResultSchema,
      ).unchangedCount,
    ).toBe(1);
    const stale = data(
      await post('guests/import-previews', { rows: [{ ...rows[0], externalRowKey: 'key-2' }] }),
      previewSchema,
    );
    await post('guests', { name: 'Separate edit', guestGroupId: groupId });
    expect(
      code(await post('guests/imports', { previewId: stale.previewId, digest: stale.digest })),
    ).toBe('GUEST_IMPORT_PREVIEW_STALE');
    expect(data(await get('guest-plan'), planSchema).planningHeadcount).toBe(20);
  });
  it('paginates list with bound cursors and isolates booking/group IDs', async () => {
    const first = data(await get('guests?limit=1'), privateListSchema);
    expect(first.nextCursor).toBeTypeOf('string');
    const second = data(await get(`guests?limit=1&cursor=${first.nextCursor!}`), privateListSchema);
    expect(second.items[0]!.guestId).not.toBe(first.items[0]!.guestId);
    expect((await get('guests?cursor=invalid-json')).status).toBe(422);
    expect((await get('guests?limit=51')).status).toBe(422);
    expect((await get('guests?responseStatus=YES')).status).toBe(422);
    expect((await get(`guests?guestGroupId=${groupId}`)).status).toBe(200);
    await post('guests', { name: 'Newest', guestGroupId: groupId });
    expect(code(await get(`guests?limit=1&cursor=${first.nextCursor!}`))).toBe(
      'GUEST_LIST_CURSOR_STALE',
    );
    const other = await studioFixture(db.prisma);
    expect(
      (
        await request(app)
          .patch(`/api/v1/bookings/${other.bookingId}/guests/${guestId}`)
          .set('Authorization', `Bearer ${other.couple.accessToken}`)
          .set('Idempotency-Key', randomUUID())
          .send({ expectedRevision: 1, name: 'Leak' })
      ).status,
    ).toBe(404);
  });
  it('accepts a valid import above the general 1 MiB limit and keeps the 5 MiB import ceiling', async () => {
    const body = {
      rows: Array.from({ length: 1000 }, (_, i) => ({
        externalRowKey: `large-${i}`,
        name: 'Khách',
        guestGroupId: groupId,
        operationalNote: 'ệ'.repeat(500),
      })),
    };
    expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(1024 * 1024);
    const preview = await post('guests/import-previews', body);
    expect(preview.status).toBe(200);
    expect(data(preview, previewSchema).createdCount).toBe(1000);
    expect((await post('guests', body)).status).toBe(413);
    expect(
      (await post('guests/import-previews', { padding: 'x'.repeat(5 * 1024 * 1024) })).status,
    ).toBe(413);
  }, 60000);
  it('explicit total updates accept zero, replay safely, and serialize conflicting edits', async () => {
    const key = randomUUID(),
      body = { expectedRevision: 1, planningHeadcount: 0 };
    expect(data(await patch('guest-plan', body, key), planSchema)).toMatchObject({
      planningHeadcount: 0,
      sourceSequence: 1,
    });
    expect((await patch('guest-plan', body, key)).status).toBe(200);
    expect((await patch('guest-plan', body)).status).toBe(409);
    const results = await Promise.all([
      patch('guest-plan', { expectedRevision: 2, planningHeadcount: 25 }),
      patch('guest-plan', { expectedRevision: 2, planningHeadcount: 30 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const current = data(await get('guest-plan'), planSchema);
    expect(
      data(
        await patch('guest-plan', {
          expectedRevision: current.revision,
          planningHeadcount: current.planningHeadcount,
        }),
        planSchema,
      ),
    ).toEqual(current);
    expect(
      (await patch('guest-plan', { expectedRevision: current.revision, planningHeadcount: 10001 }))
        .status,
    ).toBe(422);
  });
  it('exposes only guest invitation view; no attendance/response writes or generic QR authority', async () => {
    const design = await f.services.designs.create(
      { bookingId: f.bookingId, content: f.content, idempotencyKey: randomUUID() },
      f.couple,
    );
    await f.services.publication.publish(
      {
        bookingId: f.bookingId,
        designId: design.designId,
        designRevisionId: design.revisionId,
        expectedRevision: 1,
        expectedPublicationRevision: 0,
        idempotencyKey: randomUUID(),
      },
      f.couple,
    );
    const link = await post(`guests/${guestId}/personalized-invitations`, { expectedRevision: 0 });
    expect(link.status).toBe(201);
    const credential = data(link, issuedLinkSchema).credential;
    const session = await request(app)
      .post('/api/v1/guest/invitation-sessions')
      .send({ credential });
    expect(session.status).toBe(200);
    const token = data(session, sessionSchema).capability;
    const view = await request(app)
      .get('/api/v1/guest/invitation')
      .set('Authorization', `Bearer ${token}`);
    expect(view.status).toBe(200);
    expect(Object.keys(data(view, invitationViewSchema))).toEqual([
      'recipientGreeting',
      'invitation',
    ]);
    expect(view.headers['cache-control']).toBe('no-store');
    expect((await get('guests', token)).status).toBe(401);
    expect(
      (
        await request(app)
          .post('/api/v1/guest/invitation-sessions')
          .send({ credential, response: 'YES' })
      ).status,
    ).toBe(422);
    expect(code(await request(app).get('/api/v1/guest/invitation'))).toBe(
      'INVITATION_LINK_UNAVAILABLE',
    );
    expect(
      (await request(app).get('/api/v1/guest/invitation').set('Authorization', 'Basic invalid'))
        .status,
    ).toBe(404);
    expect(
      (await request(app).get('/api/v1/guest/invitation').set('Authorization', 'Bearer generic-qr'))
        .status,
    ).toBe(404);
    for (const path of ['/api/v1/guest/check-in', '/api/v1/guest/responses'])
      expect(
        (await request(app).post(path).set('Authorization', `Bearer ${token}`).send({})).status,
      ).toBe(404);
    expect(
      (await post(`guests/${guestId}/personalized-invitations`, { expectedRevision: 0 })).status,
    ).toBe(409);
    expect(
      (await patch(`guests/${guestId}`, { expectedRevision: 4, status: 'ARCHIVED' })).status,
    ).toBe(200);
    expect(
      (await request(app).get('/api/v1/guest/invitation').set('Authorization', `Bearer ${token}`))
        .status,
    ).toBe(404);
  });
});
