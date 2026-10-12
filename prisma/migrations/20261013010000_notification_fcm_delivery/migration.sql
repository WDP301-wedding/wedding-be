-- Additive only: existing notification/financial history is preserved.
ALTER TABLE "NotificationIntent" ADD COLUMN "pushTargetsFrozenAt" TIMESTAMPTZ(6);
ALTER TABLE "NotificationIntent" DROP CONSTRAINT "NotificationIntent_state_check";
ALTER TABLE "NotificationIntent" ADD CONSTRAINT "NotificationIntent_state_check" CHECK (
  state IN ('QUEUED','IN_FLIGHT','DELIVERED','PROVIDER_ACCEPTED','RETRYABLE_FAILED','UNKNOWN','DEAD_LETTER','SKIPPED_STALE','CANCELLED')
  AND channel IN ('EMAIL','ANDROID','IN_APP') AND revision > 0 AND "templateVersion" > 0
  AND (state <> 'PROVIDER_ACCEPTED' OR channel = 'ANDROID')
  AND "attemptCount" BETWEEN 0 AND 6
  AND ("scheduleRevision" IS NULL OR ("scheduleRevision" > 0 AND "bookingId" IS NOT NULL))
  AND ((state = 'IN_FLIGHT' AND "leaseId" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL)
    OR (state = 'UNKNOWN' AND "leaseId" IS NOT NULL AND "leaseExpiresAt" IS NULL)
    OR (state NOT IN ('IN_FLIGHT','UNKNOWN') AND "leaseId" IS NULL AND "leaseExpiresAt" IS NULL))
  AND jsonb_typeof(data) = 'object'
  AND data - ARRAY['referenceId','revision','totalVnd','eventDate']::text[] = '{}'::jsonb
);
CREATE TABLE "NotificationPushDelivery" (
  "intentId" UUID NOT NULL REFERENCES "NotificationIntent"(id) ON DELETE RESTRICT,
  "installationId" UUID NOT NULL,
  "installationRevision" INTEGER NOT NULL CHECK ("installationRevision" > 0),
  state TEXT NOT NULL DEFAULT 'QUEUED' CHECK (state IN ('QUEUED','IN_FLIGHT','ACCEPTED','UNKNOWN','RETRYABLE_FAILED','DEAD_LETTER','CANCELLED')),
  "leaseId" UUID,
  "providerMessageId" VARCHAR(320),
  "errorCode" VARCHAR(80) CHECK ("errorCode" IS NULL OR "errorCode" ~ '^[A-Z][A-Z0-9_]{0,79}$'),
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("intentId", "installationId"),
  CHECK (state <> 'ACCEPTED' OR "providerMessageId" IS NOT NULL)
);
ALTER TABLE "NotificationPushDelivery" ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION notification_push_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM "NotificationIntent" WHERE id=NEW."intentId" AND channel='ANDROID' AND "pushTargetsFrozenAt" IS NULL) THEN
      RAISE EXCEPTION 'notification push targets must belong to an unfrozen Android intent';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'notification push history is retained'; END IF;
  IF ROW(OLD."intentId", OLD."installationId", OLD."installationRevision") IS DISTINCT FROM
     ROW(NEW."intentId", NEW."installationId", NEW."installationRevision") OR
     (OLD.state IN ('ACCEPTED','UNKNOWN') AND OLD IS DISTINCT FROM NEW) THEN
    RAISE EXCEPTION 'notification push source/acceptance evidence is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notification_push_evidence_guard BEFORE INSERT OR UPDATE OR DELETE ON "NotificationPushDelivery"
  FOR EACH ROW EXECUTE FUNCTION notification_push_evidence_guard();
CREATE FUNCTION notification_push_target_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."pushTargetsFrozenAt" IS NOT NULL AND OLD."pushTargetsFrozenAt" IS DISTINCT FROM NEW."pushTargetsFrozenAt" THEN
    RAISE EXCEPTION 'notification push target snapshot is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notification_push_target_guard BEFORE UPDATE ON "NotificationIntent"
  FOR EACH ROW EXECUTE FUNCTION notification_push_target_guard();
