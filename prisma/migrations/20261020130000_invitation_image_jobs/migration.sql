BEGIN;
CREATE TABLE "InvitationImageJob" (
  "id" UUID PRIMARY KEY,
  "bookingId" UUID NOT NULL,
  "actorId" UUID NOT NULL,
  "sessionId" UUID NOT NULL,
  "requestId" TEXT NOT NULL,
  "intentDigest" CHAR(64) NOT NULL,
  "generationIntentDigest" CHAR(64) NOT NULL,
  "prompt" TEXT,
  "aspectRatio" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "claimToken" UUID,
  "claimExpiresAt" TIMESTAMPTZ(6),
  "result" JSONB,
  "errorCode" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  "inputExpiresAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "InvitationImageJob_status_check" CHECK ("status" IN ('QUEUED','RUNNING','RECOVERY_REQUIRED','SUCCEEDED','FAILED')),
  CONSTRAINT "InvitationImageJob_prompt_check" CHECK ("prompt" IS NULL OR char_length("prompt") BETWEEN 1 AND 2000),
  CONSTRAINT "InvitationImageJob_claim_check" CHECK (("status" = 'RUNNING') = ("claimToken" IS NOT NULL AND "claimExpiresAt" IS NOT NULL)),
  CONSTRAINT "InvitationImageJob_result_check" CHECK (("status" = 'SUCCEEDED') = ("result" IS NOT NULL))
);
CREATE UNIQUE INDEX "InvitationImageJob_bookingId_intentDigest_key" ON "InvitationImageJob"("bookingId","intentDigest");
CREATE INDEX "InvitationImageJob_status_claimExpiresAt_createdAt_idx" ON "InvitationImageJob"("status","claimExpiresAt","createdAt");
CREATE INDEX "InvitationImageJob_bookingId_id_idx" ON "InvitationImageJob"("bookingId","id");
CREATE INDEX "InvitationImageJob_inputExpiresAt_idx" ON "InvitationImageJob"("inputExpiresAt");
ALTER TABLE "InvitationImageJob" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "InvitationImageJob" FROM PUBLIC;
DO $$
DECLARE client_role TEXT;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=client_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE "InvitationImageJob" FROM %I',client_role);
    END IF;
  END LOOP;
END $$;
COMMIT;
