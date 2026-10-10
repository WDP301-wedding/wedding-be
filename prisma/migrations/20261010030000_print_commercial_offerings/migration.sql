CREATE TABLE "PrintOffering" (
  "id" UUID PRIMARY KEY, "restaurantId" UUID NOT NULL REFERENCES "RestaurantProfile"("id") ON DELETE RESTRICT,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0), "active" BOOLEAN NOT NULL DEFAULT true
);
CREATE TABLE "PrintOfferingRevision" (
  "id" UUID PRIMARY KEY, "offeringId" UUID NOT NULL REFERENCES "PrintOffering"("id") ON DELETE RESTRICT,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "name" TEXT NOT NULL CHECK (char_length("name") BETWEEN 1 AND 120),
  "printType" TEXT NOT NULL CHECK (char_length("printType") BETWEEN 1 AND 80),
  "material" TEXT NOT NULL CHECK (char_length("material") BETWEEN 1 AND 120),
  "templateId" UUID NOT NULL, "templateVersionId" UUID NOT NULL REFERENCES "InvitationTemplateVersion"("id") ON DELETE RESTRICT,
  "templateTitle" TEXT NOT NULL,
  "unitPriceVnd" DECIMAL(18,0) NOT NULL CHECK ("unitPriceVnd" BETWEEN 0 AND 9007199254740991),
  "active" BOOLEAN NOT NULL, "actorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PrintOfferingRevision_offeringId_revision_key" UNIQUE ("offeringId", "revision")
);
CREATE TRIGGER "PrintOfferingRevision_immutable" BEFORE UPDATE OR DELETE ON "PrintOfferingRevision"
FOR EACH ROW EXECUTE FUNCTION preserve_commercial_catalog_revision();
