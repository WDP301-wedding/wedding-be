-- CreateTable
CREATE TABLE "InvitationMediaPolicy" (
    "bookingId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "cutoffAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "InvitationMediaPolicy_pkey" PRIMARY KEY ("bookingId")
);

-- CreateTable
CREATE TABLE "InvitationMediaAsset" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "currentFileRevisionId" UUID NOT NULL,
    "detachedAt" TIMESTAMPTZ(6),

    CONSTRAINT "InvitationMediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvitationMediaFile" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "objectKey" VARCHAR(256) NOT NULL,
    "checksumSha256" CHAR(64) NOT NULL,
    "contentType" VARCHAR(16) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "altText" VARCHAR(250) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(6) NOT NULL,
    "policyRevision" INTEGER NOT NULL,
    "cutoffAt" TIMESTAMPTZ(6) NOT NULL,
    "uploadAttemptId" UUID NOT NULL,

    CONSTRAINT "InvitationMediaFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvitationMediaReceipt" (
    "bookingId" UUID NOT NULL,
    "intentKeyDigest" CHAR(64) NOT NULL,
    "commandDigest" CHAR(64) NOT NULL,
    "result" JSONB NOT NULL,

    CONSTRAINT "InvitationMediaReceipt_pkey" PRIMARY KEY ("bookingId","intentKeyDigest")
);

-- CreateTable
CREATE TABLE "InvitationMediaAudit" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "actorId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "assetId" UUID,
    "revision" INTEGER NOT NULL,
    "previousCutoffAt" TIMESTAMPTZ(6),
    "cutoffAt" TIMESTAMPTZ(6),

    CONSTRAINT "InvitationMediaAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvitationMediaUploadAttempt" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "objectKey" VARCHAR(256) NOT NULL,
    "checksumSha256" CHAR(64) NOT NULL,
    "contentType" VARCHAR(16) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "intentKeyDigest" CHAR(64) NOT NULL,
    "commandDigest" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL,
    "policyRevision" INTEGER NOT NULL,

    CONSTRAINT "InvitationMediaUploadAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvitationMediaAsset_bookingId_detachedAt_id_idx" ON "InvitationMediaAsset"("bookingId", "detachedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "InvitationMediaAsset_id_bookingId_key" ON "InvitationMediaAsset"("id", "bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "InvitationMediaAsset_currentFileRevisionId_id_bookingId_key" ON "InvitationMediaAsset"("currentFileRevisionId", "id", "bookingId");

-- CreateIndex
CREATE INDEX "InvitationMediaFile_bookingId_acceptedAt_id_idx" ON "InvitationMediaFile"("bookingId", "acceptedAt", "id");

-- CreateIndex
CREATE INDEX "InvitationMediaFile_objectKey_idx" ON "InvitationMediaFile"("objectKey");

-- CreateIndex
CREATE UNIQUE INDEX "InvitationMediaFile_assetId_revision_key" ON "InvitationMediaFile"("assetId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "InvitationMediaFile_id_assetId_bookingId_key" ON "InvitationMediaFile"("id", "assetId", "bookingId");

-- CreateIndex
CREATE INDEX "InvitationMediaAudit_bookingId_occurredAt_id_idx" ON "InvitationMediaAudit"("bookingId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "InvitationMediaUploadAttempt_bookingId_createdAt_id_idx" ON "InvitationMediaUploadAttempt"("bookingId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "InvitationMediaUploadAttempt_bookingId_intentKeyDigest_comm_idx" ON "InvitationMediaUploadAttempt"("bookingId", "intentKeyDigest", "commandDigest");

-- CreateIndex
CREATE UNIQUE INDEX "InvitationMediaUploadAttempt_id_bookingId_key" ON "InvitationMediaUploadAttempt"("id", "bookingId");

-- AddForeignKey
ALTER TABLE "InvitationMediaAsset" ADD CONSTRAINT "InvitationMediaAsset_current_file_fkey" FOREIGN KEY ("currentFileRevisionId", "id", "bookingId") REFERENCES "InvitationMediaFile"("id", "assetId", "bookingId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "InvitationMediaFile" ADD CONSTRAINT "InvitationMediaFile_assetId_bookingId_fkey" FOREIGN KEY ("assetId", "bookingId") REFERENCES "InvitationMediaAsset"("id", "bookingId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvitationMediaFile" ADD CONSTRAINT "InvitationMediaFile_uploadAttemptId_bookingId_fkey" FOREIGN KEY ("uploadAttemptId", "bookingId") REFERENCES "InvitationMediaUploadAttempt"("id", "bookingId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Resolve the asset/file cycle only when the whole acceptance transaction commits.
ALTER TABLE "InvitationMediaAsset" ALTER CONSTRAINT "InvitationMediaAsset_current_file_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "InvitationMediaPolicy" ADD CONSTRAINT "InvitationMediaPolicy_revision_check" CHECK (revision >= 0);
ALTER TABLE "InvitationMediaAsset" ADD CONSTRAINT "InvitationMediaAsset_revision_check" CHECK (revision > 0);
ALTER TABLE "InvitationMediaFile" ADD CONSTRAINT "InvitationMediaFile_metadata_check" CHECK (
 revision > 0 AND "policyRevision" >= 0 AND "sizeBytes" BETWEEN 1 AND 26214400
 AND width BETWEEN 1 AND 12000 AND height BETWEEN 1 AND 12000
 AND width::bigint * height::bigint <= 40000000 AND char_length("altText") BETWEEN 1 AND 250
 AND "contentType" IN ('image/jpeg','image/png','image/webp') AND "checksumSha256" ~ '^[a-f0-9]{64}$'
 AND "objectKey" = 'private-wedding-media/' || "bookingId"::text || '/' || "checksumSha256" ||
 CASE "contentType" WHEN 'image/jpeg' THEN '.jpg' WHEN 'image/png' THEN '.png' ELSE '.webp' END);
ALTER TABLE "InvitationMediaReceipt" ADD CONSTRAINT "InvitationMediaReceipt_digest_check"
 CHECK ("intentKeyDigest" ~ '^[a-f0-9]{64}$' AND "commandDigest" ~ '^[a-f0-9]{64}$');
ALTER TABLE "InvitationMediaUploadAttempt" ADD CONSTRAINT "InvitationMediaUploadAttempt_metadata_check" CHECK (
 "sizeBytes" BETWEEN 1 AND 26214400 AND "policyRevision" >= 0
 AND "contentType" IN ('image/jpeg','image/png','image/webp') AND "checksumSha256" ~ '^[a-f0-9]{64}$'
 AND "intentKeyDigest" ~ '^[a-f0-9]{64}$' AND "commandDigest" ~ '^[a-f0-9]{64}$'
 AND "objectKey" = 'private-wedding-media/' || "bookingId"::text || '/' || "checksumSha256" ||
 CASE "contentType" WHEN 'image/jpeg' THEN '.jpg' WHEN 'image/png' THEN '.png' ELSE '.webp' END);

CREATE FUNCTION invitation_media_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable invitation media history' USING ERRCODE = '23514'; END $$;
CREATE TRIGGER invitation_media_file_immutable BEFORE UPDATE OR DELETE ON "InvitationMediaFile"
 FOR EACH ROW EXECUTE FUNCTION invitation_media_immutable();
CREATE TRIGGER invitation_media_receipt_immutable BEFORE UPDATE OR DELETE ON "InvitationMediaReceipt"
 FOR EACH ROW EXECUTE FUNCTION invitation_media_immutable();
CREATE TRIGGER invitation_media_audit_immutable BEFORE UPDATE OR DELETE ON "InvitationMediaAudit"
 FOR EACH ROW EXECUTE FUNCTION invitation_media_immutable();

CREATE FUNCTION invitation_media_quota_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE active_count bigint; active_bytes bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('booking:' || NEW."bookingId"::text, 0));
 EXECUTE format('SELECT count(*), coalesce(sum(f."sizeBytes"),0)
 FROM %I."InvitationMediaAsset" a JOIN %I."InvitationMediaFile" f ON f.id = a."currentFileRevisionId"
 WHERE a."bookingId" = $1 AND a."detachedAt" IS NULL', TG_TABLE_SCHEMA, TG_TABLE_SCHEMA)
 INTO active_count, active_bytes USING NEW."bookingId";
 IF active_count > 100 OR active_bytes > 1073741824 THEN
  RAISE EXCEPTION 'MEDIA_QUOTA_EXCEEDED' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER invitation_media_quota AFTER INSERT OR UPDATE ON "InvitationMediaAsset"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION invitation_media_quota_check();
