import { z } from 'zod';

import { strictWriteSchema } from '../../../core/http/validate.js';
import { CATALOG_LIMITS } from '../domain/catalog-policy.js';

const trimmedText = (minimum: number, maximum: number) =>
  z.string().trim().min(minimum).max(maximum);

export const catalogIdSchema = z.uuid();
export const revisionSchema = z.int().min(1);
export const displayOrderSchema = z.int().min(0);
export const itemDisplayOrderSchema = z.int().min(1);
export const catalogNameSchema = trimmedText(CATALOG_LIMITS.name.min, CATALOG_LIMITS.name.max);
export const catalogDescriptionSchema = trimmedText(
  CATALOG_LIMITS.description.min,
  CATALOG_LIMITS.description.max,
);
export const catalogLifecycleSchema = z.enum(['ACTIVE', 'RETIRED']);
export const catalogVersionStateSchema = z.enum(['DRAFT', 'PUBLISHED', 'SUPERSEDED']);
export const shiftCodeSchema = z.enum(['LUNCH', 'DINNER']);
export const localTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);
export const integerVndSchema = z.int().min(0).max(CATALOG_LIMITS.dishPriceVnd.max);

export const cursorQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(CATALOG_LIMITS.cursorPageSize.max).default(20),
  cursor: catalogIdSchema.optional(),
});

export const dishListQuerySchema = cursorQuerySchema.extend({
  categoryLabel: trimmedText(1, 120).optional(),
  search: trimmedText(1, 120).optional(),
});

export const idParamsSchema = z.strictObject({ id: catalogIdSchema });
export const hallParamsSchema = z.strictObject({ hallId: catalogIdSchema });
export const shiftParamsSchema = z.strictObject({ shiftCode: shiftCodeSchema });
export const dishParamsSchema = z.strictObject({ dishId: catalogIdSchema });
export const packageParamsSchema = z.strictObject({ packageId: catalogIdSchema });
export const templateParamsSchema = z.strictObject({ templateId: catalogIdSchema });
export const versionParamsSchema = z.strictObject({ versionId: catalogIdSchema });
export const tableParamsSchema = z.strictObject({
  templateId: catalogIdSchema,
  tableId: catalogIdSchema,
});
export const mediaOrderParamsSchema = z.strictObject({
  resource: z.enum([
    'restaurant-profile',
    'halls',
    'dish-versions',
    'menu-package-versions',
    'timeline-template-versions',
    'layout-template-versions',
  ]),
  resourceId: catalogIdSchema,
});

export const updateRestaurantBodySchema = strictWriteSchema({
  displayName: catalogNameSchema,
  description: catalogDescriptionSchema,
  address: trimmedText(1, 2_000),
  publicPhone: trimmedText(1, 250).nullable(),
  publicEmail: z.email().max(320).nullable(),
  expectedRevision: revisionSchema,
});

export const updateShiftBodySchema = strictWriteSchema({
  startTime: localTimeSchema,
  endTime: localTimeSchema,
  isActive: z.boolean(),
  expectedRevision: revisionSchema,
});

export const createHallBodySchema = strictWriteSchema({
  id: catalogIdSchema,
  name: catalogNameSchema,
  description: catalogDescriptionSchema,
  maxGuests: z.int().min(1).max(CATALOG_LIMITS.hallMaximumGuests.max),
  displayOrder: displayOrderSchema,
});

export const updateHallBodySchema = createHallBodySchema.omit({ id: true }).extend({
  expectedRevision: revisionSchema,
});

export const lifecycleBodySchema = strictWriteSchema({ expectedRevision: revisionSchema });

const dishContentShape = {
  name: catalogNameSchema,
  description: catalogDescriptionSchema,
  categoryLabel: trimmedText(1, 120),
  priceVnd: integerVndSchema.nullable(),
} as const;

export const createDishBodySchema = strictWriteSchema({
  dishId: catalogIdSchema,
  versionId: catalogIdSchema,
  displayOrder: displayOrderSchema,
  ...dishContentShape,
});
export const cloneVersionBodySchema = strictWriteSchema({
  sourceVersionId: catalogIdSchema,
  versionId: catalogIdSchema,
});
export const updateDishVersionBodySchema = strictWriteSchema({
  ...dishContentShape,
  expectedRevision: revisionSchema,
});
export const publishVersionBodySchema = strictWriteSchema({ expectedRevision: revisionSchema });

export const menuItemSchema = z.strictObject({
  dishVersionId: catalogIdSchema,
  displayOrder: itemDisplayOrderSchema,
});
const menuContentShape = {
  name: catalogNameSchema,
  description: catalogDescriptionSchema,
  priceVndPerTable: z.int().min(1).max(CATALOG_LIMITS.menuPriceVndPerTable.max),
  items: z.array(menuItemSchema).min(1).max(500),
} as const;
export const createMenuPackageBodySchema = strictWriteSchema({
  menuPackageId: catalogIdSchema,
  versionId: catalogIdSchema,
  displayOrder: displayOrderSchema,
  ...menuContentShape,
});
export const updateMenuPackageVersionBodySchema = strictWriteSchema({
  ...menuContentShape,
  expectedRevision: revisionSchema,
});

export const timelineItemSchema = z.strictObject({
  id: catalogIdSchema,
  title: catalogNameSchema,
  description: catalogDescriptionSchema.nullable(),
  offsetMinutes: z.int().min(0).max(CATALOG_LIMITS.timelineOffsetMinutes.max),
  durationMinutes: z
    .int()
    .min(CATALOG_LIMITS.timelineDurationMinutes.min)
    .max(CATALOG_LIMITS.timelineDurationMinutes.max)
    .nullable(),
  displayOrder: itemDisplayOrderSchema,
});
const timelineContentShape = {
  name: catalogNameSchema,
  description: catalogDescriptionSchema,
  items: z
    .array(timelineItemSchema)
    .min(CATALOG_LIMITS.timelineItemCount.min)
    .max(CATALOG_LIMITS.timelineItemCount.max),
} as const;
export const createTimelineBodySchema = strictWriteSchema({
  templateId: catalogIdSchema,
  versionId: catalogIdSchema,
  displayOrder: displayOrderSchema,
  ...timelineContentShape,
});
export const updateTimelineVersionBodySchema = strictWriteSchema({
  ...timelineContentShape,
  expectedRevision: revisionSchema,
});

export const layoutTableSchema = z.strictObject({
  tableId: catalogIdSchema,
  label: trimmedText(CATALOG_LIMITS.tableLabel.min, CATALOG_LIMITS.tableLabel.max),
  shape: z.enum(['ROUND', 'RECTANGLE']),
  seatCapacity: z.int().min(1).max(CATALOG_LIMITS.tableSeatCapacity.max),
  x: z.int().min(0).max(CATALOG_LIMITS.canvas.width),
  y: z.int().min(0).max(CATALOG_LIMITS.canvas.height),
  width: z.int().min(1).max(CATALOG_LIMITS.canvas.width),
  height: z.int().min(1).max(CATALOG_LIMITS.canvas.height),
  rotationDegrees: z.int().min(0).max(359),
  displayOrder: itemDisplayOrderSchema,
});
const layoutContentShape = {
  name: catalogNameSchema,
  description: catalogDescriptionSchema,
  minGuests: z.int().min(1).max(CATALOG_LIMITS.hallMaximumGuests.max),
  maxGuests: z.int().min(1).max(CATALOG_LIMITS.hallMaximumGuests.max),
  tables: z
    .array(layoutTableSchema)
    .min(CATALOG_LIMITS.layoutTableCount.min)
    .max(CATALOG_LIMITS.layoutTableCount.max),
} as const;
export const createLayoutBodySchema = strictWriteSchema({
  templateId: catalogIdSchema,
  versionId: catalogIdSchema,
  hallId: catalogIdSchema,
  displayOrder: displayOrderSchema,
  ...layoutContentShape,
});
export const updateLayoutVersionBodySchema = strictWriteSchema({
  ...layoutContentShape,
  expectedRevision: revisionSchema,
});
export const registerTableBodySchema = strictWriteSchema({ tableId: catalogIdSchema });

export const mediaUploadFieldsSchema = strictWriteSchema({
  assetId: catalogIdSchema,
  resourceType: z.enum([
    'RESTAURANT_PROFILE',
    'HALL',
    'DISH_VERSION',
    'MENU_PACKAGE_VERSION',
    'TIMELINE_TEMPLATE_VERSION',
    'LAYOUT_TEMPLATE_VERSION',
  ]),
  resourceId: catalogIdSchema,
  alternativeText: trimmedText(
    CATALOG_LIMITS.mediaAlternativeText.min,
    CATALOG_LIMITS.mediaAlternativeText.max,
  ),
  oldAssetId: catalogIdSchema.optional(),
});
export const mediaOrderBodySchema = strictWriteSchema({
  assetIds: z.array(catalogIdSchema).max(CATALOG_LIMITS.mediaPerResource.max),
  expectedRevision: revisionSchema,
});

export const publicHallSchema = z.strictObject({
  id: catalogIdSchema,
  name: catalogNameSchema,
  description: catalogDescriptionSchema,
  maxGuests: z.int(),
  media: z.array(z.unknown()).optional(),
});

export const catalogPageSchema = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    data: z.strictObject({ items: z.array(item), nextCursor: catalogIdSchema.nullable() }),
  });
