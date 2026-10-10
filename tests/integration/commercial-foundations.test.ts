import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { purgeConsultationIntake } from '../../src/modules/booking-lifecycle/application/intake-retention.js';
import { seedVenueCatalog } from '../../scripts/catalog-seed.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { createCoupleProfileService } from '../../src/modules/booking-lifecycle/application/couple-profile.service.js';
import { createCoupleProfileRouter } from '../../src/modules/booking-lifecycle/http/couple-profile.router.js';
import { createBookingExperienceRouter } from '../../src/modules/booking-lifecycle/http/experience.router.js';
import { createRestaurantServiceService } from '../../src/modules/venue-catalog/application/restaurant-service.service.js';
import { createPrintOfferingService } from '../../src/modules/venue-catalog/application/print-offering.service.js';
import { createInvitationTemplateSelectionReader } from '../../src/modules/invitation-studio/infrastructure/template-selection.reader.js';
import {
  createCommercialCatalogRouter,
  commercialActorScope,
  createPrintCommercialCatalogRouter,
} from '../../src/modules/venue-catalog/http/commercial-catalog.router.js';
import { createIdempotencyService } from '../../src/core/idempotency/idempotency.service.js';
import { createPrismaIdempotencyRepository } from '../../src/core/idempotency/idempotency.repository.js';
import { createIdempotencyMiddleware } from '../../src/core/idempotency/idempotency.middleware.js';
import { defineIdempotencyPolicy } from '../../src/core/idempotency/idempotency.policy.js';
import { bookingIdempotencyPayload } from '../../src/modules/booking-lifecycle/booking-lifecycle.runtime.js';
import type { AuthenticatedActor } from '../../src/modules/identity-access/authorization/authenticated-actor.middleware.js';

const describeDb = catalogMigrationDatabaseUrl ? describe : describe.skip;
const manager: AuthenticatedActor = {
  accountId: randomUUID(),
  sessionId: randomUUID(),
  displayEmail: 'manager@example.com',
  roles: ['MANAGER'],
};
const own: AuthenticatedActor = {
  accountId: randomUUID(),
  sessionId: randomUUID(),
  displayEmail: 'own@example.com',
  roles: [],
};
const staff: AuthenticatedActor = {
  accountId: randomUUID(),
  sessionId: randomUUID(),
  displayEmail: 'staff@example.com',
  roles: ['STAFF'],
};
const outsider: AuthenticatedActor = {
  accountId: randomUUID(),
  sessionId: randomUUID(),
  displayEmail: 'other@example.com',
  roles: ['COUPLE'],
};
const consultationId = randomUUID();
const resolver = {
  resolve: (token: string) =>
    Promise.resolve(
      ({ manager, own, staff, outsider } as Record<string, AuthenticatedActor>)[token]!,
    ),
};

describeDb('BE-01–05 disposable PostgreSQL profile/catalog foundations', () => {
  const database = new CatalogTestDatabase('commercial_foundations');
  let app: ReturnType<typeof createApp>;
  let services: ReturnType<typeof createRestaurantServiceService>;
  let prints: ReturnType<typeof createPrintOfferingService>;
  const ctx = () => ({ actorId: manager.accountId, requestId: randomUUID() });
  const input = {
    name: 'MC',
    description: 'Dẫn chương trình',
    unit: 'buổi',
    unitPriceVnd: 2500000,
    active: true,
  };
  beforeAll(async () => {
    await database.connect(async (name, url) => {
      if (name !== '20261010010000_couple_profile') return;
      const client = new Client({ connectionString: url });
      await client.connect();
      try {
        await client.query(
          'INSERT INTO "Consultation" ("id", "managerAccountId", "intendedEmailNormalized", "intendedEmail", "displayName", "updatedAt") VALUES ($1,$2,$3,$3,$4,now())',
          [consultationId, manager.accountId, own.displayEmail, 'An và Minh'],
        );
      } finally {
        await client.end();
      }
    });
    for (const actor of [manager, own, staff, outsider])
      await database.prisma.account.create({
        data: {
          id: actor.accountId,
          emailNormalized: actor.displayEmail,
          displayEmail: actor.displayEmail,
        },
      });
    await database.prisma.consultationAccess.create({
      data: { accountId: own.accountId, consultationId, level: 'RESTRICTED' },
    });
    await seedVenueCatalog(database.prisma);
    services = createRestaurantServiceService(database.prisma);
    prints = createPrintOfferingService(database.prisma, createInvitationTemplateSelectionReader);
    const idempotency = createIdempotencyService(
      createPrismaIdempotencyRepository(database.prisma),
    );
    const idempotent = (normalizedRoute: string) =>
      createIdempotencyMiddleware({
        service: idempotency,
        policy: defineIdempotencyPolicy({
          actorScope: commercialActorScope,
          normalizedRoute,
          operationVersion: 'v1',
          payload: bookingIdempotencyPayload,
        }),
      });
    app = createApp({
      runtimeEnvironment: 'test',
      registerRoutes(express) {
        express.use(
          '/api/v1',
          createCoupleProfileRouter(
            createCoupleProfileService(database.prisma),
            resolver,
            idempotent('/consultations/{consultationId}/couple-profile'),
          ),
        );
        express.use('/api/v1', createBookingExperienceRouter(database.prisma, resolver));
        express.use('/api/v1', createCommercialCatalogRouter(services, resolver, idempotent));
        express.use('/api/v1', createPrintCommercialCatalogRouter(prints, resolver, idempotent));
      },
    });
  }, 60000);
  afterAll(() => database.disconnect());
  it('upgrades populated legacy consultations without guessing names; own writes audit/replay/stale/cross-scope', async () => {
    const path = `/api/v1/consultations/${consultationId}/couple-profile`;
    const legacy = await request(app).get(path).set('Authorization', 'Bearer own');
    expect(legacy.status).toBe(200);
    expect(legacy.body).toMatchObject({
      data: { displayName: 'An và Minh', brideName: null, groomName: null },
    });
    const key = randomUUID();
    const patch = () =>
      request(app)
        .patch(path)
        .set('Authorization', 'Bearer own')
        .set('Idempotency-Key', key)
        .send({ expectedRevision: 1, brideName: '  A\u0301nh ', groomName: 'Minh' });
    const saved = await patch();
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      data: { brideName: 'Ánh', groomName: 'Minh', revision: 2 },
    });
    const replayed = await patch();
    expect(replayed.body).toEqual(saved.body);
    expect(saved.headers['cache-control']).toBe('no-store');
    expect(replayed.headers['cache-control']).toBe('no-store');
    expect(
      (
        await request(app)
          .patch(path)
          .set('Authorization', 'Bearer manager')
          .set('Idempotency-Key', randomUUID())
          .send({ expectedRevision: 1, brideName: 'An' })
      ).status,
    ).toBe(409);
    for (const token of ['outsider', 'staff']) {
      expect((await request(app).get(path).set('Authorization', `Bearer ${token}`)).status).toBe(
        404,
      );
      expect(
        (
          await request(app)
            .patch(path)
            .set('Authorization', `Bearer ${token}`)
            .set('Idempotency-Key', randomUUID())
            .send({ expectedRevision: 2, brideName: 'An' })
        ).status,
      ).toBe(404);
    }
    expect(
      await database.prisma.auditLog.count({
        where: { action: 'booking.couple-profile-updated', entityId: consultationId },
      }),
    ).toBe(1);
    await database.prisma.consultationAccess.delete({
      where: { accountId_consultationId: { accountId: own.accountId, consultationId } },
    });
    expect((await patch()).status).toBe(404);
    await database.prisma.consultationAccess.create({
      data: { accountId: own.accountId, consultationId, level: 'RESTRICTED' },
    });
  });
  it('preserves intake names through conversion and provides nullable legacy intake fields', async () => {
    const submissionId = randomUUID();
    const result = await request(app).post('/api/v1/consultation-requests').send({
      submissionId,
      displayName: 'label',
      brideName: '  Lan ',
      groomName: 'Minh',
      email: 'lead@example.com',
      phone: '',
      preferredDate: null,
      expectedGuests: null,
      message: '',
    });
    expect(result.status).toBe(202);
    const intake = await database.prisma.consultationRequest.findUniqueOrThrow({
      where: { submissionId },
    });
    const converted = await request(app)
      .post(`/api/v1/management/consultation-requests/${intake.id}/conversion`)
      .set('Authorization', 'Bearer manager');
    expect(converted.status).toBe(200);
    const record = await database.prisma.consultation.findUniqueOrThrow({
      where: {
        id: (
          await database.prisma.consultationRequest.findUniqueOrThrow({ where: { submissionId } })
        ).consultationId!,
      },
    });
    expect(record).toMatchObject({ brideName: 'Lan', groomName: 'Minh', displayName: 'label' });
    await database.prisma.consultationRequest.update({
      where: { id: intake.id },
      data: { createdAt: new Date('2025-01-01T00:00:00Z') },
    });
    expect(await purgeConsultationIntake(database.prisma)).toMatchObject({ scrubbed: 1 });
    expect(
      await database.prisma.consultationRequest.findUniqueOrThrow({ where: { id: intake.id } }),
    ).toMatchObject({ brideName: null, groomName: null });
    expect(
      await database.prisma.consultation.findUniqueOrThrow({ where: { id: record.id } }),
    ).toMatchObject({ brideName: 'Lan', groomName: 'Minh' });
  });
  it('retains frozen service revisions after price changes and archive; rejects stale selection', async () => {
    const created = await services.create(input, ctx());
    expect(
      await services.requireSelection({
        serviceId: created.serviceId,
        sourceRevisionId: created.sourceRevisionId,
        quantity: 2,
      }),
    ).toMatchObject({ lineTotalVnd: 5000000 });
    const changed = await services.revise(
      created.serviceId,
      { ...input, expectedRevision: 1, unitPriceVnd: 3000000 },
      ctx(),
    );
    await expect(
      services.requireSelection({
        serviceId: created.serviceId,
        sourceRevisionId: created.sourceRevisionId,
        quantity: 1,
      }),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_PRICE_REVISION_STALE' });
    await services.revise(
      created.serviceId,
      { ...input, expectedRevision: 2, active: false },
      ctx(),
    );
    expect(await services.resolveRevision(created.sourceRevisionId)).toEqual(created);
    expect(await services.resolveRevision(changed.sourceRevisionId)).toEqual(changed);
    await expect(
      services.requireSelection({
        serviceId: created.serviceId,
        sourceRevisionId: changed.sourceRevisionId,
        quantity: 1,
      }),
    ).rejects.toMatchObject({ code: 'OFFERING_NOT_SELECTABLE' });
    await expect(
      database.prisma.restaurantServiceRevision.update({
        where: { id: created.sourceRevisionId },
        data: { name: 'rewrite' },
      }),
    ).rejects.toThrow();
    await expect(
      database.prisma.restaurantServiceRevision.delete({ where: { id: created.sourceRevisionId } }),
    ).rejects.toThrow();
  });
  it('allows one concurrent service revision winner and enforces HTTP RBAC/idempotency', async () => {
    const created = await services.create(input, ctx());
    const races = await Promise.allSettled(
      [1, 2].map((unitPriceVnd) =>
        services.revise(created.serviceId, { ...input, expectedRevision: 1, unitPriceVnd }, ctx()),
      ),
    );
    expect(races.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    for (const token of ['own', 'staff', 'outsider'])
      expect(
        (
          await request(app)
            .post('/api/v1/management/services')
            .set('Authorization', `Bearer ${token}`)
            .set('Idempotency-Key', randomUUID())
            .send(input)
        ).status,
      ).toBe(403);
    expect((await request(app).get('/api/v1/catalog/services')).status).toBe(401);
    expect(
      (await request(app).get('/api/v1/catalog/services').set('Authorization', 'Bearer staff'))
        .status,
    ).toBe(403);
    expect(
      (await request(app).get('/api/v1/catalog/services').set('Authorization', 'Bearer own'))
        .status,
    ).toBe(200);
    const key = randomUUID();
    const post = () =>
      request(app)
        .post('/api/v1/management/services')
        .set('Authorization', 'Bearer manager')
        .set('Idempotency-Key', key)
        .send(input);
    const first = await post();
    expect(first.status).toBe(201);
    const replayed = await post();
    expect(replayed.body).toEqual(first.body);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(replayed.headers['cache-control']).toBe('no-store');
  });

  async function template(active = true) {
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
            textFields: { message: 'Private draft message' },
            sections: [],
            derivedAssetIds: [],
            includesSeating: false,
          },
        },
      });
      await tx.invitationTemplate.create({
        data: { id: templateId, currentVersionId: templateVersionId, revision: 1, active },
      });
    });
    return { templateId, templateVersionId };
  }
  async function reviseTemplate(templateId: string, active: boolean) {
    await database.prisma.$transaction(async (tx) => {
      const head = await tx.invitationTemplate.findUniqueOrThrow({ where: { id: templateId } });
      const templateVersionId = randomUUID(),
        revision = head.revision + 1;
      await tx.invitationTemplateVersion.create({
        data: { id: templateVersionId, templateId, revision, content: { title: 'Revised style' } },
      });
      await tx.invitationTemplate.update({
        where: { id: templateId },
        data: { revision, active, currentVersionId: templateVersionId },
      });
    });
  }
  const printInput = (source: { templateId: string; templateVersionId: string }) => ({
    ...source,
    name: 'Thiệp tiêu chuẩn',
    printType: 'Hai mặt',
    material: 'Giấy mỹ thuật',
    unitPriceVnd: 5000,
    active: true,
  });
  it('publishes only safe template selection facts and permits pre-deposit commercial selection', async () => {
    const source = await template();
    const facts = await createInvitationTemplateSelectionReader(database.prisma).requireSelection(
      source,
    );
    expect(Object.keys(facts).sort()).toEqual([
      'revision',
      'templateId',
      'templateVersionId',
      'title',
    ]);
    const key = randomUUID();
    const post = () =>
      request(app)
        .post('/api/v1/management/print-offerings')
        .set('Authorization', 'Bearer manager')
        .set('Idempotency-Key', key)
        .send(printInput(source));
    const result = await post();
    expect(result.status).toBe(201);
    const replayed = await post();
    expect(replayed.body).toEqual(result.body);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(replayed.headers['cache-control']).toBe('no-store');
    const row = await database.prisma.printOffering.findFirstOrThrow({
      where: { revisions: { some: { templateId: source.templateId } } },
      include: { revisions: true },
    });
    const selected = await prints.requireSelection({
      offeringId: row.id,
      sourceRevisionId: row.revisions[0]!.id,
      quantity: 100,
    });
    expect(selected).toMatchObject({ lineTotalVnd: 500000, unit: 'copy' });
    const listing = await request(app)
      .get('/api/v1/catalog/print-offerings')
      .set('Authorization', 'Bearer own');
    expect(listing.status).toBe(200);
    expect(JSON.stringify(listing.body)).not.toMatch(
      /Private draft|textFields|sections|derivedAsset|content/,
    );
    for (const token of ['own', 'staff', 'outsider'])
      expect(
        (
          await request(app)
            .post('/api/v1/management/print-offerings')
            .set('Authorization', `Bearer ${token}`)
            .set('Idempotency-Key', randomUUID())
            .send(printInput(source))
        ).status,
      ).toBe(403);
    expect(
      (
        await request(app)
          .get('/api/v1/catalog/print-offerings')
          .set('Authorization', 'Bearer staff')
      ).status,
    ).toBe(403);
  });
  it('denies inactive/stale template selections but keeps commercial history and allows archive', async () => {
    const inactive = await template(false);
    await expect(prints.create(printInput(inactive), ctx())).rejects.toMatchObject({
      code: 'OFFERING_NOT_SELECTABLE',
    });
    const source = await template();
    const created = await prints.create(printInput(source), ctx());
    await reviseTemplate(source.templateId, false);
    await expect(
      prints.requireSelection({
        offeringId: created.offeringId,
        sourceRevisionId: created.sourceRevisionId,
        quantity: 1,
      }),
    ).rejects.toMatchObject({ code: 'OFFERING_NOT_SELECTABLE' });
    expect((await prints.list()).items.some((item) => item.offeringId === created.offeringId)).toBe(
      false,
    );
    await prints.revise(
      created.offeringId,
      { ...printInput(source), expectedRevision: 1, active: false },
      ctx(),
    );
    expect(await prints.resolveRevision(created.sourceRevisionId)).toEqual(created);
    await expect(
      database.prisma.printOfferingRevision.delete({ where: { id: created.sourceRevisionId } }),
    ).rejects.toThrow();
    await expect(
      database.prisma.invitationTemplateVersion.delete({ where: { id: source.templateVersionId } }),
    ).rejects.toThrow();
    await reviseTemplate(source.templateId, true);
    await expect(prints.create(printInput(source), ctx())).rejects.toMatchObject({
      code: 'COMMERCIAL_PRICE_REVISION_STALE',
    });
    expect(
      (
        await createInvitationTemplateSelectionReader(database.prisma).resolveVersion(
          source.templateVersionId,
        )
      ).title,
    ).toBe('Thiệp truyền thống');
  });
  it('rejects stale print prices, races revisions, and never invokes production/billing', async () => {
    const source = await template();
    const beforeCharges = await database.prisma.billingLedgerEntry.count();
    const created = await prints.create(printInput(source), ctx());
    const races = await Promise.allSettled(
      [6000, 7000].map((unitPriceVnd) =>
        prints.revise(
          created.offeringId,
          { ...printInput(source), expectedRevision: 1, unitPriceVnd },
          ctx(),
        ),
      ),
    );
    expect(races.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    await expect(
      prints.requireSelection({
        offeringId: created.offeringId,
        sourceRevisionId: created.sourceRevisionId,
        quantity: 100,
      }),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_PRICE_REVISION_STALE' });
    expect(await prints.resolveRevision(created.sourceRevisionId)).toEqual(created);
    expect(await database.prisma.billingLedgerEntry.count()).toBe(beforeCharges);
    expect(await database.prisma.invitationDesign.count()).toBe(0);
    expect(await database.prisma.invitationPrintOrder.count()).toBe(0);
  });
  it('retains omitted names, denies granted Staff and rolls back profile writes on audit failure', async () => {
    const profile = createCoupleProfileService(database.prisma);
    await expect(profile.read(randomUUID(), manager)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await database.prisma.consultationAccess.create({
      data: { accountId: staff.accountId, consultationId, level: 'RESTRICTED' },
    });
    await expect(profile.read(consultationId, staff)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const before = await profile.read(consultationId, own);
    const after = await profile.update(
      consultationId,
      { expectedRevision: before.revision, groomName: 'Minh Anh' },
      manager,
      randomUUID(),
    );
    expect(after).toMatchObject({ brideName: before.brideName, groomName: 'Minh Anh' });
    await expect(
      profile.update(
        consultationId,
        { expectedRevision: after.revision, brideName: 'Rollback' },
        manager,
        'invalid-uuid',
      ),
    ).rejects.toThrow();
    expect(await profile.read(consultationId, own)).toEqual(after);
    const races = await Promise.allSettled(
      ['Lan', 'Linh'].map((brideName) =>
        profile.update(
          consultationId,
          { expectedRevision: after.revision, brideName },
          own,
          randomUUID(),
        ),
      ),
    );
    expect(races.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  });
  it('paginates Manager catalogs, archives through HTTP and rejects invalid authorities/missing sources', async () => {
    const created = await services.create(input, ctx());
    const patch = await request(app)
      .patch(`/api/v1/management/services/${created.serviceId}`)
      .set('Authorization', 'Bearer manager')
      .set('Idempotency-Key', randomUUID())
      .send({ ...input, expectedRevision: 1, active: false });
    expect(patch.status).toBe(200);
    expect(await services.resolveRevision(created.sourceRevisionId)).toEqual(created);
    const page = await request(app)
      .get('/api/v1/management/services?limit=1')
      .set('Authorization', 'Bearer manager');
    expect(page.status).toBe(200);
    const cursor = (page.body as { data: { nextCursor: string | null } }).data.nextCursor;
    expect(cursor).not.toBeNull();
    expect(
      (
        await request(app)
          .get('/api/v1/management/services')
          .query({ cursor, limit: 1 })
          .set('Authorization', 'Bearer manager')
      ).status,
    ).toBe(200);
    await services.list(false, cursor!, 1);
    for (const query of ['limit=0', 'limit=51', 'unexpected=true'])
      expect(
        (
          await request(app)
            .get('/api/v1/catalog/services?' + query)
            .set('Authorization', 'Bearer own')
        ).status,
      ).toBe(422);
    expect(
      (
        await request(app)
          .post('/api/v1/management/services')
          .set('Authorization', 'Bearer manager')
          .set('Idempotency-Key', randomUUID())
          .send({ ...input, lineTotalVnd: 1 })
      ).status,
    ).toBe(422);
    await expect(services.resolveRevision(randomUUID())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      services.revise(randomUUID(), { ...input, expectedRevision: 1 }, ctx()),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      services.requireSelection({
        serviceId: randomUUID(),
        sourceRevisionId: randomUUID(),
        quantity: 1,
      }),
    ).rejects.toMatchObject({ code: 'OFFERING_NOT_SELECTABLE' });
    const count = await database.prisma.restaurantService.count();
    await expect(services.create(input, { ...ctx(), requestId: 'invalid-uuid' })).rejects.toThrow();
    expect(await database.prisma.restaurantService.count()).toBe(count);
  });
  it('handles print archive/pagination/missing references and propagates unexpected reader failures', async () => {
    const source = await template();
    const other = await template();
    const created = await prints.create(printInput(source), ctx());
    const patch = await request(app)
      .patch(`/api/v1/management/print-offerings/${created.offeringId}`)
      .set('Authorization', 'Bearer manager')
      .set('Idempotency-Key', randomUUID())
      .send({ ...printInput(source), expectedRevision: 1, active: false });
    expect(patch.status).toBe(200);
    await expect(
      prints.requireSelection({
        offeringId: created.offeringId,
        sourceRevisionId: created.sourceRevisionId,
        quantity: 1,
      }),
    ).rejects.toMatchObject({ code: 'OFFERING_NOT_SELECTABLE' });
    await expect(
      prints.revise(created.offeringId, { ...printInput(source), expectedRevision: 1 }, ctx()),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_PRICE_REVISION_STALE' });
    const managed = await request(app)
      .get('/api/v1/management/print-offerings?limit=1')
      .set('Authorization', 'Bearer manager');
    expect(managed.status).toBe(200);
    const cursor = (managed.body as { data: { nextCursor: string | null } }).data.nextCursor;
    expect(cursor).not.toBeNull();
    await prints.list(true, cursor!, 1);
    await prints.list(false, cursor!, 1);
    await expect(
      prints.revise(randomUUID(), { ...printInput(source), expectedRevision: 1 }, ctx()),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(prints.resolveRevision(randomUUID())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      prints.requireSelection({
        offeringId: randomUUID(),
        sourceRevisionId: randomUUID(),
        quantity: 1,
      }),
    ).rejects.toMatchObject({ code: 'OFFERING_NOT_SELECTABLE' });
    await expect(
      prints.create({ ...printInput(source), templateId: other.templateId, active: false }, ctx()),
    ).rejects.toMatchObject({ code: 'OFFERING_NOT_SELECTABLE' });
    const templates = createInvitationTemplateSelectionReader(database.prisma);
    await expect(templates.resolveVersion(randomUUID())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      templates.requireSelection({ templateId: randomUUID(), templateVersionId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'OFFERING_NOT_SELECTABLE' });
    const failure = new Error('controlled template reader outage');
    const failing = createPrintOfferingService(database.prisma, () => ({
      requireSelection: () => Promise.reject(failure),
      resolveVersion: () => Promise.reject(failure),
    }));
    await expect(failing.list()).rejects.toThrow(failure);
    const count = await database.prisma.printOffering.count();
    await expect(
      prints.create(printInput(source), { ...ctx(), requestId: 'invalid-uuid' }),
    ).rejects.toThrow();
    expect(await database.prisma.printOffering.count()).toBe(count);
  });
});
