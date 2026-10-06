import { z } from 'zod';
import type { ZodOpenApiObject, ZodOpenApiResponseObject } from 'zod-openapi';

import {
  cloneVersionBodySchema,
  createDishBodySchema,
  createHallBodySchema,
  createLayoutBodySchema,
  createMenuPackageBodySchema,
  createTimelineBodySchema,
  lifecycleBodySchema,
  mediaOrderBodySchema,
  mediaUploadFieldsSchema,
  publishVersionBodySchema,
  registerTableBodySchema,
  updateDishVersionBodySchema,
  updateHallBodySchema,
  updateLayoutVersionBodySchema,
  updateMenuPackageVersionBodySchema,
  updateRestaurantBodySchema,
  updateShiftBodySchema,
  updateTimelineVersionBodySchema,
} from './venue-catalog.schemas.js';

type Paths = NonNullable<ZodOpenApiObject['paths']>;

const idSchema = z.uuid();
const nullableTimestampSchema = z.iso.datetime().nullable();
const mediaViewSchema = z.strictObject({
  id: idSchema,
  resourceType: mediaUploadFieldsSchema.shape.resourceType,
  resourceId: idSchema,
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  sizeBytes: z.int().min(1),
  alternativeText: z.string(),
  displayOrder: z.int().min(1),
  signedUrl: z.url(),
  signedUrlExpiresInSeconds: z.int().min(1),
});
const publicHallSchema = z.strictObject({
  id: idSchema,
  name: z.string(),
  description: z.string(),
  maxGuests: z.int(),
  media: z.array(mediaViewSchema),
});
const publicDishSchema = z.strictObject({
  id: idSchema,
  versionId: idSchema,
  versionNumber: z.int().min(1),
  name: z.string(),
  description: z.string(),
  categoryLabel: z.string(),
  priceVnd: z.int().nullable(),
  media: z.array(mediaViewSchema),
});
const publicMenuItemSchema = z.strictObject({
  dishId: idSchema,
  dishVersionId: idSchema,
  dishVersionNumber: z.int().min(1),
  name: z.string(),
  description: z.string(),
  categoryLabel: z.string(),
  priceVnd: z.int().nullable(),
  displayOrder: z.int().min(1),
});
const publicMenuSchema = z.strictObject({
  id: idSchema,
  versionId: idSchema,
  versionNumber: z.int().min(1),
  name: z.string(),
  description: z.string(),
  priceVndPerTable: z.int(),
  items: z.array(publicMenuItemSchema),
  media: z.array(mediaViewSchema),
});
const publicRestaurantSchema = z.strictObject({
  id: idSchema,
  displayName: z.string(),
  description: z.string(),
  address: z.string(),
  publicPhone: z.string().nullable(),
  publicEmail: z.email().nullable(),
  shifts: z.array(
    z.strictObject({
      code: z.enum(['LUNCH', 'DINNER']),
      startTime: z.string(),
      endTime: z.string(),
    }),
  ),
  media: z.array(mediaViewSchema),
});
const restaurantProfileSchema = publicRestaurantSchema.omit({ shifts: true, media: true }).extend({
  revision: z.int().min(1),
});
const shiftViewSchema = z.strictObject({
  code: z.enum(['LUNCH', 'DINNER']),
  startTime: z.string(),
  endTime: z.string(),
  isActive: z.boolean(),
  revision: z.int().min(1),
});
const hallViewSchema = publicHallSchema.omit({ media: true }).extend({
  displayOrder: z.int().min(0),
  lifecycle: z.enum(['ACTIVE', 'RETIRED']),
  revision: z.int().min(1),
  retiredAt: nullableTimestampSchema,
});
const aggregateFieldsSchema = z.strictObject({
  id: idSchema,
  lifecycle: z.enum(['ACTIVE', 'RETIRED']),
  displayOrder: z.int().min(0),
  revision: z.int().min(1),
  retiredAt: nullableTimestampSchema,
  currentPublishedVersionId: idSchema.nullable(),
  draftVersionId: idSchema.nullable(),
});
const versionFieldsSchema = z.strictObject({
  id: idSchema,
  versionNumber: z.int().min(1).nullable(),
  revision: z.int().min(1),
  state: z.enum(['DRAFT', 'PUBLISHED', 'SUPERSEDED']),
  name: z.string(),
  description: z.string(),
  publishedAt: nullableTimestampSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
const dishAggregateSchema = aggregateFieldsSchema.extend({
  versions: z.array(
    versionFieldsSchema.extend({ categoryLabel: z.string(), priceVnd: z.int().nullable() }),
  ),
});
const menuAggregateSchema = aggregateFieldsSchema.extend({
  versions: z.array(
    versionFieldsSchema.extend({
      priceVndPerTable: z.int(),
      items: z.array(publicMenuItemSchema),
    }),
  ),
});
const timelineAggregateSchema = aggregateFieldsSchema.extend({
  versions: z.array(
    versionFieldsSchema.extend({
      items: z.array(updateTimelineVersionBodySchema.shape.items.element),
    }),
  ),
});
const layoutAggregateSchema = aggregateFieldsSchema.extend({
  hallId: idSchema,
  tables: z.array(z.strictObject({ id: idSchema, retiredAt: nullableTimestampSchema })),
  versions: z.array(
    versionFieldsSchema.extend({
      minGuests: z.int(),
      maxGuests: z.int(),
      totalSeatCapacity: z.int(),
      tables: z.array(updateLayoutVersionBodySchema.shape.tables.element),
    }),
  ),
});
const revisionResultSchema = z.strictObject({ revision: z.int().min(1) });
const versionRevisionResultSchema = z.strictObject({
  versionId: idSchema,
  revision: z.int().min(1),
});
const publicationResultSchema = z.strictObject({
  aggregateId: idSchema,
  previousVersionId: idSchema.nullable(),
  versionId: idSchema,
  versionNumber: z.int().min(1),
});
const lifecycleResultSchema = z.strictObject({
  lifecycle: z.enum(['ACTIVE', 'RETIRED']),
  revision: z.int().min(1),
});
const createDishResultSchema = createDishBodySchema.omit({}).extend({ revision: z.int().min(1) });
const createMenuResultSchema = createMenuPackageBodySchema
  .omit({})
  .extend({ revision: z.int().min(1) });

function pageSchema(itemSchema: z.ZodType) {
  return z.strictObject({ items: z.array(itemSchema), nextCursor: idSchema.nullable() });
}

function catalogEnvelopeSchema(dataSchema: z.ZodType) {
  return z.strictObject({ data: dataSchema });
}
const catalogNoContent: ZodOpenApiResponseObject = {
  description: 'The mutation completed successfully.',
  headers: { 'x-request-id': { $ref: '#/components/headers/RequestId' } },
};
function catalogSuccess(dataSchema: z.ZodType): ZodOpenApiResponseObject {
  return {
    description: 'The catalog operation completed successfully.',
    content: { 'application/json': { schema: catalogEnvelopeSchema(dataSchema) } },
    headers: {
      ETag: {
        description: 'Quoted optimistic-concurrency revision when the resource is mutable.',
        schema: { type: 'string', pattern: '^"[1-9][0-9]*"$' },
      },
      'x-request-id': { $ref: '#/components/headers/RequestId' },
    },
  };
}

const bearerSecurity = [{ bearerAuth: [] }];
const managerErrors = {
  '401': { $ref: '#/components/responses/Unauthorized' },
  '403': { $ref: '#/components/responses/Forbidden' },
  '404': { $ref: '#/components/responses/NotFound' },
  '409': { $ref: '#/components/responses/Conflict' },
  '422': { $ref: '#/components/responses/UnprocessableEntity' },
  '500': { $ref: '#/components/responses/InternalServerError' },
} as const;
const idempotencyErrors = {
  '400': { $ref: '#/components/responses/IdempotencyKeyRequired' },
  '409': { $ref: '#/components/responses/RequestInProgress' },
  '422': { $ref: '#/components/responses/IdempotencyKeyReused' },
} as const;

function jsonBody(schema: z.ZodType) {
  return { required: true, content: { 'application/json': { schema } } };
}

function managerMutation(
  operationId: string,
  summary: string,
  schema: z.ZodType,
  options: {
    readonly created?: boolean;
    readonly idempotent?: boolean;
    readonly noContent?: boolean;
    readonly responseSchema?: z.ZodType;
  } = {},
) {
  return {
    operationId,
    summary,
    tags: ['Venue Catalog'],
    security: bearerSecurity,
    ...(options.idempotent
      ? { parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }] }
      : {}),
    requestBody: jsonBody(schema),
    responses: {
      [options.noContent ? '204' : options.created ? '201' : '200']: options.noContent
        ? catalogNoContent
        : catalogSuccess(options.responseSchema ?? revisionResultSchema),
      ...managerErrors,
      ...(options.idempotent ? idempotencyErrors : {}),
    },
  };
}

function pathParameter(name: string) {
  return {
    name,
    in: 'path' as const,
    required: true,
    schema: { type: 'string' as const, format: 'uuid' },
  };
}

function cursorParameters() {
  return [
    {
      name: 'limit',
      in: 'query' as const,
      required: false,
      schema: { type: 'integer' as const, minimum: 1, maximum: 100, default: 20 },
    },
    {
      name: 'cursor',
      in: 'query' as const,
      required: false,
      schema: { type: 'string' as const, format: 'uuid' },
    },
  ];
}

function publicReadResponses(dataSchema: z.ZodType) {
  return {
    '200': catalogSuccess(dataSchema),
    '404': { $ref: '#/components/responses/NotFound' },
    '422': { $ref: '#/components/responses/UnprocessableEntity' },
    '500': { $ref: '#/components/responses/InternalServerError' },
  };
}

const basePaths: Paths = {
  '/catalog/restaurant': {
    get: {
      operationId: 'getPublicRestaurant',
      summary: 'Get the active restaurant catalog profile',
      tags: ['Venue Catalog'],
      responses: publicReadResponses(publicRestaurantSchema),
    },
  },
  '/catalog/halls': {
    get: {
      operationId: 'listPublicHalls',
      summary: 'List active halls',
      tags: ['Venue Catalog'],
      parameters: cursorParameters(),
      responses: publicReadResponses(pageSchema(publicHallSchema)),
    },
  },
  '/catalog/halls/{hallId}': {
    get: {
      operationId: 'getPublicHall',
      summary: 'Get one active hall',
      tags: ['Venue Catalog'],
      parameters: [pathParameter('hallId')],
      responses: publicReadResponses(publicHallSchema),
    },
  },
  '/catalog/dishes': {
    get: {
      operationId: 'listPublicDishes',
      summary: 'List active current dish versions',
      tags: ['Venue Catalog'],
      parameters: [
        ...cursorParameters(),
        { name: 'categoryLabel', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'search', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: publicReadResponses(pageSchema(publicDishSchema)),
    },
  },
  '/catalog/menu-packages': {
    get: {
      operationId: 'listPublicMenuPackages',
      summary: 'List active current menu-package versions',
      tags: ['Venue Catalog'],
      parameters: cursorParameters(),
      responses: publicReadResponses(pageSchema(publicMenuSchema)),
    },
  },
  '/management/catalog/restaurant': {
    get: {
      operationId: 'getManagerRestaurant',
      summary: 'Get the Manager restaurant profile with its current revision',
      tags: ['Venue Catalog'],
      security: bearerSecurity,
      responses: { '200': catalogSuccess(restaurantProfileSchema), ...managerErrors },
    },
    patch: managerMutation(
      'updateRestaurantProfile',
      'Update the restaurant profile using its expected revision',
      updateRestaurantBodySchema,
      { responseSchema: restaurantProfileSchema },
    ),
  },
  '/management/catalog/shifts': {
    get: {
      operationId: 'listManagerShifts',
      summary: 'List fixed restaurant shifts with lifecycle state and revisions',
      tags: ['Venue Catalog'],
      security: bearerSecurity,
      responses: {
        '200': catalogSuccess(z.strictObject({ items: z.array(shiftViewSchema) })),
        ...managerErrors,
      },
    },
  },
  '/management/catalog/shifts/{shiftCode}': {
    patch: {
      ...managerMutation(
        'updateRestaurantShift',
        'Update one fixed restaurant shift',
        updateShiftBodySchema,
        { responseSchema: shiftViewSchema },
      ),
      parameters: [
        {
          name: 'shiftCode',
          in: 'path',
          required: true,
          schema: { type: 'string', enum: ['LUNCH', 'DINNER'] },
        },
      ],
    },
  },
  '/management/catalog/halls': {
    get: {
      operationId: 'listManagerHalls',
      summary: 'List halls including retired records and current revisions',
      tags: ['Venue Catalog'],
      security: bearerSecurity,
      parameters: cursorParameters(),
      responses: { '200': catalogSuccess(pageSchema(hallViewSchema)), ...managerErrors },
    },
    post: managerMutation('createHall', 'Create a hall', createHallBodySchema, {
      created: true,
      idempotent: true,
      responseSchema: hallViewSchema,
    }),
  },
  '/management/catalog/halls/{hallId}': {
    patch: {
      ...managerMutation(
        'updateHall',
        'Update a hall using its expected revision',
        updateHallBodySchema,
        { responseSchema: hallViewSchema },
      ),
      parameters: [pathParameter('hallId')],
    },
  },
  '/management/catalog/halls/{id}/retirement': {
    post: {
      ...managerMutation('retireHall', 'Retire one hall', lifecycleBodySchema, {
        idempotent: true,
        responseSchema: hallViewSchema,
      }),
      parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }, pathParameter('id')],
    },
  },
  '/management/catalog/halls/{id}/restoration': {
    post: {
      ...managerMutation('restoreHall', 'Restore one hall', lifecycleBodySchema, {
        idempotent: true,
        responseSchema: hallViewSchema,
      }),
      parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }, pathParameter('id')],
    },
  },
  '/management/catalog/dish-versions/{versionId}': {
    patch: {
      ...managerMutation(
        'updateDishDraft',
        'Update a dish draft version',
        updateDishVersionBodySchema,
        { responseSchema: revisionResultSchema },
      ),
      parameters: [pathParameter('versionId')],
    },
  },
  '/management/catalog/menu-package-versions/{versionId}': {
    patch: {
      ...managerMutation(
        'updateMenuPackageDraft',
        'Update a menu-package draft version',
        updateMenuPackageVersionBodySchema,
        { responseSchema: revisionResultSchema },
      ),
      parameters: [pathParameter('versionId')],
    },
  },
  '/management/catalog/timeline-template-versions/{versionId}': {
    patch: {
      ...managerMutation(
        'updateTimelineTemplateDraft',
        'Update a timeline-template draft version',
        updateTimelineVersionBodySchema,
        { responseSchema: revisionResultSchema },
      ),
      parameters: [pathParameter('versionId')],
    },
  },
  '/management/catalog/layout-template-versions/{versionId}': {
    patch: {
      ...managerMutation(
        'updateLayoutTemplateDraft',
        'Update a fixed-layout draft version',
        updateLayoutVersionBodySchema,
        { responseSchema: revisionResultSchema },
      ),
      parameters: [pathParameter('versionId')],
    },
  },
  '/management/catalog/{resource}/{resourceId}/media-order': {
    patch: {
      ...managerMutation(
        'reorderCatalogMedia',
        'Replace the complete attached media order',
        mediaOrderBodySchema,
        { noContent: true },
      ),
      parameters: [
        {
          name: 'resource',
          in: 'path',
          required: true,
          schema: {
            type: 'string',
            enum: [
              'restaurant-profile',
              'halls',
              'dish-versions',
              'menu-package-versions',
              'timeline-template-versions',
              'layout-template-versions',
            ],
          },
        },
        pathParameter('resourceId'),
      ],
    },
  },
  '/management/catalog/media-assets': {
    post: {
      ...managerMutation(
        'uploadCatalogMedia',
        'Upload or replace one validated catalog image',
        mediaUploadFieldsSchema,
        { created: true, idempotent: true, responseSchema: mediaViewSchema },
      ),
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: z.strictObject({
              assetId: z.uuid(),
              resourceType: mediaUploadFieldsSchema.shape.resourceType,
              resourceId: z.uuid(),
              alternativeText: z.string().min(1).max(250),
              oldAssetId: z.uuid().optional(),
              file: z
                .file()
                .max(10 * 1024 * 1024)
                .mime(['image/jpeg', 'image/png', 'image/webp']),
            }),
          },
        },
      },
    },
  },
};

function adminCollection(
  resource: string,
  singular: string,
  createSchema: z.ZodType,
  aggregateSchema: z.ZodType,
  createResponseSchema: z.ZodType,
  operationBase: string,
): Paths {
  const title = singular.replaceAll('-', ' ');
  return {
    [`/management/catalog/${resource}`]: {
      get: {
        operationId: `list${operationBase}s`,
        summary: `List ${title} aggregates and version history`,
        tags: ['Venue Catalog'],
        security: bearerSecurity,
        parameters: cursorParameters(),
        responses: { '200': catalogSuccess(pageSchema(aggregateSchema)), ...managerErrors },
      },
      post: managerMutation(
        `create${operationBase}Draft`,
        `Create a ${title} aggregate and first draft`,
        createSchema,
        { created: true, idempotent: true, responseSchema: createResponseSchema },
      ),
    },
    [`/management/catalog/${resource}/{${singular}Id}`]: {
      get: {
        operationId: `get${operationBase}History`,
        summary: `Get one ${title} aggregate with immutable history`,
        tags: ['Venue Catalog'],
        security: bearerSecurity,
        parameters: [pathParameter(`${singular}Id`)],
        responses: { '200': catalogSuccess(aggregateSchema), ...managerErrors },
      },
    },
    [`/management/catalog/${resource}/{${singular}Id}/versions`]: {
      post: {
        ...managerMutation(
          `clone${operationBase}Version`,
          `Clone an immutable ${title} version into a new draft`,
          cloneVersionBodySchema,
          { created: true, idempotent: true, responseSchema: versionRevisionResultSchema },
        ),
        parameters: [
          { $ref: '#/components/parameters/IdempotencyKey' },
          pathParameter(`${singular}Id`),
        ],
      },
    },
    [`/management/catalog/${resource}/{id}/retirement`]: {
      post: {
        ...managerMutation(
          `retire${operationBase}`,
          `Retire one ${title} aggregate`,
          lifecycleBodySchema,
          { idempotent: true, responseSchema: lifecycleResultSchema },
        ),
        parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }, pathParameter('id')],
      },
    },
    [`/management/catalog/${resource}/{id}/restoration`]: {
      post: {
        ...managerMutation(
          `restore${operationBase}`,
          `Restore one ${title} aggregate`,
          lifecycleBodySchema,
          { idempotent: true, responseSchema: lifecycleResultSchema },
        ),
        parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }, pathParameter('id')],
      },
    },
  };
}

function publicationPath(prefix: string, operationId: string): Paths {
  return {
    [`/management/catalog/${prefix}-versions/{versionId}/publication`]: {
      post: {
        ...managerMutation(
          operationId,
          `Publish one immutable ${prefix} version`,
          publishVersionBodySchema,
          { created: true, idempotent: true, responseSchema: publicationResultSchema },
        ),
        parameters: [
          { $ref: '#/components/parameters/IdempotencyKey' },
          pathParameter('versionId'),
        ],
      },
    },
  };
}

export const venueCatalogOpenApiPaths: Paths = {
  ...basePaths,
  ...adminCollection(
    'dishes',
    'dish',
    createDishBodySchema,
    dishAggregateSchema,
    createDishResultSchema,
    'Dish',
  ),
  ...adminCollection(
    'menu-packages',
    'package',
    createMenuPackageBodySchema,
    menuAggregateSchema,
    createMenuResultSchema,
    'MenuPackage',
  ),
  ...adminCollection(
    'timeline-templates',
    'template',
    createTimelineBodySchema,
    timelineAggregateSchema,
    versionRevisionResultSchema,
    'TimelineTemplate',
  ),
  ...adminCollection(
    'layout-templates',
    'template',
    createLayoutBodySchema,
    layoutAggregateSchema,
    versionRevisionResultSchema,
    'LayoutTemplate',
  ),
  ...publicationPath('dish', 'publishDishVersion'),
  ...publicationPath('menu-package', 'publishMenuPackageVersion'),
  ...publicationPath('timeline-template', 'publishTimelineTemplateVersion'),
  ...publicationPath('layout-template', 'publishLayoutTemplateVersion'),
  '/management/catalog/layout-templates/{templateId}/tables': {
    post: {
      ...managerMutation(
        'registerLayoutTable',
        'Register one stable table identity',
        registerTableBodySchema,
        {
          created: true,
          idempotent: true,
          responseSchema: z.strictObject({ tableId: idSchema }),
        },
      ),
      parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }, pathParameter('templateId')],
    },
  },
  '/management/catalog/layout-templates/{templateId}/tables/{tableId}/retirement': {
    post: {
      ...managerMutation(
        'retireLayoutTable',
        'Retire one stable table identity',
        z.strictObject({}),
        { idempotent: true, noContent: true },
      ),
      parameters: [
        { $ref: '#/components/parameters/IdempotencyKey' },
        pathParameter('templateId'),
        pathParameter('tableId'),
      ],
    },
  },
};

export const venueCatalogOpenApiSchemas = {
  CatalogCreateDishBody: createDishBodySchema,
  CatalogCreateHallBody: createHallBodySchema,
  CatalogCreateLayoutBody: createLayoutBodySchema,
  CatalogCreateMenuPackageBody: createMenuPackageBodySchema,
  CatalogCreateTimelineBody: createTimelineBodySchema,
  CatalogDishAggregate: dishAggregateSchema,
  CatalogHallView: hallViewSchema,
  CatalogLayoutAggregate: layoutAggregateSchema,
  CatalogMediaView: mediaViewSchema,
  CatalogMenuAggregate: menuAggregateSchema,
  CatalogPublicDish: publicDishSchema,
  CatalogPublicHall: publicHallSchema,
  CatalogPublicMenuPackage: publicMenuSchema,
  CatalogPublicRestaurant: publicRestaurantSchema,
  CatalogTimelineAggregate: timelineAggregateSchema,
};
