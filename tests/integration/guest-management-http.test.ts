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
  planSchema,
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
  beforeAll(async () => {
    await db.connect();
    f = await studioFixture(db.prisma, null, { commercialTableCount: 4 });
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
  it('retains independent planning and group access with owner-scoped denials', async () => {
    expect((await request(app).get(url('guest-groups'))).status).toBe(401);
    const groups = await get('guest-groups');
    expect(groups.status).toBe(200);
    expect(groups.headers['cache-control']).toBe('no-store');
    expect(data(groups, z.array(groupSchema))).toHaveLength(4);
    expect(data(await get('guest-plan'), planSchema).planningHeadcount).toBe(20);
    for (const role of ['COUPLE', 'STAFF'] as const) {
      const outsider = await f.actor(role);
      expect((await get('guest-groups', outsider.accessToken)).status).toBe(404);
    }
    expect((await get('guest-groups', f.manager.accessToken)).status).toBe(200);
  });
  it('keeps strict group commands, idempotency, stale revisions and archive/restore', async () => {
    const key = randomUUID(),
      input = { name: 'Đồng nghiệp', color: '#ABCDEF' };
    const created = await post('guest-groups', input, key);
    expect(created.status).toBe(201);
    expect((await post('guest-groups', input, key)).body).toEqual(created.body);
    const groupId = data(created, groupSchema).guestGroupId;
    expect(code(await post('guest-groups', input))).toBe('GUEST_GROUP_NAME_CONFLICT');
    expect(
      (await patch(`guest-groups/${groupId}`, { expectedRevision: 99, name: 'Other' })).status,
    ).toBe(409);
    expect(
      (await patch(`guest-groups/${groupId}`, { expectedRevision: 1, status: 'ARCHIVED' })).status,
    ).toBe(200);
    expect(
      (await patch(`guest-groups/${groupId}`, { expectedRevision: 2, status: 'ACTIVE' })).status,
    ).toBe(200);
    expect((await post('guest-groups', { ...input, unexpected: true })).status).toBe(422);
  });
  it('rejects named list reads, writes, imports and personalized issuance without altering stored history', async () => {
    for (const response of [
      await get('guests'),
      await post('guests', {}),
      await patch(`guests/${randomUUID()}`, {}),
      await post('guests/import-previews', {}),
      await post('guests/imports', {}),
      await post(`guests/${randomUUID()}/personalized-invitations`, {}),
    ]) {
      expect(response.status).toBe(410);
      expect(code(response)).toBe('FEATURE_RETIRED');
    }
    expect(await db.prisma.guest.count({ where: { bookingId: f.bookingId } })).toBe(0);
    expect(data(await get('guest-plan'), planSchema).planningHeadcount).toBe(20);
  });
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
  it('continues to render previously issued read-only invitations without allowing new issuance', async () => {
    const group = (await s.guests.groups(f.bookingId, f.couple))[0]!;
    const legacy = await s.guests.createGuest(
      f.bookingId,
      { name: 'Legacy invitation recipient', guestGroupId: group.guestGroupId },
      randomUUID(),
      f.couple,
    );
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
    // Historical fixture issued through the retained internal owner, not the retired HTTP route.
    const link = await s.links.issue(
      f.bookingId,
      legacy.guestId,
      { expectedRevision: 0 },
      randomUUID(),
      f.couple,
    );
    const session = await request(app)
      .post('/api/v1/guest/invitation-sessions')
      .send({ credential: link.credential });
    expect(session.status).toBe(200);
    const token = data(session, sessionSchema).capability;
    const view = await request(app).get('/api/v1/guest/invitation').auth(token, { type: 'bearer' });
    expect(view.status).toBe(200);
    expect(Object.keys(data(view, invitationViewSchema))).toEqual([
      'recipientGreeting',
      'invitation',
    ]);
    expect(
      (await post(`guests/${legacy.guestId}/personalized-invitations`, { expectedRevision: 1 }))
        .status,
    ).toBe(410);
    for (const path of ['/api/v1/guest/check-in', '/api/v1/guest/responses'])
      expect((await request(app).post(path).auth(token, { type: 'bearer' }).send({})).status).toBe(
        404,
      );
  });
});
