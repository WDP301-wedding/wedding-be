CREATE TABLE "RestaurantService" (
  "id" UUID PRIMARY KEY, "restaurantId" UUID NOT NULL REFERENCES "RestaurantProfile"("id") ON DELETE RESTRICT,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0), "active" BOOLEAN NOT NULL DEFAULT true
);
CREATE TABLE "RestaurantServiceRevision" (
  "id" UUID PRIMARY KEY, "serviceId" UUID NOT NULL REFERENCES "RestaurantService"("id") ON DELETE RESTRICT,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "name" TEXT NOT NULL CHECK (char_length("name") BETWEEN 1 AND 120),
  "description" TEXT NOT NULL CHECK (char_length("description") <= 2000),
  "unit" TEXT NOT NULL CHECK (char_length("unit") BETWEEN 1 AND 80),
  "unitPriceVnd" DECIMAL(18,0) NOT NULL CHECK ("unitPriceVnd" BETWEEN 0 AND 9007199254740991),
  "active" BOOLEAN NOT NULL, "actorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RestaurantServiceRevision_serviceId_revision_key" UNIQUE ("serviceId", "revision")
);
-- Fail closed if a future writer tries to rewrite referenced catalog history.
CREATE FUNCTION preserve_commercial_catalog_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Commercial catalog revisions are immutable'; END; $$;
CREATE TRIGGER "RestaurantServiceRevision_immutable" BEFORE UPDATE OR DELETE ON "RestaurantServiceRevision"
FOR EACH ROW EXECUTE FUNCTION preserve_commercial_catalog_revision();
