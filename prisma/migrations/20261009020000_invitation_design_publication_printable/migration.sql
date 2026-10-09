-- CreateTable
CREATE TABLE "InvitationTemplate" (
    "id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "currentVersionId" UUID NOT NULL,

    CONSTRAINT "InvitationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvitationTemplateVersion" (
    "id" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvitationTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvitationDesign" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "currentRevisionId" UUID NOT NULL,

    CONSTRAINT "InvitationDesign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvitationDesignRevision" (
    "id" UUID NOT NULL,
    "designId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvitationDesignRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvitationDerivedAsset" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "sourceFileId" UUID NOT NULL,
    "object" JSONB NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "publicSlug" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvitationDerivedAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvitationPublicIdentity" (
    "bookingId" UUID NOT NULL,
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "publicUrl" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "currentPublicationId" UUID,

    CONSTRAINT "InvitationPublicIdentity_pkey" PRIMARY KEY ("bookingId")
);

-- CreateTable
CREATE TABLE "InvitationPublishedRevision" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "designRevisionId" UUID NOT NULL,
    "content" JSONB NOT NULL,
    "assetIds" UUID[],
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvitationPublishedRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvitationSeatingRevision" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "layoutTemplateVersionId" UUID NOT NULL,
    "contentDigest" CHAR(64) NOT NULL,
    "renderSnapshot" JSONB NOT NULL,
    "validityProof" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvitationSeatingRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvitationSeatingState" (
    "bookingId" UUID NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "revisionId" UUID NOT NULL,
    "status" TEXT NOT NULL,

    CONSTRAINT "InvitationSeatingState_pkey" PRIMARY KEY ("bookingId")
);

-- CreateTable
CREATE TABLE "InvitationSeatingInvalidation" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "seatingPlanRevisionId" UUID NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvitationSeatingInvalidation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvitationPrintableRevision" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "designRevisionId" UUID NOT NULL,
    "timelineRevisionId" UUID NOT NULL,
    "seatingPlanRevisionId" UUID,
    "publicInvitationId" UUID NOT NULL,
    "contentDigest" CHAR(64) NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvitationPrintableRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvitationStudioCommand" (
    "bookingId" UUID NOT NULL,
    "intentDigest" CHAR(64) NOT NULL,
    "commandDigest" CHAR(64) NOT NULL,

    CONSTRAINT "InvitationStudioCommand_pkey" PRIMARY KEY ("bookingId","intentDigest")
);

-- CreateTable
CREATE TABLE "InvitationStudioReceipt" (
    "bookingId" UUID NOT NULL,
    "intentDigest" CHAR(64) NOT NULL,
    "result" JSONB NOT NULL,

    CONSTRAINT "InvitationStudioReceipt_pkey" PRIMARY KEY ("bookingId","intentDigest")
);

-- CreateTable
CREATE TABLE "InvitationGenerationIntent" (
    "bookingId" UUID NOT NULL,
    "intentDigest" CHAR(64) NOT NULL,
    "commandDigest" CHAR(64) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "mediaAssetId" UUID,
    "errorCode" TEXT,
    "errorStatus" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvitationGenerationIntent_pkey" PRIMARY KEY ("bookingId","intentDigest")
);

-- CreateTable
CREATE TABLE "InvitationStudioOutbox" (
    "eventId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "envelope" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvitationStudioOutbox_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "InvitationDerivedUploadAttempt" (
    "bookingId" UUID NOT NULL,
    "intentDigest" CHAR(64) NOT NULL,
    "assetId" UUID NOT NULL,
    "sourceFileId" UUID NOT NULL,
    "object" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvitationDerivedUploadAttempt_pkey" PRIMARY KEY ("bookingId","intentDigest")
);

-- CreateIndex
CREATE UNIQUE INDEX "InvitationTemplate_currentVersionId_key" ON "InvitationTemplate"("currentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "InvitationTemplateVersion_templateId_revision_key" ON "InvitationTemplateVersion"("templateId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "InvitationDesign_currentRevisionId_key" ON "InvitationDesign"("currentRevisionId");

-- CreateIndex
CREATE INDEX "InvitationDesign_bookingId_id_idx" ON "InvitationDesign"("bookingId", "id");

-- CreateIndex
CREATE INDEX "InvitationDesignRevision_bookingId_id_idx" ON "InvitationDesignRevision"("bookingId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "InvitationDesignRevision_designId_revision_key" ON "InvitationDesignRevision"("designId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "InvitationDerivedAsset_publicSlug_key" ON "InvitationDerivedAsset"("publicSlug");

-- CreateIndex
CREATE INDEX "InvitationDerivedAsset_bookingId_id_idx" ON "InvitationDerivedAsset"("bookingId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "InvitationPublicIdentity_id_key" ON "InvitationPublicIdentity"("id");

-- CreateIndex
CREATE UNIQUE INDEX "InvitationPublicIdentity_slug_key" ON "InvitationPublicIdentity"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "InvitationPublicIdentity_currentPublicationId_key" ON "InvitationPublicIdentity"("currentPublicationId");

-- CreateIndex
CREATE INDEX "InvitationPublishedRevision_bookingId_id_idx" ON "InvitationPublishedRevision"("bookingId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "InvitationSeatingRevision_bookingId_revisionNumber_key" ON "InvitationSeatingRevision"("bookingId", "revisionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "InvitationSeatingInvalidation_bookingId_revisionNumber_key" ON "InvitationSeatingInvalidation"("bookingId", "revisionNumber");

-- CreateIndex
CREATE INDEX "InvitationPrintableRevision_bookingId_id_idx" ON "InvitationPrintableRevision"("bookingId", "id");

-- CreateIndex
CREATE INDEX "InvitationStudioOutbox_bookingId_createdAt_eventId_idx" ON "InvitationStudioOutbox"("bookingId", "createdAt", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "InvitationDerivedUploadAttempt_assetId_key" ON "InvitationDerivedUploadAttempt"("assetId");

-- Immutable history and durable intents. Heads retain revision/high-water semantics.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['InvitationTemplateVersion','InvitationDesignRevision','InvitationDerivedAsset','InvitationPublishedRevision','InvitationSeatingRevision','InvitationSeatingInvalidation','InvitationPrintableRevision','InvitationStudioCommand','InvitationStudioReceipt','InvitationStudioOutbox','InvitationDerivedUploadAttempt'] LOOP
 EXECUTE format('CREATE TRIGGER studio_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION invitation_media_immutable()', t);
 END LOOP;
END $$;
ALTER TABLE "InvitationTemplate" ADD CONSTRAINT studio_revision CHECK(revision > 0);
ALTER TABLE "InvitationTemplateVersion" ADD CONSTRAINT studio_revision CHECK(revision > 0 AND jsonb_typeof(content)='object');
ALTER TABLE "InvitationDesign" ADD CONSTRAINT studio_revision CHECK(revision > 0);
ALTER TABLE "InvitationDesignRevision" ADD CONSTRAINT studio_revision CHECK(revision > 0 AND jsonb_typeof(content)='object');
ALTER TABLE "InvitationDerivedAsset" ADD CONSTRAINT studio_asset CHECK(width BETWEEN 1 AND 2048 AND height BETWEEN 1 AND 2048 AND "publicSlug" ~ '^[a-f0-9]{64}$' AND jsonb_typeof(object)='object');
ALTER TABLE "InvitationPublicIdentity" ADD CONSTRAINT studio_public_identity CHECK(revision >= 0 AND slug ~ '^[a-f0-9]{64}$');
ALTER TABLE "InvitationSeatingRevision" ADD CONSTRAINT studio_seating CHECK("revisionNumber">0 AND "contentDigest" ~ '^[a-f0-9]{64}$' AND jsonb_typeof("renderSnapshot")='array' AND jsonb_array_length("renderSnapshot") BETWEEN 1 AND 500 AND ("validityProof" IS NULL OR jsonb_typeof("validityProof")='object'));
ALTER TABLE "InvitationSeatingState" ADD CONSTRAINT studio_seating_state CHECK("revisionNumber">0 AND status IN ('ELIGIBLE','REQUIRES_REVIEW'));
ALTER TABLE "InvitationSeatingInvalidation" ADD CONSTRAINT studio_invalidation CHECK("revisionNumber">0 AND "reasonCode" IN ('HEADCOUNT_OUTSIDE_LAYOUT_RANGE','LAYOUT_RETIRED'));
ALTER TABLE "InvitationPrintableRevision" ADD CONSTRAINT studio_printable CHECK("contentDigest" ~ '^[a-f0-9]{64}$' AND jsonb_typeof(content)='object');
ALTER TABLE "InvitationStudioCommand" ADD CONSTRAINT studio_digest CHECK("intentDigest" ~ '^[a-f0-9]{64}$' AND "commandDigest" ~ '^[a-f0-9]{64}$');
ALTER TABLE "InvitationGenerationIntent" ADD CONSTRAINT studio_generation CHECK(
 "intentDigest" ~ '^[a-f0-9]{64}$' AND "commandDigest" ~ '^[a-f0-9]{64}$' AND
 ((status='PENDING' AND "mediaAssetId" IS NULL AND "errorCode" IS NULL AND "errorStatus" IS NULL) OR
 (status='ACCEPTED' AND "mediaAssetId" IS NOT NULL AND "errorCode" IS NULL AND "errorStatus" IS NULL) OR
 (status='FAILED' AND "mediaAssetId" IS NULL AND "errorCode" IS NOT NULL AND "errorStatus" IN (409,422,502))));
CREATE FUNCTION invitation_studio_head_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Invitation heads cannot be deleted'; END IF;
 IF TG_TABLE_NAME='InvitationSeatingState' THEN
  IF NEW."bookingId"<>OLD."bookingId" OR NEW."revisionNumber"<OLD."revisionNumber" OR
   (NEW."revisionNumber"=OLD."revisionNumber" AND (NEW."revisionId"<>OLD."revisionId" OR (OLD.status='REQUIRES_REVIEW' AND NEW.status='ELIGIBLE')))
   THEN RAISE EXCEPTION 'Seating high-water mark cannot be lowered or re-enabled'; END IF;
 ELSIF TG_TABLE_NAME='InvitationPublicIdentity' THEN
  IF NEW.id<>OLD.id OR NEW."bookingId"<>OLD."bookingId" OR NEW.slug<>OLD.slug OR NEW."publicUrl"<>OLD."publicUrl" OR NEW.revision<>OLD.revision+1
   THEN RAISE EXCEPTION 'Stable public identity/revision cannot be rewritten'; END IF;
 ELSE
  IF NEW.id<>OLD.id OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Invitation revision must advance once'; END IF;
  IF TG_TABLE_NAME='InvitationDesign' THEN
   IF NEW."bookingId"<>OLD."bookingId" THEN RAISE EXCEPTION 'Design ownership cannot change'; END IF;
  END IF;
 END IF;
 RETURN NEW; END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['InvitationTemplate','InvitationDesign','InvitationPublicIdentity','InvitationSeatingState'] LOOP
 EXECUTE format('CREATE TRIGGER studio_head_guard BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION invitation_studio_head_guard()',t);
 END LOOP;
END $$;
CREATE FUNCTION invitation_studio_generation_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR OLD.status<>'PENDING' THEN RAISE EXCEPTION 'Generation effect history is retained'; END IF;
 IF NEW."bookingId"<>OLD."bookingId" OR NEW."intentDigest"<>OLD."intentDigest" OR NEW."commandDigest"<>OLD."commandDigest" OR NEW."createdAt"<>OLD."createdAt" THEN RAISE EXCEPTION 'Generation intent cannot change'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER studio_generation_guard BEFORE UPDATE OR DELETE ON "InvitationGenerationIntent" FOR EACH ROW EXECUTE FUNCTION invitation_studio_generation_guard();
-- Deferred owner checks permit atomic history-before-head writes without dangling heads.
CREATE FUNCTION invitation_studio_reference_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE ok boolean; BEGIN
 CASE TG_TABLE_NAME
 WHEN 'InvitationTemplate' THEN SELECT EXISTS(SELECT 1 FROM "InvitationTemplateVersion" WHERE id=NEW."currentVersionId" AND "templateId"=NEW.id AND revision=NEW.revision) INTO ok;
 WHEN 'InvitationTemplateVersion' THEN SELECT EXISTS(SELECT 1 FROM "InvitationTemplate" WHERE id=NEW."templateId") INTO ok;
 WHEN 'InvitationDesign' THEN SELECT EXISTS(SELECT 1 FROM "InvitationDesignRevision" WHERE id=NEW."currentRevisionId" AND "designId"=NEW.id AND "bookingId"=NEW."bookingId" AND revision=NEW.revision) INTO ok;
 WHEN 'InvitationDesignRevision' THEN SELECT EXISTS(SELECT 1 FROM "InvitationDesign" WHERE id=NEW."designId" AND "bookingId"=NEW."bookingId") INTO ok;
 WHEN 'InvitationPublicIdentity' THEN
  ok := NEW."currentPublicationId" IS NULL OR EXISTS(SELECT 1 FROM "InvitationPublishedRevision" WHERE id=NEW."currentPublicationId" AND "bookingId"=NEW."bookingId");
 WHEN 'InvitationPublishedRevision' THEN SELECT EXISTS(SELECT 1 FROM "InvitationDesignRevision" WHERE id=NEW."designRevisionId" AND "bookingId"=NEW."bookingId") INTO ok;
 WHEN 'InvitationDerivedAsset' THEN SELECT EXISTS(SELECT 1 FROM "InvitationMediaFile" WHERE id=NEW."sourceFileId" AND "bookingId"=NEW."bookingId") INTO ok;
 WHEN 'InvitationSeatingState' THEN
  SELECT * INTO NEW FROM "InvitationSeatingState" WHERE "bookingId"=NEW."bookingId";
  IF NEW.status='ELIGIBLE' THEN
   ok := EXISTS(SELECT 1 FROM "InvitationSeatingRevision" WHERE id=NEW."revisionId" AND "bookingId"=NEW."bookingId" AND "revisionNumber"=NEW."revisionNumber") AND NOT EXISTS(SELECT 1 FROM "InvitationSeatingInvalidation" WHERE "bookingId"=NEW."bookingId" AND "revisionNumber"=NEW."revisionNumber");
  ELSE ok := EXISTS(SELECT 1 FROM "InvitationSeatingInvalidation" WHERE "seatingPlanRevisionId"=NEW."revisionId" AND "bookingId"=NEW."bookingId" AND "revisionNumber"=NEW."revisionNumber"); END IF;
 WHEN 'InvitationPrintableRevision' THEN
  ok := EXISTS(SELECT 1 FROM "InvitationDesignRevision" WHERE id=NEW."designRevisionId" AND "bookingId"=NEW."bookingId") AND EXISTS(SELECT 1 FROM "BookingTimelineRevision" WHERE id=NEW."timelineRevisionId" AND "bookingId"=NEW."bookingId") AND EXISTS(SELECT 1 FROM "InvitationPublicIdentity" WHERE id=NEW."publicInvitationId" AND "bookingId"=NEW."bookingId") AND (NEW."seatingPlanRevisionId" IS NULL OR EXISTS(SELECT 1 FROM "InvitationSeatingRevision" WHERE id=NEW."seatingPlanRevisionId" AND "bookingId"=NEW."bookingId"));
 END CASE;
 IF NOT ok THEN RAISE EXCEPTION 'Invalid invitation owner reference'; END IF;
 RETURN NEW; END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['InvitationTemplate','InvitationTemplateVersion','InvitationDesign','InvitationDesignRevision','InvitationPublicIdentity','InvitationPublishedRevision','InvitationDerivedAsset','InvitationSeatingState','InvitationPrintableRevision'] LOOP
 EXECUTE format('CREATE CONSTRAINT TRIGGER studio_reference_guard AFTER INSERT OR UPDATE ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION invitation_studio_reference_guard()',t);
 END LOOP;
END $$;
CREATE UNIQUE INDEX "InvitationSeatingInvalidation_seatingPlanRevisionId_key" ON "InvitationSeatingInvalidation"("seatingPlanRevisionId");
