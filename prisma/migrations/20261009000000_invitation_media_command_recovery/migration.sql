-- Durable intent binding survives acceptance rollback; preserves mismatch semantics
-- even while the first request is decoding/uploading or after an unknown effect.
CREATE TABLE "InvitationMediaCommand" (
 "bookingId" UUID NOT NULL, "intentKeyDigest" CHAR(64) NOT NULL, "commandDigest" CHAR(64) NOT NULL,
 CONSTRAINT "InvitationMediaCommand_pkey" PRIMARY KEY ("bookingId", "intentKeyDigest"),
 CONSTRAINT "InvitationMediaCommand_digest_check" CHECK (
  "intentKeyDigest" ~ '^[a-f0-9]{64}$' AND "commandDigest" ~ '^[a-f0-9]{64}$')
);
-- Upgrade existing receipts AND failed/pending upload journals, never discard intent.
-- Conflicting historical intents must be reconciled explicitly, not silently rebound.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM (
  SELECT "bookingId", "intentKeyDigest", "commandDigest" FROM "InvitationMediaReceipt"
  UNION ALL SELECT "bookingId", "intentKeyDigest", "commandDigest" FROM "InvitationMediaUploadAttempt"
 ) q GROUP BY "bookingId", "intentKeyDigest" HAVING count(DISTINCT "commandDigest") > 1) THEN
  RAISE EXCEPTION 'Conflicting invitation media command history requires reconciliation';
 END IF;
END $$;
INSERT INTO "InvitationMediaCommand" SELECT DISTINCT "bookingId", "intentKeyDigest", "commandDigest"
 FROM (SELECT "bookingId", "intentKeyDigest", "commandDigest" FROM "InvitationMediaReceipt"
 UNION ALL SELECT "bookingId", "intentKeyDigest", "commandDigest" FROM "InvitationMediaUploadAttempt") q;
CREATE TRIGGER invitation_media_command_immutable BEFORE UPDATE OR DELETE ON "InvitationMediaCommand"
 FOR EACH ROW EXECUTE FUNCTION invitation_media_immutable();
ALTER TABLE "InvitationMediaUploadAttempt" ADD COLUMN sequence BIGSERIAL NOT NULL;
CREATE UNIQUE INDEX "InvitationMediaUploadAttempt_sequence_key" ON "InvitationMediaUploadAttempt"(sequence);
CREATE INDEX "InvitationMediaUploadAttempt_bookingId_sequence_idx" ON "InvitationMediaUploadAttempt"("bookingId",sequence);
CREATE TRIGGER invitation_media_attempt_immutable BEFORE UPDATE OR DELETE ON "InvitationMediaUploadAttempt"
 FOR EACH ROW EXECUTE FUNCTION invitation_media_immutable();
