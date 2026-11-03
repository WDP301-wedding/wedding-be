-- Retain exact historical versions and all commercial references.
ALTER TABLE "Dish" ADD COLUMN "archivedAt" TIMESTAMPTZ(6);
ALTER TABLE "MenuPackage" ADD COLUMN "archivedAt" TIMESTAMPTZ(6);
ALTER TABLE "Dish" ADD CONSTRAINT "Dish_archived_retired_check"
  CHECK ("archivedAt" IS NULL OR "lifecycle" = 'RETIRED');
ALTER TABLE "MenuPackage" ADD CONSTRAINT "MenuPackage_archived_retired_check"
  CHECK ("archivedAt" IS NULL OR "lifecycle" = 'RETIRED');
