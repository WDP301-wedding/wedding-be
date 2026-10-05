BEGIN;

CREATE TYPE "CatalogLifecycle" AS ENUM ('ACTIVE', 'RETIRED');
CREATE TYPE "CatalogVersionState" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED');
CREATE TYPE "RestaurantShiftCode" AS ENUM ('LUNCH', 'DINNER');
CREATE TYPE "LayoutTableShape" AS ENUM ('ROUND', 'RECTANGLE');
CREATE TYPE "CatalogMediaResourceType" AS ENUM (
  'RESTAURANT_PROFILE',
  'HALL',
  'DISH_VERSION',
  'MENU_PACKAGE_VERSION',
  'TIMELINE_TEMPLATE_VERSION',
  'LAYOUT_TEMPLATE_VERSION'
);

CREATE TABLE "RestaurantProfile" (
  "id" UUID NOT NULL,
  "singletonKey" TEXT NOT NULL DEFAULT 'RESTAURANT',
  "displayName" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "publicPhone" TEXT,
  "publicEmail" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updatedByAccountId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "RestaurantProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RestaurantProfile_singleton_check" CHECK ("singletonKey" = 'RESTAURANT'),
  CONSTRAINT "RestaurantProfile_text_check" CHECK (
    char_length(btrim("displayName")) BETWEEN 1 AND 120
    AND char_length(btrim("description")) BETWEEN 0 AND 2000
    AND char_length(btrim("address")) BETWEEN 1 AND 2000
  ),
  CONSTRAINT "RestaurantProfile_revision_check" CHECK ("revision" > 0)
);

CREATE TABLE "RestaurantShift" (
  "code" "RestaurantShiftCode" NOT NULL,
  "startTime" TIME(0) NOT NULL,
  "endTime" TIME(0) NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updatedByAccountId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "RestaurantShift_pkey" PRIMARY KEY ("code"),
  CONSTRAINT "RestaurantShift_window_check" CHECK ("startTime" < "endTime"),
  CONSTRAINT "RestaurantShift_revision_check" CHECK ("revision" > 0)
);

CREATE TABLE "Hall" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "nameNormalized" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "maxGuests" INTEGER NOT NULL,
  "displayOrder" INTEGER NOT NULL,
  "lifecycle" "CatalogLifecycle" NOT NULL DEFAULT 'ACTIVE',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "retiredAt" TIMESTAMPTZ(6),
  "updatedByAccountId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "Hall_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Hall_name_check" CHECK (
    char_length(btrim("name")) BETWEEN 1 AND 120
    AND "nameNormalized" = lower(btrim("name"))
  ),
  CONSTRAINT "Hall_description_check" CHECK (char_length(btrim("description")) BETWEEN 0 AND 2000),
  CONSTRAINT "Hall_capacity_check" CHECK ("maxGuests" BETWEEN 1 AND 10000),
  CONSTRAINT "Hall_order_revision_check" CHECK ("displayOrder" >= 0 AND "revision" > 0),
  CONSTRAINT "Hall_lifecycle_check" CHECK (("lifecycle" = 'RETIRED') = ("retiredAt" IS NOT NULL))
);

CREATE TABLE "Dish" (
  "id" UUID NOT NULL,
  "lifecycle" "CatalogLifecycle" NOT NULL DEFAULT 'ACTIVE',
  "displayOrder" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "currentPublishedVersionId" UUID,
  "draftVersionId" UUID,
  "retiredAt" TIMESTAMPTZ(6),
  "createdByAccountId" UUID NOT NULL,
  "updatedByAccountId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "Dish_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Dish_order_revision_check" CHECK ("displayOrder" >= 0 AND "revision" > 0),
  CONSTRAINT "Dish_lifecycle_check" CHECK (("lifecycle" = 'RETIRED') = ("retiredAt" IS NOT NULL)),
  CONSTRAINT "Dish_distinct_version_pointers_check" CHECK (
    "currentPublishedVersionId" IS NULL OR "draftVersionId" IS NULL OR "currentPublishedVersionId" <> "draftVersionId"
  )
);

CREATE TABLE "DishVersion" (
  "id" UUID NOT NULL,
  "dishId" UUID NOT NULL,
  "versionNumber" INTEGER,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "state" "CatalogVersionState" NOT NULL DEFAULT 'DRAFT',
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "categoryLabel" TEXT NOT NULL,
  "priceVnd" DECIMAL(18,0),
  "createdByAccountId" UUID NOT NULL,
  "publishedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "DishVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DishVersion_text_check" CHECK (
    char_length(btrim("name")) BETWEEN 1 AND 120
    AND char_length(btrim("description")) BETWEEN 0 AND 2000
    AND char_length(btrim("categoryLabel")) BETWEEN 1 AND 120
  ),
  CONSTRAINT "DishVersion_price_check" CHECK ("priceVnd" IS NULL OR "priceVnd" BETWEEN 0 AND 1000000000),
  CONSTRAINT "DishVersion_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "DishVersion_state_check" CHECK (
    ("state" = 'DRAFT' AND "versionNumber" IS NULL AND "publishedAt" IS NULL)
    OR ("state" IN ('PUBLISHED', 'SUPERSEDED') AND "versionNumber" > 0 AND "publishedAt" IS NOT NULL)
  )
);

CREATE TABLE "MenuPackage" (
  "id" UUID NOT NULL,
  "lifecycle" "CatalogLifecycle" NOT NULL DEFAULT 'ACTIVE',
  "displayOrder" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "currentPublishedVersionId" UUID,
  "draftVersionId" UUID,
  "retiredAt" TIMESTAMPTZ(6),
  "createdByAccountId" UUID NOT NULL,
  "updatedByAccountId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "MenuPackage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MenuPackage_order_revision_check" CHECK ("displayOrder" >= 0 AND "revision" > 0),
  CONSTRAINT "MenuPackage_lifecycle_check" CHECK (("lifecycle" = 'RETIRED') = ("retiredAt" IS NOT NULL)),
  CONSTRAINT "MenuPackage_distinct_version_pointers_check" CHECK (
    "currentPublishedVersionId" IS NULL OR "draftVersionId" IS NULL OR "currentPublishedVersionId" <> "draftVersionId"
  )
);

CREATE TABLE "MenuPackageVersion" (
  "id" UUID NOT NULL,
  "menuPackageId" UUID NOT NULL,
  "versionNumber" INTEGER,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "state" "CatalogVersionState" NOT NULL DEFAULT 'DRAFT',
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "priceVndPerTable" DECIMAL(18,0) NOT NULL,
  "createdByAccountId" UUID NOT NULL,
  "publishedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "MenuPackageVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MenuPackageVersion_text_check" CHECK (
    char_length(btrim("name")) BETWEEN 1 AND 120
    AND char_length(btrim("description")) BETWEEN 0 AND 2000
  ),
  CONSTRAINT "MenuPackageVersion_price_check" CHECK ("priceVndPerTable" BETWEEN 1 AND 1000000000),
  CONSTRAINT "MenuPackageVersion_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "MenuPackageVersion_state_check" CHECK (
    ("state" = 'DRAFT' AND "versionNumber" IS NULL AND "publishedAt" IS NULL)
    OR ("state" IN ('PUBLISHED', 'SUPERSEDED') AND "versionNumber" > 0 AND "publishedAt" IS NOT NULL)
  )
);

CREATE TABLE "MenuPackageItem" (
  "id" UUID NOT NULL,
  "menuPackageVersionId" UUID NOT NULL,
  "dishVersionId" UUID NOT NULL,
  "displayOrder" INTEGER NOT NULL,
  CONSTRAINT "MenuPackageItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MenuPackageItem_order_check" CHECK ("displayOrder" > 0)
);

CREATE TABLE "TimelineTemplate" (
  "id" UUID NOT NULL,
  "lifecycle" "CatalogLifecycle" NOT NULL DEFAULT 'ACTIVE',
  "displayOrder" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "currentPublishedVersionId" UUID,
  "draftVersionId" UUID,
  "retiredAt" TIMESTAMPTZ(6),
  "createdByAccountId" UUID NOT NULL,
  "updatedByAccountId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "TimelineTemplate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TimelineTemplate_order_revision_check" CHECK ("displayOrder" >= 0 AND "revision" > 0),
  CONSTRAINT "TimelineTemplate_lifecycle_check" CHECK (("lifecycle" = 'RETIRED') = ("retiredAt" IS NOT NULL)),
  CONSTRAINT "TimelineTemplate_distinct_version_pointers_check" CHECK (
    "currentPublishedVersionId" IS NULL OR "draftVersionId" IS NULL OR "currentPublishedVersionId" <> "draftVersionId"
  )
);

CREATE TABLE "TimelineTemplateVersion" (
  "id" UUID NOT NULL,
  "timelineTemplateId" UUID NOT NULL,
  "versionNumber" INTEGER,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "state" "CatalogVersionState" NOT NULL DEFAULT 'DRAFT',
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "createdByAccountId" UUID NOT NULL,
  "publishedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "TimelineTemplateVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TimelineTemplateVersion_text_check" CHECK (
    char_length(btrim("name")) BETWEEN 1 AND 120
    AND char_length(btrim("description")) BETWEEN 0 AND 2000
  ),
  CONSTRAINT "TimelineTemplateVersion_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "TimelineTemplateVersion_state_check" CHECK (
    ("state" = 'DRAFT' AND "versionNumber" IS NULL AND "publishedAt" IS NULL)
    OR ("state" IN ('PUBLISHED', 'SUPERSEDED') AND "versionNumber" > 0 AND "publishedAt" IS NOT NULL)
  )
);

CREATE TABLE "TimelineTemplateItem" (
  "id" UUID NOT NULL,
  "timelineTemplateVersionId" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "offsetMinutes" INTEGER NOT NULL,
  "durationMinutes" INTEGER,
  "displayOrder" INTEGER NOT NULL,
  CONSTRAINT "TimelineTemplateItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TimelineTemplateItem_text_check" CHECK (
    char_length(btrim("title")) BETWEEN 1 AND 120
    AND ("description" IS NULL OR char_length(btrim("description")) BETWEEN 0 AND 2000)
  ),
  CONSTRAINT "TimelineTemplateItem_time_check" CHECK (
    "offsetMinutes" BETWEEN 0 AND 1440
    AND ("durationMinutes" IS NULL OR "durationMinutes" BETWEEN 1 AND 1440)
  ),
  CONSTRAINT "TimelineTemplateItem_order_check" CHECK ("displayOrder" > 0)
);

CREATE TABLE "LayoutTemplate" (
  "id" UUID NOT NULL,
  "hallId" UUID NOT NULL,
  "lifecycle" "CatalogLifecycle" NOT NULL DEFAULT 'ACTIVE',
  "displayOrder" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "currentPublishedVersionId" UUID,
  "draftVersionId" UUID,
  "retiredAt" TIMESTAMPTZ(6),
  "createdByAccountId" UUID NOT NULL,
  "updatedByAccountId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "LayoutTemplate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LayoutTemplate_order_revision_check" CHECK ("displayOrder" >= 0 AND "revision" > 0),
  CONSTRAINT "LayoutTemplate_lifecycle_check" CHECK (("lifecycle" = 'RETIRED') = ("retiredAt" IS NOT NULL)),
  CONSTRAINT "LayoutTemplate_distinct_version_pointers_check" CHECK (
    "currentPublishedVersionId" IS NULL OR "draftVersionId" IS NULL OR "currentPublishedVersionId" <> "draftVersionId"
  )
);

CREATE TABLE "LayoutTemplateVersion" (
  "id" UUID NOT NULL,
  "layoutTemplateId" UUID NOT NULL,
  "versionNumber" INTEGER,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "state" "CatalogVersionState" NOT NULL DEFAULT 'DRAFT',
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "minGuests" INTEGER NOT NULL,
  "maxGuests" INTEGER NOT NULL,
  "createdByAccountId" UUID NOT NULL,
  "publishedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "LayoutTemplateVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LayoutTemplateVersion_text_check" CHECK (
    char_length(btrim("name")) BETWEEN 1 AND 120
    AND char_length(btrim("description")) BETWEEN 0 AND 2000
  ),
  CONSTRAINT "LayoutTemplateVersion_range_check" CHECK ("minGuests" > 0 AND "minGuests" <= "maxGuests" AND "maxGuests" <= 10000),
  CONSTRAINT "LayoutTemplateVersion_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "LayoutTemplateVersion_state_check" CHECK (
    ("state" = 'DRAFT' AND "versionNumber" IS NULL AND "publishedAt" IS NULL)
    OR ("state" IN ('PUBLISHED', 'SUPERSEDED') AND "versionNumber" > 0 AND "publishedAt" IS NOT NULL)
  )
);

CREATE TABLE "LayoutTableIdentity" (
  "id" UUID NOT NULL,
  "layoutTemplateId" UUID NOT NULL,
  "createdByAccountId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "retiredAt" TIMESTAMPTZ(6),
  CONSTRAINT "LayoutTableIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LayoutTableGeometry" (
  "id" UUID NOT NULL,
  "layoutTemplateVersionId" UUID NOT NULL,
  "layoutTemplateId" UUID NOT NULL,
  "tableId" UUID NOT NULL,
  "label" TEXT NOT NULL,
  "shape" "LayoutTableShape" NOT NULL,
  "seatCapacity" INTEGER NOT NULL,
  "x" INTEGER NOT NULL,
  "y" INTEGER NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "rotationDegrees" INTEGER NOT NULL,
  "displayOrder" INTEGER NOT NULL,
  CONSTRAINT "LayoutTableGeometry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LayoutTableGeometry_label_check" CHECK (char_length(btrim("label")) BETWEEN 1 AND 50),
  CONSTRAINT "LayoutTableGeometry_capacity_check" CHECK ("seatCapacity" BETWEEN 1 AND 100),
  CONSTRAINT "LayoutTableGeometry_canvas_check" CHECK (
    "x" BETWEEN 0 AND 10000
    AND "y" BETWEEN 0 AND 10000
    AND "width" BETWEEN 1 AND 10000
    AND "height" BETWEEN 1 AND 10000
    AND "x" + "width" <= 10000
    AND "y" + "height" <= 10000
    AND "rotationDegrees" BETWEEN 0 AND 359
  ),
  CONSTRAINT "LayoutTableGeometry_order_check" CHECK ("displayOrder" > 0)
);

CREATE TABLE "CatalogMediaAsset" (
  "id" UUID NOT NULL,
  "resourceType" "CatalogMediaResourceType" NOT NULL,
  "resourceId" UUID NOT NULL,
  "objectKey" TEXT NOT NULL,
  "checksumSha256" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "alternativeText" TEXT NOT NULL,
  "displayOrder" INTEGER NOT NULL,
  "createdByAccountId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "detachedAt" TIMESTAMPTZ(6),
  CONSTRAINT "CatalogMediaAsset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CatalogMediaAsset_content_check" CHECK (
    "contentType" IN ('image/jpeg', 'image/png', 'image/webp')
    AND "sizeBytes" BETWEEN 1 AND 26214400
    AND "checksumSha256" ~ '^[a-f0-9]{64}$'
    AND char_length(btrim("alternativeText")) BETWEEN 1 AND 250
    AND "displayOrder" BETWEEN 1 AND 20
  ),
  CONSTRAINT "CatalogMediaAsset_object_key_check" CHECK (
    "objectKey" ~ '^venue-catalog-media/[0-9a-f-]{36}/[a-f0-9]{64}\.(jpg|png|webp)$'
    AND split_part("objectKey", '/', 2) = "resourceId"::text
  )
);

CREATE UNIQUE INDEX "RestaurantProfile_singletonKey_key" ON "RestaurantProfile"("singletonKey");
CREATE INDEX "Hall_lifecycle_displayOrder_id_idx" ON "Hall"("lifecycle", "displayOrder", "id");
CREATE UNIQUE INDEX "Hall_active_name_key" ON "Hall"("nameNormalized") WHERE "lifecycle" = 'ACTIVE';

CREATE INDEX "Dish_lifecycle_displayOrder_id_idx" ON "Dish"("lifecycle", "displayOrder", "id");
CREATE UNIQUE INDEX "Dish_currentPublishedVersionId_id_key" ON "Dish"("currentPublishedVersionId", "id");
CREATE UNIQUE INDEX "Dish_draftVersionId_id_key" ON "Dish"("draftVersionId", "id");
CREATE UNIQUE INDEX "DishVersion_id_dishId_key" ON "DishVersion"("id", "dishId");
CREATE UNIQUE INDEX "DishVersion_dishId_versionNumber_key" ON "DishVersion"("dishId", "versionNumber");
CREATE UNIQUE INDEX "DishVersion_one_draft_key" ON "DishVersion"("dishId") WHERE "state" = 'DRAFT';
CREATE UNIQUE INDEX "DishVersion_one_current_key" ON "DishVersion"("dishId") WHERE "state" = 'PUBLISHED';
CREATE INDEX "DishVersion_dishId_state_idx" ON "DishVersion"("dishId", "state");

CREATE INDEX "MenuPackage_lifecycle_displayOrder_id_idx" ON "MenuPackage"("lifecycle", "displayOrder", "id");
CREATE UNIQUE INDEX "MenuPackage_currentPublishedVersionId_id_key" ON "MenuPackage"("currentPublishedVersionId", "id");
CREATE UNIQUE INDEX "MenuPackage_draftVersionId_id_key" ON "MenuPackage"("draftVersionId", "id");
CREATE UNIQUE INDEX "MenuPackageVersion_id_menuPackageId_key" ON "MenuPackageVersion"("id", "menuPackageId");
CREATE UNIQUE INDEX "MenuPackageVersion_menuPackageId_versionNumber_key" ON "MenuPackageVersion"("menuPackageId", "versionNumber");
CREATE UNIQUE INDEX "MenuPackageVersion_one_draft_key" ON "MenuPackageVersion"("menuPackageId") WHERE "state" = 'DRAFT';
CREATE UNIQUE INDEX "MenuPackageVersion_one_current_key" ON "MenuPackageVersion"("menuPackageId") WHERE "state" = 'PUBLISHED';
CREATE INDEX "MenuPackageVersion_menuPackageId_state_idx" ON "MenuPackageVersion"("menuPackageId", "state");
CREATE UNIQUE INDEX "MenuPackageItem_menuPackageVersionId_dishVersionId_key" ON "MenuPackageItem"("menuPackageVersionId", "dishVersionId");
CREATE UNIQUE INDEX "MenuPackageItem_menuPackageVersionId_displayOrder_key" ON "MenuPackageItem"("menuPackageVersionId", "displayOrder");

CREATE INDEX "TimelineTemplate_lifecycle_displayOrder_id_idx" ON "TimelineTemplate"("lifecycle", "displayOrder", "id");
CREATE UNIQUE INDEX "TimelineTemplate_currentPublishedVersionId_id_key" ON "TimelineTemplate"("currentPublishedVersionId", "id");
CREATE UNIQUE INDEX "TimelineTemplate_draftVersionId_id_key" ON "TimelineTemplate"("draftVersionId", "id");
CREATE UNIQUE INDEX "TimelineTemplateVersion_id_timelineTemplateId_key" ON "TimelineTemplateVersion"("id", "timelineTemplateId");
CREATE UNIQUE INDEX "TimelineTemplateVersion_timelineTemplateId_versionNumber_key" ON "TimelineTemplateVersion"("timelineTemplateId", "versionNumber");
CREATE UNIQUE INDEX "TimelineTemplateVersion_one_draft_key" ON "TimelineTemplateVersion"("timelineTemplateId") WHERE "state" = 'DRAFT';
CREATE UNIQUE INDEX "TimelineTemplateVersion_one_current_key" ON "TimelineTemplateVersion"("timelineTemplateId") WHERE "state" = 'PUBLISHED';
CREATE INDEX "TimelineTemplateVersion_timelineTemplateId_state_idx" ON "TimelineTemplateVersion"("timelineTemplateId", "state");
CREATE UNIQUE INDEX "TimelineTemplateItem_timelineTemplateVersionId_id_key" ON "TimelineTemplateItem"("timelineTemplateVersionId", "id");
CREATE UNIQUE INDEX "TimelineTemplateItem_timelineTemplateVersionId_displayOrder_key" ON "TimelineTemplateItem"("timelineTemplateVersionId", "displayOrder");

CREATE INDEX "LayoutTemplate_hallId_lifecycle_displayOrder_id_idx" ON "LayoutTemplate"("hallId", "lifecycle", "displayOrder", "id");
CREATE UNIQUE INDEX "LayoutTemplate_currentPublishedVersionId_id_key" ON "LayoutTemplate"("currentPublishedVersionId", "id");
CREATE UNIQUE INDEX "LayoutTemplate_draftVersionId_id_key" ON "LayoutTemplate"("draftVersionId", "id");
CREATE UNIQUE INDEX "LayoutTemplateVersion_id_layoutTemplateId_key" ON "LayoutTemplateVersion"("id", "layoutTemplateId");
CREATE UNIQUE INDEX "LayoutTemplateVersion_layoutTemplateId_versionNumber_key" ON "LayoutTemplateVersion"("layoutTemplateId", "versionNumber");
CREATE UNIQUE INDEX "LayoutTemplateVersion_one_draft_key" ON "LayoutTemplateVersion"("layoutTemplateId") WHERE "state" = 'DRAFT';
CREATE UNIQUE INDEX "LayoutTemplateVersion_one_current_key" ON "LayoutTemplateVersion"("layoutTemplateId") WHERE "state" = 'PUBLISHED';
CREATE INDEX "LayoutTemplateVersion_layoutTemplateId_state_idx" ON "LayoutTemplateVersion"("layoutTemplateId", "state");
CREATE UNIQUE INDEX "LayoutTableIdentity_id_layoutTemplateId_key" ON "LayoutTableIdentity"("id", "layoutTemplateId");
CREATE INDEX "LayoutTableIdentity_layoutTemplateId_retiredAt_idx" ON "LayoutTableIdentity"("layoutTemplateId", "retiredAt");
CREATE UNIQUE INDEX "LayoutTableGeometry_layoutTemplateVersionId_tableId_key" ON "LayoutTableGeometry"("layoutTemplateVersionId", "tableId");
CREATE UNIQUE INDEX "LayoutTableGeometry_layoutTemplateVersionId_displayOrder_key" ON "LayoutTableGeometry"("layoutTemplateVersionId", "displayOrder");
CREATE INDEX "LayoutTableGeometry_layoutTemplateId_tableId_idx" ON "LayoutTableGeometry"("layoutTemplateId", "tableId");

CREATE UNIQUE INDEX "CatalogMediaAsset_objectKey_key" ON "CatalogMediaAsset"("objectKey");
CREATE UNIQUE INDEX "CatalogMediaAsset_attached_order_key" ON "CatalogMediaAsset"("resourceType", "resourceId", "displayOrder") WHERE "detachedAt" IS NULL;
CREATE INDEX "CatalogMediaAsset_resourceType_resourceId_detachedAt_idx" ON "CatalogMediaAsset"("resourceType", "resourceId", "detachedAt");

ALTER TABLE "DishVersion" ADD CONSTRAINT "DishVersion_dishId_fkey" FOREIGN KEY ("dishId") REFERENCES "Dish"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Dish" ADD CONSTRAINT "Dish_currentPublishedVersionId_id_fkey" FOREIGN KEY ("currentPublishedVersionId", "id") REFERENCES "DishVersion"("id", "dishId") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "Dish" ADD CONSTRAINT "Dish_draftVersionId_id_fkey" FOREIGN KEY ("draftVersionId", "id") REFERENCES "DishVersion"("id", "dishId") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "MenuPackageVersion" ADD CONSTRAINT "MenuPackageVersion_menuPackageId_fkey" FOREIGN KEY ("menuPackageId") REFERENCES "MenuPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MenuPackage" ADD CONSTRAINT "MenuPackage_currentPublishedVersionId_id_fkey" FOREIGN KEY ("currentPublishedVersionId", "id") REFERENCES "MenuPackageVersion"("id", "menuPackageId") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "MenuPackage" ADD CONSTRAINT "MenuPackage_draftVersionId_id_fkey" FOREIGN KEY ("draftVersionId", "id") REFERENCES "MenuPackageVersion"("id", "menuPackageId") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "MenuPackageItem" ADD CONSTRAINT "MenuPackageItem_menuPackageVersionId_fkey" FOREIGN KEY ("menuPackageVersionId") REFERENCES "MenuPackageVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MenuPackageItem" ADD CONSTRAINT "MenuPackageItem_dishVersionId_fkey" FOREIGN KEY ("dishVersionId") REFERENCES "DishVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TimelineTemplateVersion" ADD CONSTRAINT "TimelineTemplateVersion_timelineTemplateId_fkey" FOREIGN KEY ("timelineTemplateId") REFERENCES "TimelineTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TimelineTemplate" ADD CONSTRAINT "TimelineTemplate_currentPublishedVersionId_id_fkey" FOREIGN KEY ("currentPublishedVersionId", "id") REFERENCES "TimelineTemplateVersion"("id", "timelineTemplateId") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "TimelineTemplate" ADD CONSTRAINT "TimelineTemplate_draftVersionId_id_fkey" FOREIGN KEY ("draftVersionId", "id") REFERENCES "TimelineTemplateVersion"("id", "timelineTemplateId") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "TimelineTemplateItem" ADD CONSTRAINT "TimelineTemplateItem_timelineTemplateVersionId_fkey" FOREIGN KEY ("timelineTemplateVersionId") REFERENCES "TimelineTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LayoutTemplate" ADD CONSTRAINT "LayoutTemplate_hallId_fkey" FOREIGN KEY ("hallId") REFERENCES "Hall"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LayoutTemplateVersion" ADD CONSTRAINT "LayoutTemplateVersion_layoutTemplateId_fkey" FOREIGN KEY ("layoutTemplateId") REFERENCES "LayoutTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LayoutTemplate" ADD CONSTRAINT "LayoutTemplate_currentPublishedVersionId_id_fkey" FOREIGN KEY ("currentPublishedVersionId", "id") REFERENCES "LayoutTemplateVersion"("id", "layoutTemplateId") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "LayoutTemplate" ADD CONSTRAINT "LayoutTemplate_draftVersionId_id_fkey" FOREIGN KEY ("draftVersionId", "id") REFERENCES "LayoutTemplateVersion"("id", "layoutTemplateId") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "LayoutTableIdentity" ADD CONSTRAINT "LayoutTableIdentity_layoutTemplateId_fkey" FOREIGN KEY ("layoutTemplateId") REFERENCES "LayoutTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LayoutTableGeometry" ADD CONSTRAINT "LayoutTableGeometry_layoutTemplateVersionId_layoutTemplate_fkey" FOREIGN KEY ("layoutTemplateVersionId", "layoutTemplateId") REFERENCES "LayoutTemplateVersion"("id", "layoutTemplateId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LayoutTableGeometry" ADD CONSTRAINT "LayoutTableGeometry_tableId_layoutTemplateId_fkey" FOREIGN KEY ("tableId", "layoutTemplateId") REFERENCES "LayoutTableIdentity"("id", "layoutTemplateId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "catalog_check_version_pointers"() RETURNS trigger AS $$
DECLARE
  pointed_state TEXT;
BEGIN
  IF NEW."currentPublishedVersionId" IS NOT NULL THEN
    EXECUTE format(
      'SELECT "state"::text FROM %I WHERE "id" = $1 AND %I = $2',
      TG_ARGV[0],
      TG_ARGV[1]
    ) INTO pointed_state USING NEW."currentPublishedVersionId", NEW."id";
    IF pointed_state IS DISTINCT FROM 'PUBLISHED' THEN
      RAISE EXCEPTION 'current version pointer must reference an owned published version'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."draftVersionId" IS NOT NULL THEN
    EXECUTE format(
      'SELECT "state"::text FROM %I WHERE "id" = $1 AND %I = $2',
      TG_ARGV[0],
      TG_ARGV[1]
    ) INTO pointed_state USING NEW."draftVersionId", NEW."id";
    IF pointed_state IS DISTINCT FROM 'DRAFT' THEN
      RAISE EXCEPTION 'draft pointer must reference an owned draft version'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "Dish_version_pointer_state_trigger"
AFTER INSERT OR UPDATE ON "Dish"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION "catalog_check_version_pointers"('DishVersion', 'dishId');
CREATE CONSTRAINT TRIGGER "MenuPackage_version_pointer_state_trigger"
AFTER INSERT OR UPDATE ON "MenuPackage"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION "catalog_check_version_pointers"('MenuPackageVersion', 'menuPackageId');
CREATE CONSTRAINT TRIGGER "TimelineTemplate_version_pointer_state_trigger"
AFTER INSERT OR UPDATE ON "TimelineTemplate"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION "catalog_check_version_pointers"('TimelineTemplateVersion', 'timelineTemplateId');
CREATE CONSTRAINT TRIGGER "LayoutTemplate_version_pointer_state_trigger"
AFTER INSERT OR UPDATE ON "LayoutTemplate"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION "catalog_check_version_pointers"('LayoutTemplateVersion', 'layoutTemplateId');

CREATE FUNCTION "catalog_check_version_owner_pointer"() RETURNS trigger AS $$
DECLARE
  aggregate_id UUID;
  current_pointer UUID;
  draft_pointer UUID;
BEGIN
  aggregate_id := (to_jsonb(NEW) ->> TG_ARGV[1])::uuid;
  EXECUTE format(
    'SELECT "currentPublishedVersionId", "draftVersionId" FROM %I WHERE "id" = $1',
    TG_ARGV[0]
  ) INTO current_pointer, draft_pointer USING aggregate_id;

  IF NEW."state" = 'DRAFT' AND draft_pointer IS DISTINCT FROM NEW."id" THEN
    RAISE EXCEPTION 'draft version must be the aggregate draft pointer' USING ERRCODE = '23514';
  ELSIF NEW."state" = 'PUBLISHED' AND current_pointer IS DISTINCT FROM NEW."id" THEN
    RAISE EXCEPTION 'published version must be the aggregate current pointer' USING ERRCODE = '23514';
  ELSIF NEW."state" = 'SUPERSEDED'
        AND (current_pointer = NEW."id" OR draft_pointer = NEW."id") THEN
    RAISE EXCEPTION 'superseded version cannot remain an aggregate pointer' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "DishVersion_owner_pointer_trigger"
AFTER INSERT OR UPDATE ON "DishVersion"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION "catalog_check_version_owner_pointer"('Dish', 'dishId');
CREATE CONSTRAINT TRIGGER "MenuPackageVersion_owner_pointer_trigger"
AFTER INSERT OR UPDATE ON "MenuPackageVersion"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION "catalog_check_version_owner_pointer"('MenuPackage', 'menuPackageId');
CREATE CONSTRAINT TRIGGER "TimelineTemplateVersion_owner_pointer_trigger"
AFTER INSERT OR UPDATE ON "TimelineTemplateVersion"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION "catalog_check_version_owner_pointer"('TimelineTemplate', 'timelineTemplateId');
CREATE CONSTRAINT TRIGGER "LayoutTemplateVersion_owner_pointer_trigger"
AFTER INSERT OR UPDATE ON "LayoutTemplateVersion"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION "catalog_check_version_owner_pointer"('LayoutTemplate', 'layoutTemplateId');

CREATE FUNCTION "catalog_protect_version_history"() RETURNS trigger AS $$
BEGIN
  IF OLD."state" = 'DRAFT' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD."state" = 'PUBLISHED'
     AND NEW."state" = 'SUPERSEDED'
     AND (to_jsonb(OLD) - 'state' - 'updatedAt') = (to_jsonb(NEW) - 'state' - 'updatedAt') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'published catalog history is immutable' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DishVersion_history_trigger"
BEFORE UPDATE OR DELETE ON "DishVersion" FOR EACH ROW
EXECUTE FUNCTION "catalog_protect_version_history"();
CREATE TRIGGER "MenuPackageVersion_history_trigger"
BEFORE UPDATE OR DELETE ON "MenuPackageVersion" FOR EACH ROW
EXECUTE FUNCTION "catalog_protect_version_history"();
CREATE TRIGGER "TimelineTemplateVersion_history_trigger"
BEFORE UPDATE OR DELETE ON "TimelineTemplateVersion" FOR EACH ROW
EXECUTE FUNCTION "catalog_protect_version_history"();
CREATE TRIGGER "LayoutTemplateVersion_history_trigger"
BEFORE UPDATE OR DELETE ON "LayoutTemplateVersion" FOR EACH ROW
EXECUTE FUNCTION "catalog_protect_version_history"();

CREATE FUNCTION "catalog_require_draft_parent"() RETURNS trigger AS $$
DECLARE
  parent_id UUID;
  parent_state TEXT;
BEGIN
  parent_id := COALESCE(
    (to_jsonb(NEW) ->> TG_ARGV[1])::uuid,
    (to_jsonb(OLD) ->> TG_ARGV[1])::uuid
  );
  EXECUTE format('SELECT "state"::text FROM %I WHERE "id" = $1', TG_ARGV[0])
    INTO parent_state USING parent_id;
  IF parent_state IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'published catalog version content is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "MenuPackageItem_draft_parent_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "MenuPackageItem" FOR EACH ROW
EXECUTE FUNCTION "catalog_require_draft_parent"('MenuPackageVersion', 'menuPackageVersionId');
CREATE TRIGGER "TimelineTemplateItem_draft_parent_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "TimelineTemplateItem" FOR EACH ROW
EXECUTE FUNCTION "catalog_require_draft_parent"('TimelineTemplateVersion', 'timelineTemplateVersionId');
CREATE TRIGGER "LayoutTableGeometry_draft_parent_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "LayoutTableGeometry" FOR EACH ROW
EXECUTE FUNCTION "catalog_require_draft_parent"('LayoutTemplateVersion', 'layoutTemplateVersionId');

CREATE FUNCTION "catalog_protect_stable_identity"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
     OR NEW."id" <> OLD."id"
     OR NEW."layoutTemplateId" <> OLD."layoutTemplateId"
     OR NEW."createdAt" <> OLD."createdAt"
     OR NEW."createdByAccountId" <> OLD."createdByAccountId"
     OR (OLD."retiredAt" IS NOT NULL AND NEW."retiredAt" IS DISTINCT FROM OLD."retiredAt") THEN
    RAISE EXCEPTION 'stable table identity cannot be deleted or reassigned' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "LayoutTableIdentity_stability_trigger"
BEFORE UPDATE OR DELETE ON "LayoutTableIdentity" FOR EACH ROW
EXECUTE FUNCTION "catalog_protect_stable_identity"();

CREATE FUNCTION "catalog_require_active_table_identity"() RETURNS trigger AS $$
DECLARE
  table_retired_at TIMESTAMPTZ(6);
BEGIN
  SELECT "retiredAt" INTO table_retired_at
    FROM "LayoutTableIdentity"
   WHERE "id" = NEW."tableId" AND "layoutTemplateId" = NEW."layoutTemplateId";
  IF table_retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'retired table identity cannot be reused' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "LayoutTableGeometry_active_identity_trigger"
BEFORE INSERT OR UPDATE ON "LayoutTableGeometry" FOR EACH ROW
EXECUTE FUNCTION "catalog_require_active_table_identity"();

CREATE FUNCTION "catalog_protect_layout_hall"() RETURNS trigger AS $$
BEGIN
  IF NEW."hallId" <> OLD."hallId" THEN
    RAISE EXCEPTION 'layout template cannot move to another hall' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "LayoutTemplate_hall_stability_trigger"
BEFORE UPDATE OF "hallId" ON "LayoutTemplate" FOR EACH ROW
EXECUTE FUNCTION "catalog_protect_layout_hall"();

COMMIT;
