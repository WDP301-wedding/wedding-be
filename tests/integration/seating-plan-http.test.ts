import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createSeatingRouter } from '../../src/modules/seating-plan/http/seating.router.js';
import { createSeatingServices } from '../../src/modules/seating-plan/infrastructure/seating.composition.js';
import { planViewSchema } from '../../src/modules/seating-plan/application/seating.service.js';
import { optionsSchema } from '../../src/modules/seating-plan/http/seating.router.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'SEA-W4 strict HTTP with native sessions and owner authorization',
  () => {
    const db = new CatalogTestDatabase('seating_http');
    beforeAll(() => db.connect(), 60000);
    afterAll(() => db.disconnect());
    it('finds the current plan by booking across clients and preserves empty/scoped outcomes', async () => {
      const f = await studioFixture(db.prisma),
        s = createSeatingServices(db.prisma, f.services);
      const app = createApp({
        runtimeEnvironment: 'test',
        registerRoutes: (e) => e.use('/api/v1', createSeatingRouter(s.seating, s.resolver)),
      });
      const path = `/api/v1/bookings/${f.bookingId}/seating-plans/current`;
      const read = (token = f.couple.accessToken) =>
        request(app).get(path).auth(token, { type: 'bearer' });
      await request(app).get(path).expect(401);
      const empty = await read().expect(200);
      expect(empty.body).toEqual({ data: null });
      expect(empty.headers['cache-control']).toBe('no-store');
      await request(app)
        .get(`${path}?extra=1`)
        .auth(f.couple.accessToken, { type: 'bearer' })
        .expect(422);
      for (const role of ['COUPLE', 'STAFF'] as const) {
        await read((await f.actor(role)).accessToken).expect(404);
      }
      const restricted = await f.actor('COUPLE');
      await db.prisma.consultationAccess.create({
        data: {
          consultationId: f.consultationId,
          accountId: restricted.actorId,
          level: 'RESTRICTED',
        },
      });
      await read(restricted.accessToken).expect(403);
      const created = await s.seating.select(
        f.bookingId,
        { layoutTemplateVersionId: f.layoutId, expectedBookingRevision: 1 },
        randomUUID(),
        f.couple,
      );
      const first = await read().expect(200);
      expect(first.body).toEqual({ data: created });
      await read(f.manager.accessToken).expect(200);
      await s.seating.revise(
        f.bookingId,
        created.seatingPlanId,
        { expectedRevision: 1, labels: [] },
        randomUUID(),
        f.couple,
      );
      const latest = await read().expect(200);
      expect(planViewSchema.parse((latest.body as { data: unknown }).data).revisionNumber).toBe(2);
      const byId = await request(app)
        .get(path.replace('current', created.seatingPlanId))
        .auth(f.couple.accessToken, { type: 'bearer' })
        .expect(200);
      expect(latest.body).toEqual(byId.body);
      expect(await db.prisma.seatingPlanRevision.count({ where: { bookingId: f.bookingId } })).toBe(
        2,
      );
      await db.prisma.session.update({
        where: { id: f.couple.sessionId },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
      await read().expect(401);
    }, 30000);
    it('runs no-list selection/labels/confirmation/read/Manager exception through mounted routes', async () => {
      const f = await studioFixture(db.prisma),
        s = createSeatingServices(db.prisma, f.services),
        groups = await s.guests.guests.groups(f.bookingId, f.couple);
      const app = createApp({
        runtimeEnvironment: 'test',
        registerRoutes: (app) => app.use('/api/v1', createSeatingRouter(s.seating, s.resolver)),
      });
      const root = `/api/v1/bookings/${f.bookingId}`,
        key = randomUUID();
      const options = await request(app)
        .get(`${root}/seating-layout-options`)
        .auth(f.couple.accessToken, { type: 'bearer' })
        .expect(200);
      expect(optionsSchema.parse((options.body as { data: unknown }).data)).toMatchObject({
        planningHeadcount: 20,
        bookingRevision: 1,
      });
      const select = { layoutTemplateVersionId: f.layoutId, expectedBookingRevision: 1 };
      await request(app)
        .post(`${root}/seating-plans`)
        .auth(f.couple.accessToken, { type: 'bearer' })
        .send(select)
        .expect(400);
      await request(app)
        .post(`${root}/seating-plans`)
        .auth(f.couple.accessToken, { type: 'bearer' })
        .set('Idempotency-Key', 'é')
        .send(select)
        .expect(422);
      const created = await request(app)
        .post(`${root}/seating-plans`)
        .auth(f.couple.accessToken, { type: 'bearer' })
        .set('Idempotency-Key', key)
        .send(select)
        .expect(201);
      const replay = await request(app)
        .post(`${root}/seating-plans`)
        .auth(f.couple.accessToken, { type: 'bearer' })
        .set('Idempotency-Key', key)
        .send(select)
        .expect(201);
      expect(replay.body).toEqual(created.body);
      const selectedPlan = planViewSchema.parse((created.body as { data: unknown }).data);
      const path = `${root}/seating-plans/${selectedPlan.seatingPlanId}`;
      const revised = await request(app)
        .post(`${path}/revisions`)
        .auth(f.couple.accessToken, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send({
          expectedRevision: 1,
          labels: [
            {
              layoutTableId: selectedPlan.renderSnapshot[0]!.layoutTableId,
              guestGroupId: groups[0]!.guestGroupId,
            },
          ],
        })
        .expect(201);
      expect(
        planViewSchema.parse((revised.body as { data: unknown }).data).labels[0]!.groupName,
      ).toBe(groups[0]!.name);
      await request(app)
        .post(`${path}/confirmation`)
        .auth(f.manager.accessToken, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send({ expectedRevision: 2, expectedBookingRevision: 1 })
        .expect(201);
      const read = await request(app)
        .get(path)
        .auth(f.couple.accessToken, { type: 'bearer' })
        .expect(200);
      expect(planViewSchema.parse((read.body as { data: unknown }).data).status).toBe('CONFIRMED');
      expect(read.headers['cache-control']).toBe('no-store');
      const exception = `/api/v1/management/seating-plans/${selectedPlan.seatingPlanId}/exceptions`;
      await request(app)
        .post(exception)
        .auth(f.couple.accessToken, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send({
          expectedRevision: 3,
          expectedBookingRevision: 1,
          reason: 'Xác nhận phạm vi sức chứa vật lý',
        })
        .expect(404);
      await request(app)
        .post(exception)
        .auth(f.manager.accessToken, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send({
          expectedRevision: 3,
          expectedBookingRevision: 1,
          reason: 'Xác nhận phạm vi sức chứa vật lý',
        })
        .expect(201);
      for (const body of [
        { expectedRevision: 4, x: 0 },
        { expectedRevision: 4, guestId: randomUUID() },
        {
          expectedRevision: 4,
          labels: [
            {
              layoutTableId: randomUUID(),
              guestGroupId: groups[0]!.guestGroupId,
              color: '#FFFFFF',
            },
          ],
        },
      ])
        await request(app)
          .post(`${path}/revisions`)
          .auth(f.couple.accessToken, { type: 'bearer' })
          .set('Idempotency-Key', randomUUID())
          .send(body)
          .expect(422);
      await request(app)
        .get(`${path}?extra=1`)
        .auth(f.couple.accessToken, { type: 'bearer' })
        .expect(422);
      await request(app).get(path).expect(401);
      for (const role of ['COUPLE', 'STAFF'] as const) {
        const actor = await f.actor(role);
        await request(app).get(path).auth(actor.accessToken, { type: 'bearer' }).expect(404);
      }
      await db.prisma.session.update({
        where: { id: f.couple.sessionId },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
      await request(app).get(path).auth(f.couple.accessToken, { type: 'bearer' }).expect(401);
    }, 30000);
  },
);
