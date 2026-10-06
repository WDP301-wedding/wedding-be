import { randomUUID } from 'node:crypto';

import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import multer from 'multer';

import { AppError, ValidationError } from '../../../core/errors/app-error.js';
import { validateRequest, validatedRequest } from '../../../core/http/validate.js';
import { MAX_STORAGE_OBJECT_BYTES } from '../../../integrations/storage/storage.schemas.js';
import { AuthenticationRequiredError } from '../../identity-access/authorization/authenticated-actor.middleware.js';
import type {
  CatalogMediaService,
  CatalogMediaResourceType,
} from '../application/catalog-media.service.js';
import type { CatalogAdminQueryService } from '../application/catalog-query.service.js';
import type { LayoutService } from '../application/layout.service.js';
import type { MenuService } from '../application/menu.service.js';
import type { TimelineService } from '../application/timeline.service.js';
import type { CatalogManagerAuthorizer } from '../application/venue-catalog.provider.js';
import type { VenueService } from '../application/venue.service.js';
import { CatalogPolicyError } from '../domain/catalog-policy.js';
import type { CatalogMutationContext } from '../infrastructure/catalog-version.repository.js';
import {
  cloneVersionBodySchema,
  createDishBodySchema,
  createHallBodySchema,
  createLayoutBodySchema,
  createMenuPackageBodySchema,
  createTimelineBodySchema,
  cursorQuerySchema,
  dishListQuerySchema,
  dishParamsSchema,
  hallParamsSchema,
  idParamsSchema,
  lifecycleBodySchema,
  mediaOrderBodySchema,
  mediaOrderParamsSchema,
  mediaUploadFieldsSchema,
  packageParamsSchema,
  publishVersionBodySchema,
  registerTableBodySchema,
  shiftParamsSchema,
  tableParamsSchema,
  templateParamsSchema,
  updateDishVersionBodySchema,
  updateHallBodySchema,
  updateLayoutVersionBodySchema,
  updateMenuPackageVersionBodySchema,
  updateRestaurantBodySchema,
  updateShiftBodySchema,
  updateTimelineVersionBodySchema,
  versionParamsSchema,
} from './venue-catalog.schemas.js';

export interface VenueCatalogHttpServices {
  readonly authorizeManager: CatalogManagerAuthorizer['authorize'];
  readonly venue: VenueService;
  readonly menu: MenuService;
  readonly timeline: TimelineService;
  readonly layout: LayoutService;
  readonly media: CatalogMediaService;
  readonly queries: CatalogAdminQueryService;
}

export interface CreateVenueCatalogRouterOptions {
  readonly services: VenueCatalogHttpServices;
  readonly createIdempotencyHandler: (normalizedRoute: string) => RequestHandler;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_STORAGE_OBJECT_BYTES, files: 1, fields: 5, parts: 6 },
});
const catalogUpload: RequestHandler = (request, response, next) => {
  upload.single('file')(request, response, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      next(
        new ValidationError([
          {
            path: error.field ?? 'file',
            code: error.code,
            message: 'The catalog upload is invalid.',
          },
        ]),
      );
      return;
    }
    next(error);
  });
};
const managerContexts = new WeakMap<Request, CatalogMutationContext>();

export function createVenueCatalogRouter(options: CreateVenueCatalogRouterOptions): Router {
  const router = Router();
  const manager = createManagerMiddleware(options.services.authorizeManager);
  const idempotent = options.createIdempotencyHandler;

  router.get(
    '/catalog/restaurant',
    asyncHandler(async (_request, response) => {
      const [profile, shifts] = await Promise.all([
        options.services.venue.getRestaurantProfile(),
        options.services.venue.listActiveShifts(),
      ]);
      const media = await options.services.media.listSigned('RESTAURANT_PROFILE', profile.id);
      response.json({
        data: {
          id: profile.id,
          displayName: profile.displayName,
          description: profile.description,
          address: profile.address,
          publicPhone: profile.publicPhone,
          publicEmail: profile.publicEmail,
          shifts: shifts.map(({ code, startTime, endTime }) => ({ code, startTime, endTime })),
          media,
        },
      });
    }),
  );

  router.get(
    '/catalog/halls',
    validateRequest({ query: cursorQuerySchema }),
    asyncHandler(async (_request, response) => {
      const { query } = validatedRequest(response, { query: cursorQuerySchema });
      const activeHalls = await options.services.venue.listActiveHalls();
      const cursorIndex =
        query.cursor === undefined ? -1 : activeHalls.findIndex(({ id }) => id === query.cursor);
      if (query.cursor !== undefined && cursorIndex < 0) {
        throw new ValidationError([
          { path: 'cursor', code: 'invalid_value', message: 'The catalog cursor is invalid.' },
        ]);
      }
      const halls = activeHalls.slice(cursorIndex + 1, cursorIndex + query.limit + 2);
      const pageItems = halls.slice(0, query.limit);
      response.json({
        data: {
          items: await Promise.all(
            pageItems.map(async ({ id, name, description, maxGuests }) => ({
              id,
              name,
              description,
              maxGuests,
              media: await options.services.media.listSigned('HALL', id),
            })),
          ),
          nextCursor: halls.length > query.limit ? (pageItems.at(-1)?.id ?? null) : null,
        },
      });
    }),
  );

  router.get(
    '/catalog/halls/:hallId',
    validateRequest({ params: hallParamsSchema }),
    asyncHandler(async (_request, response) => {
      const { params } = validatedRequest(response, { params: hallParamsSchema });
      const hall = await options.services.venue.getHall(params.hallId);
      if (hall.lifecycle !== 'ACTIVE')
        throw new AppError({
          status: 404,
          code: 'NOT_FOUND',
          message: 'The requested resource was not found.',
        });
      const media = await options.services.media.listSigned('HALL', hall.id);
      response.json({
        data: {
          id: hall.id,
          name: hall.name,
          description: hall.description,
          maxGuests: hall.maxGuests,
          media,
        },
      });
    }),
  );

  router.get(
    '/catalog/dishes',
    validateRequest({ query: dishListQuerySchema }),
    asyncHandler(async (_request, response) => {
      const { query } = validatedRequest(response, { query: dishListQuerySchema });
      response.json({ data: await options.services.queries.listPublicDishes(query) });
    }),
  );
  router.get(
    '/catalog/menu-packages',
    validateRequest({ query: cursorQuerySchema }),
    asyncHandler(async (_request, response) => {
      const { query } = validatedRequest(response, { query: cursorQuerySchema });
      response.json({ data: await options.services.queries.listPublicMenuPackages(query) });
    }),
  );

  router.patch(
    '/management/catalog/restaurant',
    manager,
    validateRequest({ body: updateRestaurantBodySchema }),
    asyncHandler(async (_request, response) => {
      const { body } = validatedRequest(response, { body: updateRestaurantBodySchema });
      const result = await catalogOperation(() =>
        options.services.venue.updateRestaurantProfile({
          ...body,
          context: managerContext(response),
        }),
      );
      sendRevision(response, result, result.revision);
    }),
  );
  router.patch(
    '/management/catalog/shifts/:shiftCode',
    manager,
    validateRequest({ params: shiftParamsSchema, body: updateShiftBodySchema }),
    asyncHandler(async (_request, response) => {
      const { params, body } = validatedRequest(response, {
        params: shiftParamsSchema,
        body: updateShiftBodySchema,
      });
      const result = await catalogOperation(() =>
        options.services.venue.updateShift({
          code: params.shiftCode,
          ...body,
          context: managerContext(response),
        }),
      );
      sendRevision(response, result, result.revision);
    }),
  );
  router.post(
    '/management/catalog/halls',
    manager,
    idempotent('/management/catalog/halls'),
    validateRequest({ body: createHallBodySchema }),
    asyncHandler(async (_request, response) => {
      const { body } = validatedRequest(response, { body: createHallBodySchema });
      const result = await catalogOperation(() =>
        options.services.venue.createHall({ ...body, context: managerContext(response) }),
      );
      response
        .set('ETag', quoteRevision(result.revision))
        .status(201)
        .json({ data: omitInternalHall(result) });
    }),
  );
  router.patch(
    '/management/catalog/halls/:hallId',
    manager,
    validateRequest({ params: hallParamsSchema, body: updateHallBodySchema }),
    asyncHandler(async (_request, response) => {
      const { params, body } = validatedRequest(response, {
        params: hallParamsSchema,
        body: updateHallBodySchema,
      });
      const result = await catalogOperation(() =>
        options.services.venue.updateHall({
          id: params.hallId,
          ...body,
          context: managerContext(response),
        }),
      );
      sendRevision(response, result, result.revision);
    }),
  );
  registerLifecycle(
    router,
    options,
    manager,
    'halls',
    (id, transition, expectedRevision, context) =>
      options.services.venue.changeHallLifecycle({ id, transition, expectedRevision, context }),
  );

  registerDishRoutes(router, options, manager);
  registerMenuRoutes(router, options, manager);
  registerTimelineRoutes(router, options, manager);
  registerLayoutRoutes(router, options, manager);
  registerMediaRoutes(router, options, manager);

  return router;
}

function registerDishRoutes(
  router: Router,
  options: CreateVenueCatalogRouterOptions,
  manager: RequestHandler,
): void {
  router.get(
    '/management/catalog/dishes',
    manager,
    validateRequest({ query: cursorQuerySchema }),
    asyncHandler(async (_request, response) => {
      const { query } = validatedRequest(response, { query: cursorQuerySchema });
      response.json({ data: await options.services.queries.listDishes(query) });
    }),
  );
  router.get(
    '/management/catalog/dishes/:dishId',
    manager,
    validateRequest({ params: dishParamsSchema }),
    asyncHandler(async (_request, response) => {
      const { params } = validatedRequest(response, { params: dishParamsSchema });
      response.json({ data: await options.services.queries.getDish(params.dishId) });
    }),
  );
  router.post(
    '/management/catalog/dishes',
    manager,
    options.createIdempotencyHandler('/management/catalog/dishes'),
    validateRequest({ body: createDishBodySchema }),
    asyncHandler(async (_request, response) => {
      const { body } = validatedRequest(response, { body: createDishBodySchema });
      const result = await catalogOperation(() =>
        options.services.menu.createDish({ ...body, context: managerContext(response) }),
      );
      response
        .set('ETag', quoteRevision(result.revision))
        .status(201)
        .json({ data: publicResult(result) });
    }),
  );
  router.post(
    '/management/catalog/dishes/:dishId/versions',
    manager,
    options.createIdempotencyHandler('/management/catalog/dishes/{dishId}/versions'),
    validateRequest({ params: dishParamsSchema, body: cloneVersionBodySchema }),
    asyncHandler(async (_request, response) => {
      const { params, body } = validatedRequest(response, {
        params: dishParamsSchema,
        body: cloneVersionBodySchema,
      });
      const result = await catalogOperation(() =>
        options.services.menu.cloneDishVersion({
          dishId: params.dishId,
          ...body,
          context: managerContext(response),
        }),
      );
      response.set('ETag', quoteRevision(result.revision)).status(201).json({ data: result });
    }),
  );
  router.patch(
    '/management/catalog/dish-versions/:versionId',
    manager,
    validateRequest({ params: versionParamsSchema, body: updateDishVersionBodySchema }),
    asyncHandler(async (_request, response) => {
      const { params, body } = validatedRequest(response, {
        params: versionParamsSchema,
        body: updateDishVersionBodySchema,
      });
      const dishId = await options.services.queries.findAggregateIdForVersion(
        'DISH',
        params.versionId,
      );
      const result = await catalogOperation(() =>
        options.services.menu.updateDishDraft({
          dishId,
          versionId: params.versionId,
          ...body,
          context: managerContext(response),
        }),
      );
      sendRevision(response, result, result.revision);
    }),
  );
  router.post(
    '/management/catalog/dish-versions/:versionId/publication',
    manager,
    options.createIdempotencyHandler('/management/catalog/dish-versions/{versionId}/publication'),
    validateRequest({ params: versionParamsSchema, body: publishVersionBodySchema }),
    asyncHandler(async (_request, response) => {
      const { params, body } = validatedRequest(response, {
        params: versionParamsSchema,
        body: publishVersionBodySchema,
      });
      const dishId = await options.services.queries.findAggregateIdForVersion(
        'DISH',
        params.versionId,
      );
      const result = await catalogOperation(() =>
        options.services.menu.publishDish({
          dishId,
          versionId: params.versionId,
          ...body,
          context: managerContext(response),
        }),
      );
      response.status(201).json({ data: result });
    }),
  );
  registerLifecycle(
    router,
    options,
    manager,
    'dishes',
    (aggregateId, transition, expectedRevision, context) =>
      options.services.menu.changeDishLifecycle({
        aggregateId,
        transition,
        expectedRevision,
        context,
      }),
  );
}

function registerMenuRoutes(
  router: Router,
  options: CreateVenueCatalogRouterOptions,
  manager: RequestHandler,
): void {
  router.get(
    '/management/catalog/menu-packages',
    manager,
    validateRequest({ query: cursorQuerySchema }),
    asyncHandler(async (_request, response) => {
      const { query } = validatedRequest(response, { query: cursorQuerySchema });
      response.json({ data: await options.services.queries.listMenuPackages(query) });
    }),
  );
  router.get(
    '/management/catalog/menu-packages/:packageId',
    manager,
    validateRequest({ params: packageParamsSchema }),
    asyncHandler(async (_request, response) => {
      const { params } = validatedRequest(response, { params: packageParamsSchema });
      response.json({ data: await options.services.queries.getMenuPackage(params.packageId) });
    }),
  );
  router.post(
    '/management/catalog/menu-packages',
    manager,
    options.createIdempotencyHandler('/management/catalog/menu-packages'),
    validateRequest({ body: createMenuPackageBodySchema }),
    asyncHandler(async (_request, response) => {
      const { body } = validatedRequest(response, { body: createMenuPackageBodySchema });
      const result = await catalogOperation(() =>
        options.services.menu.createMenuPackage({ ...body, context: managerContext(response) }),
      );
      response
        .set('ETag', quoteRevision(result.revision))
        .status(201)
        .json({ data: publicResult(result) });
    }),
  );
  router.post(
    '/management/catalog/menu-packages/:packageId/versions',
    manager,
    options.createIdempotencyHandler('/management/catalog/menu-packages/{packageId}/versions'),
    validateRequest({ params: packageParamsSchema, body: cloneVersionBodySchema }),
    asyncHandler(async (_request, response) => {
      const { params, body } = validatedRequest(response, {
        params: packageParamsSchema,
        body: cloneVersionBodySchema,
      });
      const result = await catalogOperation(() =>
        options.services.menu.cloneMenuPackageVersion({
          menuPackageId: params.packageId,
          ...body,
          context: managerContext(response),
        }),
      );
      response.set('ETag', quoteRevision(result.revision)).status(201).json({ data: result });
    }),
  );
  router.patch(
    '/management/catalog/menu-package-versions/:versionId',
    manager,
    validateRequest({ params: versionParamsSchema, body: updateMenuPackageVersionBodySchema }),
    asyncHandler(async (_request, response) => {
      const { params, body } = validatedRequest(response, {
        params: versionParamsSchema,
        body: updateMenuPackageVersionBodySchema,
      });
      const menuPackageId = await options.services.queries.findAggregateIdForVersion(
        'MENU_PACKAGE',
        params.versionId,
      );
      const result = await catalogOperation(() =>
        options.services.menu.updateMenuPackageDraft({
          menuPackageId,
          versionId: params.versionId,
          ...body,
          context: managerContext(response),
        }),
      );
      sendRevision(response, result, result.revision);
    }),
  );
  router.post(
    '/management/catalog/menu-package-versions/:versionId/publication',
    manager,
    options.createIdempotencyHandler(
      '/management/catalog/menu-package-versions/{versionId}/publication',
    ),
    validateRequest({ params: versionParamsSchema, body: publishVersionBodySchema }),
    asyncHandler(async (_request, response) => {
      const { params, body } = validatedRequest(response, {
        params: versionParamsSchema,
        body: publishVersionBodySchema,
      });
      const menuPackageId = await options.services.queries.findAggregateIdForVersion(
        'MENU_PACKAGE',
        params.versionId,
      );
      const result = await catalogOperation(() =>
        options.services.menu.publishMenuPackage({
          menuPackageId,
          versionId: params.versionId,
          ...body,
          context: managerContext(response),
        }),
      );
      response.status(201).json({ data: result });
    }),
  );
  registerLifecycle(
    router,
    options,
    manager,
    'menu-packages',
    (aggregateId, transition, expectedRevision, context) =>
      options.services.menu.changeMenuPackageLifecycle({
        aggregateId,
        transition,
        expectedRevision,
        context,
      }),
  );
}

function registerTimelineRoutes(
  router: Router,
  options: CreateVenueCatalogRouterOptions,
  manager: RequestHandler,
): void {
  router.get(
    '/management/catalog/timeline-templates',
    manager,
    validateRequest({ query: cursorQuerySchema }),
    asyncHandler(async (_request, response) => {
      const { query } = validatedRequest(response, { query: cursorQuerySchema });
      response.json({ data: await options.services.queries.listTimelineTemplates(query) });
    }),
  );
  router.get(
    '/management/catalog/timeline-templates/:templateId',
    manager,
    validateRequest({ params: templateParamsSchema }),
    asyncHandler(async (_request, response) => {
      const { params } = validatedRequest(response, { params: templateParamsSchema });
      response.json({
        data: await options.services.queries.getTimelineTemplate(params.templateId),
      });
    }),
  );
  router.post(
    '/management/catalog/timeline-templates',
    manager,
    options.createIdempotencyHandler('/management/catalog/timeline-templates'),
    validateRequest({ body: createTimelineBodySchema }),
    asyncHandler(async (_request, response) => {
      const { body } = validatedRequest(response, { body: createTimelineBodySchema });
      const result = await catalogOperation(() =>
        options.services.timeline.createTemplate({ ...body, context: managerContext(response) }),
      );
      response.set('ETag', quoteRevision(result.revision)).status(201).json({ data: result });
    }),
  );
  router.post(
    '/management/catalog/timeline-templates/:templateId/versions',
    manager,
    options.createIdempotencyHandler(
      '/management/catalog/timeline-templates/{templateId}/versions',
    ),
    validateRequest({ params: templateParamsSchema, body: cloneVersionBodySchema }),
    asyncHandler(async (_request, response) => {
      const { params, body } = validatedRequest(response, {
        params: templateParamsSchema,
        body: cloneVersionBodySchema,
      });
      const result = await catalogOperation(() =>
        options.services.timeline.cloneVersion({
          templateId: params.templateId,
          ...body,
          context: managerContext(response),
        }),
      );
      response.set('ETag', quoteRevision(result.revision)).status(201).json({ data: result });
    }),
  );
  router.patch(
    '/management/catalog/timeline-template-versions/:versionId',
    manager,
    validateRequest({ params: versionParamsSchema, body: updateTimelineVersionBodySchema }),
    asyncHandler(async (_request, response) => {
      const { params, body } = validatedRequest(response, {
        params: versionParamsSchema,
        body: updateTimelineVersionBodySchema,
      });
      const templateId = await options.services.queries.findAggregateIdForVersion(
        'TIMELINE_TEMPLATE',
        params.versionId,
      );
      const result = await catalogOperation(() =>
        options.services.timeline.updateDraft({
          templateId,
          versionId: params.versionId,
          ...body,
          context: managerContext(response),
        }),
      );
      sendRevision(response, result, result.revision);
    }),
  );
  router.post(
    '/management/catalog/timeline-template-versions/:versionId/publication',
    manager,
    options.createIdempotencyHandler(
      '/management/catalog/timeline-template-versions/{versionId}/publication',
    ),
    validateRequest({ params: versionParamsSchema, body: publishVersionBodySchema }),
    asyncHandler(async (_request, response) => {
      const { params, body } = validatedRequest(response, {
        params: versionParamsSchema,
        body: publishVersionBodySchema,
      });
      const templateId = await options.services.queries.findAggregateIdForVersion(
        'TIMELINE_TEMPLATE',
        params.versionId,
      );
      const result = await catalogOperation(() =>
        options.services.timeline.publish({
          templateId,
          versionId: params.versionId,
          ...body,
          context: managerContext(response),
        }),
      );
      response.status(201).json({ data: result });
    }),
  );
  registerLifecycle(
    router,
    options,
    manager,
    'timeline-templates',
    (aggregateId, transition, expectedRevision, context) =>
      options.services.timeline.changeLifecycle({
        aggregateId,
        transition,
        expectedRevision,
        context,
      }),
  );
}

function registerLayoutRoutes(
  router: Router,
  options: CreateVenueCatalogRouterOptions,
  manager: RequestHandler,
): void {
  router.get(
    '/management/catalog/layout-templates',
    manager,
    validateRequest({ query: cursorQuerySchema }),
    asyncHandler(async (_request, response) => {
      const { query } = validatedRequest(response, { query: cursorQuerySchema });
      response.json({ data: await options.services.queries.listLayoutTemplates(query) });
    }),
  );
  router.get(
    '/management/catalog/layout-templates/:templateId',
    manager,
    validateRequest({ params: templateParamsSchema }),
    asyncHandler(async (_request, response) => {
      const { params } = validatedRequest(response, { params: templateParamsSchema });
      response.json({ data: await options.services.queries.getLayoutTemplate(params.templateId) });
    }),
  );
  router.post(
    '/management/catalog/layout-templates',
    manager,
    options.createIdempotencyHandler('/management/catalog/layout-templates'),
    validateRequest({ body: createLayoutBodySchema }),
    asyncHandler(async (_request, response) => {
      const { body } = validatedRequest(response, { body: createLayoutBodySchema });
      const result = await catalogOperation(() =>
        options.services.layout.createTemplate({ ...body, context: managerContext(response) }),
      );
      response.set('ETag', quoteRevision(result.revision)).status(201).json({ data: result });
    }),
  );
  router.post(
    '/management/catalog/layout-templates/:templateId/versions',
    manager,
    options.createIdempotencyHandler('/management/catalog/layout-templates/{templateId}/versions'),
    validateRequest({ params: templateParamsSchema, body: cloneVersionBodySchema }),
    asyncHandler(async (_request, response) => {
      const { params, body } = validatedRequest(response, {
        params: templateParamsSchema,
        body: cloneVersionBodySchema,
      });
      const result = await catalogOperation(() =>
        options.services.layout.cloneVersion({
          templateId: params.templateId,
          ...body,
          context: managerContext(response),
        }),
      );
      response.set('ETag', quoteRevision(result.revision)).status(201).json({ data: result });
    }),
  );
  router.patch(
    '/management/catalog/layout-template-versions/:versionId',
    manager,
    validateRequest({ params: versionParamsSchema, body: updateLayoutVersionBodySchema }),
    asyncHandler(async (_request, response) => {
      const { params, body } = validatedRequest(response, {
        params: versionParamsSchema,
        body: updateLayoutVersionBodySchema,
      });
      const templateId = await options.services.queries.findAggregateIdForVersion(
        'LAYOUT_TEMPLATE',
        params.versionId,
      );
      const result = await catalogOperation(() =>
        options.services.layout.updateDraft({
          templateId,
          versionId: params.versionId,
          ...body,
          context: managerContext(response),
        }),
      );
      sendRevision(response, result, result.revision);
    }),
  );
  router.post(
    '/management/catalog/layout-template-versions/:versionId/publication',
    manager,
    options.createIdempotencyHandler(
      '/management/catalog/layout-template-versions/{versionId}/publication',
    ),
    validateRequest({ params: versionParamsSchema, body: publishVersionBodySchema }),
    asyncHandler(async (_request, response) => {
      const { params, body } = validatedRequest(response, {
        params: versionParamsSchema,
        body: publishVersionBodySchema,
      });
      const templateId = await options.services.queries.findAggregateIdForVersion(
        'LAYOUT_TEMPLATE',
        params.versionId,
      );
      const result = await catalogOperation(() =>
        options.services.layout.publish({
          templateId,
          versionId: params.versionId,
          ...body,
          context: managerContext(response),
        }),
      );
      response.status(201).json({ data: result });
    }),
  );
  router.post(
    '/management/catalog/layout-templates/:templateId/tables',
    manager,
    options.createIdempotencyHandler('/management/catalog/layout-templates/{templateId}/tables'),
    validateRequest({ params: templateParamsSchema, body: registerTableBodySchema }),
    asyncHandler(async (_request, response) => {
      const { params, body } = validatedRequest(response, {
        params: templateParamsSchema,
        body: registerTableBodySchema,
      });
      await catalogOperation(() =>
        options.services.layout.registerTable({
          templateId: params.templateId,
          tableId: body.tableId,
          context: managerContext(response),
        }),
      );
      response.status(201).json({ data: { tableId: body.tableId } });
    }),
  );
  router.post(
    '/management/catalog/layout-templates/:templateId/tables/:tableId/retirement',
    manager,
    options.createIdempotencyHandler(
      '/management/catalog/layout-templates/{templateId}/tables/{tableId}/retirement',
    ),
    validateRequest({ params: tableParamsSchema, body: zodEmptyBody }),
    asyncHandler(async (_request, response) => {
      const { params } = validatedRequest(response, {
        params: tableParamsSchema,
        body: zodEmptyBody,
      });
      await catalogOperation(() =>
        options.services.layout.retireTable({
          templateId: params.templateId,
          tableId: params.tableId,
          context: managerContext(response),
        }),
      );
      response.sendStatus(204);
    }),
  );
  registerLifecycle(
    router,
    options,
    manager,
    'layout-templates',
    (aggregateId, transition, expectedRevision, context) =>
      options.services.layout.changeLifecycle({
        aggregateId,
        transition,
        expectedRevision,
        context,
      }),
  );
}

const zodEmptyBody = lifecycleBodySchema.pick({}).strict();

function registerMediaRoutes(
  router: Router,
  options: CreateVenueCatalogRouterOptions,
  manager: RequestHandler,
): void {
  router.post(
    '/management/catalog/media-assets',
    manager,
    catalogUpload,
    options.createIdempotencyHandler('/management/catalog/media-assets'),
    asyncHandler(async (request, response) => {
      const fields = mediaUploadFieldsSchema.safeParse(request.body);
      if (!fields.success || request.file === undefined) {
        throw new ValidationError(
          fields.success
            ? [{ path: 'file', code: 'required', message: 'One catalog image file is required.' }]
            : fields.error.issues.map((issue) => ({
                path: issue.path.map(String).join('.'),
                code: issue.code,
                message: issue.message,
              })),
        );
      }
      const command = {
        ...fields.data,
        bytes: request.file.buffer,
        contentType: request.file.mimetype as 'image/jpeg' | 'image/png' | 'image/webp',
        context: managerContext(response),
      };
      const result = await catalogOperation(() =>
        fields.data.oldAssetId === undefined
          ? options.services.media.upload(command)
          : options.services.media.replace({ ...command, oldAssetId: fields.data.oldAssetId }),
      );
      response.status(201).json({ data: result });
    }),
  );
  router.patch(
    '/management/catalog/:resource/:resourceId/media-order',
    manager,
    validateRequest({ params: mediaOrderParamsSchema, body: mediaOrderBodySchema }),
    asyncHandler(async (_request, response) => {
      const { params, body } = validatedRequest(response, {
        params: mediaOrderParamsSchema,
        body: mediaOrderBodySchema,
      });
      await catalogOperation(() =>
        options.services.media.reorder({
          resourceType: resourceTypeForPath(params.resource),
          resourceId: params.resourceId,
          assetIds: body.assetIds,
          expectedRevision: body.expectedRevision,
          context: managerContext(response),
        }),
      );
      response.sendStatus(204);
    }),
  );
}

function registerLifecycle(
  router: Router,
  options: CreateVenueCatalogRouterOptions,
  manager: RequestHandler,
  resource: string,
  change: (
    id: string,
    transition: 'RETIRE' | 'RESTORE',
    expectedRevision: number,
    context: CatalogMutationContext,
  ) => Promise<unknown>,
): void {
  for (const [suffix, transition] of [
    ['retirement', 'RETIRE'],
    ['restoration', 'RESTORE'],
  ] as const) {
    const path = `/management/catalog/${resource}/:id/${suffix}`;
    router.post(
      path,
      manager,
      options.createIdempotencyHandler(`/management/catalog/${resource}/{id}/${suffix}`),
      validateRequest({ params: idParamsSchema, body: lifecycleBodySchema }),
      asyncHandler(async (_request, response) => {
        const { params, body } = validatedRequest(response, {
          params: idParamsSchema,
          body: lifecycleBodySchema,
        });
        const result = await catalogOperation(() =>
          change(params.id, transition, body.expectedRevision, managerContext(response)),
        );
        response.json({ data: result });
      }),
    );
  }
}

function createManagerMiddleware(authorize: CatalogManagerAuthorizer['authorize']): RequestHandler {
  return (request, response, next) => {
    const match = /^Bearer ([^\s]+)$/u.exec(request.get('authorization') ?? '');
    if (match?.[1] === undefined) return next(new AuthenticationRequiredError());
    void authorize(match[1], request.requestId).then((context) => {
      managerContexts.set(request, context);
      response.locals.catalogMutationContext = context;
      next();
    }, next);
  };
}

export function catalogActorScope(request: Request): string {
  const context = managerContexts.get(request);
  if (context === undefined) throw new AuthenticationRequiredError();
  return context.actorId;
}

function managerContext(response: Response): CatalogMutationContext {
  return response.locals.catalogMutationContext as CatalogMutationContext;
}

function sendRevision(response: Response, data: unknown, revision: number): void {
  response.set('ETag', quoteRevision(revision)).json({ data });
}

function quoteRevision(revision: number): string {
  return `"${String(revision)}"`;
}

function omitInternalHall<T extends { readonly nameNormalized?: string }>(
  value: T,
): Omit<T, 'nameNormalized'> {
  const { nameNormalized: _nameNormalized, ...safe } = value;
  void _nameNormalized;
  return safe;
}

function publicResult<T extends { readonly context?: unknown }>(value: T): Omit<T, 'context'> {
  const { context: _context, ...safe } = value;
  void _context;
  return safe;
}

function resourceTypeForPath(resource: string): CatalogMediaResourceType {
  const values: Record<string, CatalogMediaResourceType> = {
    'restaurant-profile': 'RESTAURANT_PROFILE',
    halls: 'HALL',
    'dish-versions': 'DISH_VERSION',
    'menu-package-versions': 'MENU_PACKAGE_VERSION',
    'timeline-template-versions': 'TIMELINE_TEMPLATE_VERSION',
    'layout-template-versions': 'LAYOUT_TEMPLATE_VERSION',
  };
  const value = values[resource];
  if (value === undefined) throw new ValidationError();
  return value;
}

async function catalogOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    if (error instanceof CatalogPolicyError) {
      throw new AppError({ status: 422, code: error.code, message: error.message });
    }
    throw error;
  }
}

type AsyncRoute = (request: Request, response: Response, next: NextFunction) => Promise<unknown>;
function asyncHandler(handler: AsyncRoute): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

export function createCatalogId(): string {
  return randomUUID();
}
