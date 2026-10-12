-- CreateTable
ALTER TABLE "NotificationRecipient" ADD COLUMN purposes TEXT[] NOT NULL DEFAULT ARRAY[]::text[];

-- CreateTable
CREATE TABLE "NotificationCredential" (
    "intentId" UUID NOT NULL,
    "credentialId" UUID NOT NULL,
    "keyVersion" VARCHAR(40) NOT NULL,
    "nonce" VARCHAR(24),
    "tag" VARCHAR(24),
    "ciphertext" VARCHAR(2048),
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "purgedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationCredential_pkey" PRIMARY KEY ("intentId")
);

-- CreateIndex
CREATE INDEX "NotificationCredential_expiresAt_purgedAt_idx" ON "NotificationCredential"("expiresAt", "purgedAt");

-- AddForeignKey
ALTER TABLE "NotificationCredential" ADD CONSTRAINT "NotificationCredential_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "NotificationIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationAttempt" DROP CONSTRAINT "NotificationAttempt_outcome_check";
ALTER TABLE "NotificationAttempt" ADD CONSTRAINT "NotificationAttempt_outcome_check" CHECK (
  outcome IN ('CLAIMED','ACCEPTED','DELIVERED','RETRYABLE_FAILED','UNKNOWN','DEAD_LETTER','CANCELLED','SKIPPED_STALE')
  AND ("errorCode" IS NULL OR "errorCode" ~ '^[A-Z][A-Z0-9_]{0,79}$')
);
ALTER TABLE "NotificationCredential" ADD CONSTRAINT "NotificationCredential_expiry_check" CHECK (
  "expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + interval '72 hours'
  AND (("purgedAt" IS NULL AND nonce IS NOT NULL AND tag IS NOT NULL AND ciphertext IS NOT NULL)
    OR ("purgedAt" IS NOT NULL AND nonce IS NULL AND tag IS NULL AND ciphertext IS NULL))
);
ALTER TABLE "NotificationCredential" ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE api_role text; BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE "NotificationCredential" FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
CREATE FUNCTION notification_credential_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Credential metadata is retained'; END IF;
  IF ROW(NEW."intentId",NEW."credentialId",NEW."keyVersion",NEW."expiresAt",NEW."createdAt")
      IS DISTINCT FROM ROW(OLD."intentId",OLD."credentialId",OLD."keyVersion",OLD."expiresAt",OLD."createdAt")
    OR OLD."purgedAt" IS NOT NULL OR NEW."purgedAt" IS NULL
    OR NEW.nonce IS NOT NULL OR NEW.tag IS NOT NULL OR NEW.ciphertext IS NOT NULL THEN
    RAISE EXCEPTION 'Credential may only be purged once';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notification_credential_guard BEFORE UPDATE OR DELETE ON "NotificationCredential"
  FOR EACH ROW EXECUTE FUNCTION notification_credential_guard();
