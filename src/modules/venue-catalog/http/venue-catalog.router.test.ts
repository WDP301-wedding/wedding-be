import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { describe, expect, it, vi, type Mock } from 'vitest';

import { createApp } from '../../../app.js';
import { ValidationError } from '../../../core/errors/app-error.js';
import { CatalogPolicyError } from '../domain/catalog-policy.js';
import type { CatalogMutationContext } from '../infrastructure/catalog-version.repository.js';
import {
  catalogActorScope,
  createCatalogId,
  createVenueCatalogRouter,
  type VenueCatalogHttpServices,
} from './venue-catalog.router.js';

const managerId = randomUUID();
const hallId = randomUUID();

type MockedService<T> = {
  [Key in keyof T]: T[Key] extends (...arguments_: infer Arguments) => infer Result
    ? Mock<(...arguments_: Arguments) => Result>
    : T[Key];
};

function mockedService<T extends object>(service: T): MockedService<T> {
  return service as MockedService<T>;
}

function services(): VenueCatalogHttpServices {
  const context: CatalogMutationContext = { actorId: managerId, requestId: randomUUID() };
  return {
    authorizeManager: vi.fn(() => Promise.resolve(context)),
    venue: {
      getRestaurantProfile: vi.fn(() =>
        Promise.resolve({
          id: randomUUID(),
          displayName: 'Wedding Estate',
          description: 'Restaurant',
          address: 'Ho Chi Minh City',
          publicPhone: null,
          publicEmail: null,
          revision: 4,
        }),
      ),
      listActiveShifts: vi.fn(() =>
        Promise.resolve([
          {
            code: 'LUNCH' as const,
            startTime: '10:00',
            endTime: '14:00',
            isActive: true,
            revision: 2,
          },
        ]),
      ),
      listShifts: vi.fn(() =>
        Promise.resolve([
          {
            code: 'LUNCH' as const,
            startTime: '10:00',
            endTime: '14:00',
            isActive: true,
            revision: 2,
          },
          {
            code: 'DINNER' as const,
            startTime: '17:00',
            endTime: '22:00',
            isActive: false,
            revision: 5,
          },
        ]),
      ),
      listActiveHalls: vi.fn(() =>
        Promise.resolve([
          {
            id: hallId,
            name: 'Lotus',
            description: 'Main hall',
            maxGuests: 300,
            displayOrder: 1,
            lifecycle: 'ACTIVE' as const,
            revision: 3,
            retiredAt: null,
          },
        ]),
      ),
      listHalls: vi.fn(() =>
        Promise.resolve([
          {
            id: hallId,
            name: 'Lotus',
            description: 'Main hall',
            maxGuests: 300,
            displayOrder: 1,
            lifecycle: 'ACTIVE' as const,
            revision: 3,
            retiredAt: null,
          },
          {
            id: '00000000-0000-4000-8000-000000000099',
            name: 'Rose',
            description: 'Retired hall',
            maxGuests: 120,
            displayOrder: 2,
            lifecycle: 'RETIRED' as const,
            revision: 7,
            retiredAt: new Date('2026-10-01T00:00:00.000Z'),
          },
        ]),
      ),
      getHall: vi.fn(() =>
        Promise.resolve({
          id: hallId,
          name: 'Lotus',
          description: 'Main hall',
          maxGuests: 300,
          displayOrder: 1,
          lifecycle: 'ACTIVE' as const,
          revision: 3,
          retiredAt: null,
        }),
      ),
      updateRestaurantProfile: vi.fn(() => Promise.resolve({ revision: 2 })),
      updateShift: vi.fn(() => Promise.resolve({ revision: 2 })),
      createHall: vi.fn(() =>
        Promise.resolve({
          id: randomUUID(),
          name: 'Created hall',
          nameNormalized: 'created hall',
          description: 'Description',
          maxGuests: 100,
          displayOrder: 1,
          lifecycle: 'ACTIVE' as const,
          revision: 1,
          retiredAt: null,
        }),
      ),
      updateHall: vi.fn(() => Promise.resolve({ revision: 2 })),
      changeHallLifecycle: vi.fn(() => Promise.resolve({ revision: 2 })),
      requireActiveHallSnapshot: vi.fn(),
      requireActiveShiftSnapshot: vi.fn(),
    } as unknown as VenueCatalogHttpServices['venue'],
    menu: {
      createDish: vi.fn(() => Promise.resolve({ id: randomUUID(), revision: 1 })),
      cloneDishVersion: vi.fn(() => Promise.resolve({ id: randomUUID(), revision: 1 })),
      updateDishDraft: vi.fn(() => Promise.resolve({ id: randomUUID(), revision: 2 })),
      publishDish: vi.fn(() => Promise.resolve({ id: randomUUID() })),
      changeDishLifecycle: vi.fn(() => Promise.resolve({ revision: 2 })),
      createMenuPackage: vi.fn(() => Promise.resolve({ id: randomUUID(), revision: 1 })),
      cloneMenuPackageVersion: vi.fn(() => Promise.resolve({ id: randomUUID(), revision: 1 })),
      updateMenuPackageDraft: vi.fn(() => Promise.resolve({ id: randomUUID(), revision: 2 })),
      publishMenuPackage: vi.fn(() => Promise.resolve({ id: randomUUID() })),
      changeMenuPackageLifecycle: vi.fn(() => Promise.resolve({ revision: 2 })),
    } as unknown as VenueCatalogHttpServices['menu'],
    timeline: {
      createTemplate: vi.fn(() => Promise.resolve({ id: randomUUID(), revision: 1 })),
      cloneVersion: vi.fn(() => Promise.resolve({ id: randomUUID(), revision: 1 })),
      updateDraft: vi.fn(() => Promise.resolve({ id: randomUUID(), revision: 2 })),
      publish: vi.fn(() => Promise.resolve({ id: randomUUID() })),
      changeLifecycle: vi.fn(() => Promise.resolve({ revision: 2 })),
    } as unknown as VenueCatalogHttpServices['timeline'],
    layout: {
      createTemplate: vi.fn(() => Promise.resolve({ id: randomUUID(), revision: 1 })),
      cloneVersion: vi.fn(() => Promise.resolve({ id: randomUUID(), revision: 1 })),
      updateDraft: vi.fn(() => Promise.resolve({ id: randomUUID(), revision: 2 })),
      publish: vi.fn(() => Promise.resolve({ id: randomUUID() })),
      registerTable: vi.fn(() => Promise.resolve()),
      retireTable: vi.fn(() => Promise.resolve()),
      changeLifecycle: vi.fn(() => Promise.resolve({ revision: 2 })),
    } as unknown as VenueCatalogHttpServices['layout'],
    media: {
      listSigned: vi.fn(() => Promise.resolve([])),
      upload: vi.fn(() => Promise.resolve({ id: randomUUID(), url: 'signed' })),
      replace: vi.fn(() => Promise.resolve({ id: randomUUID(), url: 'signed' })),
      reorder: vi.fn(() => Promise.resolve()),
    } as unknown as VenueCatalogHttpServices['media'],
    queries: {
      listPublicHalls: vi.fn((input: { limit: number; cursor?: string }) => {
        if (input.cursor && input.cursor !== hallId)
          throw new ValidationError([
            { path: 'cursor', code: 'invalid_value', message: 'The catalog cursor is invalid.' },
          ]);
        return Promise.resolve({
          items: input.cursor
            ? []
            : [{ id: hallId, name: 'Lotus', description: 'Main hall', maxGuests: 300, media: [] }],
          nextCursor: input.limit === 1 ? hallId : null,
        });
      }),
      findAggregateIdForVersion: vi.fn(() => Promise.resolve(randomUUID())),
      listPublicDishes: vi.fn(() => Promise.resolve({ items: [], nextCursor: null })),
      listPublicMenuPackages: vi.fn(() => Promise.resolve({ items: [], nextCursor: null })),
      listTimelineTemplates: vi.fn(() => Promise.resolve({ items: [], nextCursor: null })),
      getTimelineTemplate: vi.fn(() => Promise.resolve({ id: randomUUID() })),
      listLayoutTemplates: vi.fn(() => Promise.resolve({ items: [], nextCursor: null })),
      getLayoutTemplate: vi.fn(() => Promise.resolve({ id: randomUUID() })),
      listDishes: vi.fn(() => Promise.resolve({ items: [], nextCursor: null })),
      getDish: vi.fn(() => Promise.resolve({ id: randomUUID() })),
      listMenuPackages: vi.fn(() => Promise.resolve({ items: [], nextCursor: null })),
      getMenuPackage: vi.fn(() => Promise.resolve({ id: randomUUID() })),
    },
  };
}

function appWith(catalogServices = services()) {
  const app = createApp({
    registerRoutes: (expressApp) => {
      expressApp.use(
        '/api/v1',
        createVenueCatalogRouter({
          services: catalogServices,
          createIdempotencyHandler: () => (_request, _response, next) => next(),
        }),
      );
    },
  });
  return { app, catalogServices };
}

describe('FT-V3 venue catalog HTTP contract', () => {
  it('publishes active restaurant and cursor-paged halls without manager metadata', async () => {
    const { app } = appWith();

    const restaurant = await request(app).get('/api/v1/catalog/restaurant');
    const halls = await request(app).get('/api/v1/catalog/halls?limit=20');

    expect(restaurant.status).toBe(200);
    expect(restaurant.body).toMatchObject({
      data: {
        displayName: 'Wedding Estate',
        shifts: [{ code: 'LUNCH' }],
      },
    });
    expect(JSON.stringify(restaurant.body)).not.toMatch(/revision|retiredAt|actor|objectKey/u);
    expect(halls.status).toBe(200);
    expect(halls.body).toEqual({
      data: {
        items: [
          {
            id: hallId,
            name: 'Lotus',
            description: 'Main hall',
            maxGuests: 300,
            media: [],
          },
        ],
        nextCursor: null,
      },
    });
  });

  it('returns manager venue state with revisions, inactive shifts, and retired halls', async () => {
    const { app } = appWith();

    const unauthorized = await request(app).get('/api/v1/management/catalog/restaurant');
    const restaurant = await request(app)
      .get('/api/v1/management/catalog/restaurant')
      .set('Authorization', 'Bearer manager-token');
    const shifts = await request(app)
      .get('/api/v1/management/catalog/shifts')
      .set('Authorization', 'Bearer manager-token');
    const halls = await request(app)
      .get('/api/v1/management/catalog/halls?limit=20')
      .set('Authorization', 'Bearer manager-token');

    expect(unauthorized.status).toBe(401);
    expect(restaurant.status).toBe(200);
    expect(restaurant.body).toMatchObject({
      data: { displayName: 'Wedding Estate', revision: 4 },
    });
    expect(shifts.body).toMatchObject({
      data: {
        items: [
          { code: 'LUNCH', isActive: true, revision: 2 },
          { code: 'DINNER', isActive: false, revision: 5 },
        ],
      },
    });
    expect(halls.body).toMatchObject({
      data: {
        items: [
          { id: hallId, lifecycle: 'ACTIVE', revision: 3 },
          { lifecycle: 'RETIRED', revision: 7 },
        ],
        nextCursor: null,
      },
    });
  });

  it('continues manager hall pages and rejects an unknown cursor', async () => {
    const { app } = appWith();
    const firstPage = await request(app)
      .get('/api/v1/management/catalog/halls?limit=1')
      .set('Authorization', 'Bearer manager-token');
    const secondPage = await request(app)
      .get('/api/v1/management/catalog/halls')
      .query({ limit: 1, cursor: hallId })
      .set('Authorization', 'Bearer manager-token');
    const invalidCursor = await request(app)
      .get('/api/v1/management/catalog/halls')
      .query({ limit: 1, cursor: randomUUID() })
      .set('Authorization', 'Bearer manager-token');

    expect(firstPage.status).toBe(200);
    expect(firstPage.body).toMatchObject({
      data: { items: [{ id: hallId }], nextCursor: hallId },
    });
    expect(secondPage.status).toBe(200);
    expect(secondPage.body).toMatchObject({
      data: {
        items: [{ id: '00000000-0000-4000-8000-000000000099', lifecycle: 'RETIRED' }],
        nextCursor: null,
      },
    });
    expect(invalidCursor.status).toBe(422);
    expect(invalidCursor.body).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        details: [{ path: 'cursor', code: 'invalid_value' }],
      },
    });
  });

  it('returns freshly signed media to Managers for an allowlisted catalog resource', async () => {
    const catalogServices = services();
    const media = mockedService(catalogServices.media);
    const assetId = randomUUID();
    media.listSigned.mockResolvedValueOnce([
      {
        id: assetId,
        resourceType: 'HALL',
        resourceId: hallId,
        contentType: 'image/webp',
        sizeBytes: 2048,
        alternativeText: 'Sảnh chính',
        displayOrder: 1,
        signedUrl: 'https://storage.example.test/signed',
        signedUrlExpiresInSeconds: 300,
      },
    ]);
    const { app } = appWith(catalogServices);

    const unauthorized = await request(app).get(`/api/v1/management/catalog/halls/${hallId}/media`);
    const response = await request(app)
      .get(`/api/v1/management/catalog/halls/${hallId}/media`)
      .set('Authorization', 'Bearer manager-token');

    expect(unauthorized.status).toBe(401);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: {
        items: [
          expect.objectContaining({
            id: assetId,
            signedUrl: 'https://storage.example.test/signed',
            signedUrlExpiresInSeconds: 300,
          }),
        ],
      },
    });
    expect(media.listSigned).toHaveBeenCalledWith('HALL', hallId);
    expect(JSON.stringify(response.body)).not.toMatch(/objectKey|checksumSha256/u);
  });

  it('requires a current manager and idempotency key for hall creation', async () => {
    const { app, catalogServices } = appWith();
    const venue = mockedService(catalogServices.venue);
    const body = {
      id: randomUUID(),
      name: 'Rose',
      description: 'Second hall',
      maxGuests: 180,
      displayOrder: 2,
    };

    const unauthenticated = await request(app)
      .post('/api/v1/management/catalog/halls')
      .set('Idempotency-Key', 'hall:create:rose')
      .send(body);
    const created = await request(app)
      .post('/api/v1/management/catalog/halls')
      .set('Authorization', 'Bearer manager-token')
      .set('Idempotency-Key', 'hall:create:rose')
      .send(body);

    expect(unauthenticated.status).toBe(401);
    expect(created.status).toBe(201);
    expect(created.headers.etag).toBe('"1"');
    expect(catalogServices.authorizeManager).toHaveBeenCalledWith(
      'manager-token',
      expect.any(String),
    );
    expect(venue.createHall).toHaveBeenCalledOnce();
    expect(venue.createHall.mock.calls[0]?.[0]).toMatchObject(body);
    expect(venue.createHall.mock.calls[0]?.[0].context.actorId).toBe(managerId);
  });

  it('rejects forged fields before dispatching a protected mutation', async () => {
    const { app, catalogServices } = appWith();
    const venue = mockedService(catalogServices.venue);

    const response = await request(app)
      .post('/api/v1/management/catalog/halls')
      .set('Authorization', 'Bearer manager-token')
      .set('Idempotency-Key', 'hall:create:forged')
      .send({
        id: randomUUID(),
        name: 'Forged',
        description: '',
        maxGuests: 100,
        displayOrder: 1,
        lifecycle: 'ACTIVE',
        role: 'MANAGER',
      });

    expect(response.status).toBe(422);
    expect(venue.createHall).not.toHaveBeenCalled();
  });

  it('dispatches the complete Manager catalog surface with validated identities and CAS bodies', async () => {
    const { app, catalogServices } = appWith();
    const queries = mockedService(catalogServices.queries);
    const layoutService = mockedService(catalogServices.layout);
    const mediaService = mockedService(catalogServices.media);
    const aggregateId = randomUUID();
    const versionId = randomUUID();
    const sourceVersionId = randomUUID();
    const tableId = randomUUID();
    const dishVersionId = randomUUID();
    const authorization = 'Bearer manager-token';
    const clone = { sourceVersionId, versionId };
    const dish = {
      dishId: aggregateId,
      versionId,
      displayOrder: 1,
      name: 'Dish',
      description: 'Description',
      categoryLabel: 'MAIN',
      priceVnd: 250_000,
    };
    const menu = {
      menuPackageId: aggregateId,
      versionId,
      displayOrder: 1,
      name: 'Menu',
      description: 'Description',
      priceVndPerTable: 4_000_000,
      items: [{ dishVersionId, displayOrder: 1 }],
    };
    const timelineItem = {
      id: randomUUID(),
      title: 'Welcome',
      description: null,
      offsetMinutes: 0,
      durationMinutes: 30,
      displayOrder: 1,
    };
    const timeline = {
      templateId: aggregateId,
      versionId,
      displayOrder: 1,
      name: 'Reception',
      description: 'Description',
      items: [timelineItem],
    };
    const layoutTable = {
      tableId,
      label: 'A1',
      shape: 'ROUND',
      seatCapacity: 10,
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      rotationDegrees: 0,
      displayOrder: 1,
    };
    const layout = {
      templateId: aggregateId,
      versionId,
      hallId,
      displayOrder: 1,
      name: 'Layout',
      description: 'Description',
      minGuests: 1,
      maxGuests: 10,
      tables: [layoutTable],
    };
    const lifecyclePaths = [
      'halls',
      'dishes',
      'menu-packages',
      'timeline-templates',
      'layout-templates',
    ];

    const responses = await Promise.all([
      request(app)
        .patch('/api/v1/management/catalog/restaurant')
        .set('Authorization', authorization)
        .send({
          displayName: 'Wedding Estate',
          description: 'Description',
          address: 'Ho Chi Minh City',
          publicPhone: null,
          publicEmail: null,
          expectedRevision: 1,
        }),
      request(app)
        .patch('/api/v1/management/catalog/shifts/LUNCH')
        .set('Authorization', authorization)
        .send({ startTime: '10:00', endTime: '14:00', isActive: true, expectedRevision: 1 }),
      request(app)
        .patch(`/api/v1/management/catalog/halls/${hallId}`)
        .set('Authorization', authorization)
        .send({
          name: 'Lotus',
          description: 'Description',
          maxGuests: 300,
          displayOrder: 1,
          expectedRevision: 1,
        }),
      request(app).get('/api/v1/management/catalog/dishes').set('Authorization', authorization),
      request(app)
        .get(`/api/v1/management/catalog/dishes/${aggregateId}`)
        .set('Authorization', authorization),
      request(app)
        .post('/api/v1/management/catalog/dishes')
        .set('Authorization', authorization)
        .send(dish),
      request(app)
        .post(`/api/v1/management/catalog/dishes/${aggregateId}/versions`)
        .set('Authorization', authorization)
        .send(clone),
      request(app)
        .patch(`/api/v1/management/catalog/dish-versions/${versionId}`)
        .set('Authorization', authorization)
        .send({
          ...dish,
          dishId: undefined,
          versionId: undefined,
          displayOrder: undefined,
          expectedRevision: 1,
        }),
      request(app)
        .post(`/api/v1/management/catalog/dish-versions/${versionId}/publication`)
        .set('Authorization', authorization)
        .send({ expectedRevision: 1 }),
      request(app)
        .get('/api/v1/management/catalog/menu-packages')
        .set('Authorization', authorization),
      request(app)
        .get(`/api/v1/management/catalog/menu-packages/${aggregateId}`)
        .set('Authorization', authorization),
      request(app)
        .post('/api/v1/management/catalog/menu-packages')
        .set('Authorization', authorization)
        .send(menu),
      request(app)
        .post(`/api/v1/management/catalog/menu-packages/${aggregateId}/versions`)
        .set('Authorization', authorization)
        .send(clone),
      request(app)
        .patch(`/api/v1/management/catalog/menu-package-versions/${versionId}`)
        .set('Authorization', authorization)
        .send({
          name: menu.name,
          description: menu.description,
          priceVndPerTable: menu.priceVndPerTable,
          items: menu.items,
          expectedRevision: 1,
        }),
      request(app)
        .post(`/api/v1/management/catalog/menu-package-versions/${versionId}/publication`)
        .set('Authorization', authorization)
        .send({ expectedRevision: 1 }),
      request(app)
        .get('/api/v1/management/catalog/timeline-templates')
        .set('Authorization', authorization),
      request(app)
        .get(`/api/v1/management/catalog/timeline-templates/${aggregateId}`)
        .set('Authorization', authorization),
      request(app)
        .post('/api/v1/management/catalog/timeline-templates')
        .set('Authorization', authorization)
        .send(timeline),
      request(app)
        .post(`/api/v1/management/catalog/timeline-templates/${aggregateId}/versions`)
        .set('Authorization', authorization)
        .send(clone),
      request(app)
        .patch(`/api/v1/management/catalog/timeline-template-versions/${versionId}`)
        .set('Authorization', authorization)
        .send({
          name: timeline.name,
          description: timeline.description,
          items: timeline.items,
          expectedRevision: 1,
        }),
      request(app)
        .post(`/api/v1/management/catalog/timeline-template-versions/${versionId}/publication`)
        .set('Authorization', authorization)
        .send({ expectedRevision: 1 }),
      request(app)
        .get('/api/v1/management/catalog/layout-templates')
        .set('Authorization', authorization),
      request(app)
        .get(`/api/v1/management/catalog/layout-templates/${aggregateId}`)
        .set('Authorization', authorization),
      request(app)
        .post('/api/v1/management/catalog/layout-templates')
        .set('Authorization', authorization)
        .send(layout),
      request(app)
        .post(`/api/v1/management/catalog/layout-templates/${aggregateId}/versions`)
        .set('Authorization', authorization)
        .send(clone),
      request(app)
        .patch(`/api/v1/management/catalog/layout-template-versions/${versionId}`)
        .set('Authorization', authorization)
        .send({
          name: layout.name,
          description: layout.description,
          minGuests: layout.minGuests,
          maxGuests: layout.maxGuests,
          tables: layout.tables,
          expectedRevision: 1,
        }),
      request(app)
        .post(`/api/v1/management/catalog/layout-template-versions/${versionId}/publication`)
        .set('Authorization', authorization)
        .send({ expectedRevision: 1 }),
      request(app)
        .post(`/api/v1/management/catalog/layout-templates/${aggregateId}/tables`)
        .set('Authorization', authorization)
        .send({ tableId }),
      request(app)
        .post(
          `/api/v1/management/catalog/layout-templates/${aggregateId}/tables/${tableId}/retirement`,
        )
        .set('Authorization', authorization)
        .send({}),
      request(app)
        .patch(`/api/v1/management/catalog/dish-versions/${versionId}/media-order`)
        .set('Authorization', authorization)
        .send({ assetIds: [randomUUID()], expectedRevision: 1 }),
      ...lifecyclePaths.flatMap((resource) =>
        ['retirement', 'restoration'].map((transition) =>
          request(app)
            .post(`/api/v1/management/catalog/${resource}/${aggregateId}/${transition}`)
            .set('Authorization', authorization)
            .send({ expectedRevision: 1 }),
        ),
      ),
    ]);

    expect(responses.map(({ status }) => status)).toEqual(expect.arrayContaining([200, 201, 204]));
    expect(responses.every(({ status }) => status < 300)).toBe(true);
    expect(queries.findAggregateIdForVersion).toHaveBeenCalledTimes(8);
    expect(layoutService.retireTable).toHaveBeenCalled();
    expect(mediaService.reorder).toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: 'DISH_VERSION', expectedRevision: 1 }),
    );
  });

  it('handles public filtering, pagination, concealed halls, policy errors, and multipart media', async () => {
    const catalogServices = services();
    const venue = mockedService(catalogServices.venue);
    const mediaService = mockedService(catalogServices.media);
    venue.listActiveHalls.mockResolvedValue([
      {
        id: hallId,
        name: 'Lotus',
        description: 'Main hall',
        maxGuests: 300,
        displayOrder: 1,
        lifecycle: 'ACTIVE',
        revision: 3,
        retiredAt: null,
      },
      {
        id: randomUUID(),
        name: 'Rose',
        description: 'Second hall',
        maxGuests: 100,
        displayOrder: 2,
        lifecycle: 'ACTIVE',
        revision: 1,
        retiredAt: null,
      },
    ]);
    const { app } = appWith(catalogServices);

    const [dishList, menuList, hallPage, hallDetail, invalidCursor, upload, replace, missingFile] =
      await Promise.all([
        request(app).get('/api/v1/catalog/dishes?categoryLabel=MAIN&search=Dish&limit=1'),
        request(app).get('/api/v1/catalog/menu-packages?limit=1'),
        request(app).get('/api/v1/catalog/halls?limit=1'),
        request(app).get(`/api/v1/catalog/halls/${hallId}`),
        request(app).get(`/api/v1/catalog/halls?cursor=${randomUUID()}`),
        request(app)
          .post('/api/v1/management/catalog/media-assets')
          .set('Authorization', 'Bearer manager-token')
          .field('assetId', randomUUID())
          .field('resourceType', 'HALL')
          .field('resourceId', hallId)
          .field('alternativeText', 'Hall')
          .attach('file', Buffer.from('image'), { filename: 'hall.png', contentType: 'image/png' }),
        request(app)
          .post('/api/v1/management/catalog/media-assets')
          .set('Authorization', 'Bearer manager-token')
          .field('assetId', randomUUID())
          .field('oldAssetId', randomUUID())
          .field('resourceType', 'HALL')
          .field('resourceId', hallId)
          .field('alternativeText', 'Hall')
          .attach('file', Buffer.from('image'), {
            filename: 'hall.webp',
            contentType: 'image/webp',
          }),
        request(app)
          .post('/api/v1/management/catalog/media-assets')
          .set('Authorization', 'Bearer manager-token')
          .field('assetId', randomUUID()),
      ]);

    expect([dishList.status, menuList.status, hallPage.status, hallDetail.status]).toEqual([
      200, 200, 200, 200,
    ]);
    expect(hallPage.body).toMatchObject({ data: { nextCursor: hallId } });
    expect(invalidCursor.status).toBe(422);
    expect(upload.status).toBe(201);
    expect(replace.status).toBe(201);
    expect(missingFile.status).toBe(422);
    expect(mediaService.upload).toHaveBeenCalled();
    expect(mediaService.replace).toHaveBeenCalled();
  });

  it('maps protected-route, concealed-resource, policy, and upload boundary failures', async () => {
    const catalogServices = services();
    const venue = mockedService(catalogServices.venue);
    venue.getHall.mockResolvedValueOnce({
      id: hallId,
      name: 'Retired',
      description: 'Hidden',
      maxGuests: 10,
      displayOrder: 1,
      lifecycle: 'RETIRED',
      revision: 2,
      retiredAt: new Date(),
    });
    venue.updateRestaurantProfile.mockRejectedValueOnce(
      new CatalogPolicyError('CATALOG_POLICY_REJECTED', 'Catalog policy rejected the update.'),
    );
    const { app } = appWith(catalogServices);
    const validFields = (operation: request.Test) =>
      operation
        .field('assetId', randomUUID())
        .field('resourceType', 'HALL')
        .field('resourceId', hallId)
        .field('alternativeText', 'Hall');

    const [retired, invalidAuthorization, policy, missingFile, tooManyFiles] = await Promise.all([
      request(app).get(`/api/v1/catalog/halls/${hallId}`),
      request(app).get('/api/v1/management/catalog/dishes').set('Authorization', 'Basic invalid'),
      request(app)
        .patch('/api/v1/management/catalog/restaurant')
        .set('Authorization', 'Bearer manager-token')
        .send({
          displayName: 'Wedding Estate',
          description: 'Description',
          address: 'Ho Chi Minh City',
          publicPhone: null,
          publicEmail: null,
          expectedRevision: 1,
        }),
      validFields(
        request(app)
          .post('/api/v1/management/catalog/media-assets')
          .set('Authorization', 'Bearer manager-token'),
      ),
      validFields(
        request(app)
          .post('/api/v1/management/catalog/media-assets')
          .set('Authorization', 'Bearer manager-token'),
      )
        .attach('file', Buffer.from('one'), { filename: 'one.png', contentType: 'image/png' })
        .attach('file', Buffer.from('two'), { filename: 'two.png', contentType: 'image/png' }),
    ]);

    expect(retired.status).toBe(404);
    expect(invalidAuthorization.status).toBe(401);
    expect(policy.status).toBe(422);
    expect(policy.body).toMatchObject({ error: { code: 'CATALOG_POLICY_REJECTED' } });
    expect(missingFile.status).toBe(422);
    expect(tooManyFiles.status).toBe(422);
    expect(createCatalogId()).toMatch(/^[0-9a-f-]{36}$/u);
    expect(() => catalogActorScope({} as never)).toThrow();
  });
});
