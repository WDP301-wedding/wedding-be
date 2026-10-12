CREATE TABLE "IdentityOutbox" (
  "eventId" UUID NOT NULL PRIMARY KEY,
  "eventType" TEXT NOT NULL,
  "eventVersion" INTEGER NOT NULL DEFAULT 1 CHECK ("eventVersion" = 1),
  "consultationId" UUID NOT NULL,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "IdentityOutbox_occurredAt_eventId_idx" ON "IdentityOutbox"("occurredAt", "eventId");
CREATE UNIQUE INDEX "NotificationRecipient_accountId_key" ON "NotificationRecipient"("accountId") WHERE "accountId" IS NOT NULL;
ALTER TABLE "NotificationRecipient" ADD COLUMN operational BOOLEAN NOT NULL DEFAULT false;
CREATE TRIGGER "IdentityOutbox_append_only" BEFORE UPDATE OR DELETE ON "IdentityOutbox"
FOR EACH ROW EXECUTE FUNCTION notification_evidence_immutable();
ALTER TABLE "IdentityOutbox" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "IdentityOutbox" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "IdentityOutbox" FROM authenticated; END IF;
END $$;
