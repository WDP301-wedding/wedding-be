BEGIN;
-- Preserve every existing slug, publication head and revision. The legacy identity
-- remains the default for named-guest credentials and historical print references.
ALTER TABLE "InvitationPublicIdentity" ADD COLUMN "designId" UUID;
ALTER TABLE "InvitationPublicIdentity" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InvitationPublicIdentity" DISABLE TRIGGER studio_head_guard;
UPDATE "InvitationPublicIdentity" i SET "isDefault"=true, "designId"=(
  SELECT d."designId" FROM "InvitationPublishedRevision" p
  JOIN "InvitationDesignRevision" d ON d.id=p."designRevisionId" AND d."bookingId"=i."bookingId"
  WHERE p."bookingId"=i."bookingId"
  ORDER BY (p.id=i."currentPublicationId") DESC NULLS LAST, p."createdAt" DESC, p.id DESC LIMIT 1
);
-- Flush the deferred owner-reference checks before changing table constraints.
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE "InvitationPublicIdentity" ENABLE TRIGGER studio_head_guard;
ALTER TABLE "InvitationPublicIdentity" DROP CONSTRAINT "InvitationPublicIdentity_pkey";
ALTER TABLE "InvitationPublicIdentity" ADD CONSTRAINT "InvitationPublicIdentity_pkey" PRIMARY KEY (id);
CREATE UNIQUE INDEX "InvitationPublicIdentity_designId_key" ON "InvitationPublicIdentity"("designId");
CREATE INDEX "InvitationPublicIdentity_bookingId_idx" ON "InvitationPublicIdentity"("bookingId");
CREATE UNIQUE INDEX "InvitationPublicIdentity_default_booking_key" ON "InvitationPublicIdentity"("bookingId") WHERE "isDefault";

CREATE FUNCTION invitation_design_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' AND (NEW."isDefault"<>OLD."isDefault" OR
   (OLD."designId" IS NOT NULL AND NEW."designId" IS DISTINCT FROM OLD."designId")) THEN
  RAISE EXCEPTION 'Public design identity cannot be reassigned';
 END IF;
 IF NEW."designId" IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM "InvitationDesign" WHERE id=NEW."designId" AND "bookingId"=NEW."bookingId"
 ) THEN RAISE EXCEPTION 'Invalid public design owner'; END IF;
 IF NEW."designId" IS NOT NULL AND NEW."currentPublicationId" IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM "InvitationPublishedRevision" p JOIN "InvitationDesignRevision" d ON d.id=p."designRevisionId"
   WHERE p.id=NEW."currentPublicationId" AND d."designId"=NEW."designId" AND d."bookingId"=NEW."bookingId"
 ) THEN RAISE EXCEPTION 'Publication must belong to its stable design'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER studio_design_identity_guard BEFORE INSERT OR UPDATE ON "InvitationPublicIdentity"
 FOR EACH ROW EXECUTE FUNCTION invitation_design_identity_guard();
COMMIT;
