-- CreateTable
CREATE TABLE "NotificationRecipient" (
    "id" UUID NOT NULL,
    "accountId" UUID,
    "guestId" UUID,
    "bookingId" UUID,
    "deliveryEmail" VARCHAR(320),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationIntent" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "owner" TEXT NOT NULL,
    "bookingId" UUID,
    "recipientId" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "scheduledAt" TIMESTAMPTZ(6) NOT NULL,
    "scheduleRevision" INTEGER,
    "data" JSONB NOT NULL,
    "payloadDigest" CHAR(64) NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'QUEUED',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(6) NOT NULL,
    "leaseId" UUID,
    "leaseExpiresAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationEventReceipt" (
    "owner" TEXT NOT NULL,
    "eventId" UUID NOT NULL,
    "payloadDigest" CHAR(64) NOT NULL,
    "intentIds" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationEventReceipt_pkey" PRIMARY KEY ("owner","eventId")
);

-- CreateTable
CREATE TABLE "NotificationAttempt" (
    "id" UUID NOT NULL,
    "intentId" UUID NOT NULL,
    "leaseId" UUID NOT NULL,
    "outcome" TEXT NOT NULL,
    "providerMessageId" VARCHAR(320),
    "errorCode" VARCHAR(80),
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "accountId" UUID NOT NULL,
    "reminderEmail" BOOLEAN NOT NULL DEFAULT true,
    "reminderPush" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("accountId")
);

-- CreateTable
CREATE TABLE "NotificationInstallation" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "installationId" UUID NOT NULL,
    "pushToken" VARCHAR(4096) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationInbox" (
    "id" UUID NOT NULL,
    "intentId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "bookingId" UUID,
    "readAt" TIMESTAMPTZ(6),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationInbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationCommand" (
    "accountId" UUID NOT NULL,
    "intentDigest" CHAR(64) NOT NULL,
    "commandDigest" CHAR(64) NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationCommand_pkey" PRIMARY KEY ("accountId","intentDigest")
);

-- CreateIndex
CREATE INDEX "NotificationRecipient_accountId_enabled_idx" ON "NotificationRecipient"("accountId", "enabled");

-- CreateIndex
CREATE INDEX "NotificationRecipient_bookingId_guestId_idx" ON "NotificationRecipient"("bookingId", "guestId");

-- CreateIndex
CREATE INDEX "NotificationIntent_state_nextAttemptAt_id_idx" ON "NotificationIntent"("state", "nextAttemptAt", "id");

-- CreateIndex
CREATE INDEX "NotificationIntent_state_leaseExpiresAt_idx" ON "NotificationIntent"("state", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationIntent_eventId_channel_recipientId_templateVers_key" ON "NotificationIntent"("eventId", "channel", "recipientId", "templateVersion");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationIntent_bookingId_purpose_scheduleRevision_sched_key" ON "NotificationIntent"("bookingId", "purpose", "scheduleRevision", "scheduledAt", "channel", "recipientId", "templateVersion");

-- CreateIndex
CREATE INDEX "NotificationAttempt_intentId_occurredAt_id_idx" ON "NotificationAttempt"("intentId", "occurredAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationAttempt_intentId_leaseId_outcome_key" ON "NotificationAttempt"("intentId", "leaseId", "outcome");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationInstallation_pushToken_key" ON "NotificationInstallation"("pushToken");

-- CreateIndex
CREATE INDEX "NotificationInstallation_accountId_enabled_idx" ON "NotificationInstallation"("accountId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationInstallation_accountId_installationId_key" ON "NotificationInstallation"("accountId", "installationId");

-- CreateIndex
CREATE INDEX "NotificationInbox_accountId_createdAt_id_idx" ON "NotificationInbox"("accountId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationInbox_intentId_accountId_key" ON "NotificationInbox"("intentId", "accountId");

-- AddForeignKey
ALTER TABLE "NotificationIntent" ADD CONSTRAINT "NotificationIntent_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "NotificationRecipient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationAttempt" ADD CONSTRAINT "NotificationAttempt_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "NotificationIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationInbox" ADD CONSTRAINT "NotificationInbox_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "NotificationIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Owner references and invariant checks supplement the generated Prisma tables.
ALTER TABLE "NotificationRecipient" ADD CONSTRAINT "NotificationRecipient_identity_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"(id) ON DELETE RESTRICT;
ALTER TABLE "NotificationRecipient" ADD CONSTRAINT "NotificationRecipient_guest_fkey"
  FOREIGN KEY ("bookingId", "guestId") REFERENCES "Guest"("bookingId", id) ON DELETE RESTRICT;
ALTER TABLE "NotificationRecipient" ADD CONSTRAINT "NotificationRecipient_scope_check" CHECK (
  revision > 0 AND (("accountId" IS NOT NULL AND "guestId" IS NULL)
    OR ("accountId" IS NULL AND "guestId" IS NOT NULL AND "bookingId" IS NOT NULL AND "deliveryEmail" IS NOT NULL))
);
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_account_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"(id) ON DELETE CASCADE;
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_revision_check" CHECK (revision > 0);
ALTER TABLE "NotificationInstallation" ADD CONSTRAINT "NotificationInstallation_account_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"(id) ON DELETE CASCADE;
ALTER TABLE "NotificationInstallation" ADD CONSTRAINT "NotificationInstallation_session_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "Session"(id) ON DELETE CASCADE;
ALTER TABLE "NotificationInstallation" ADD CONSTRAINT "NotificationInstallation_revision_check" CHECK (revision > 0);
ALTER TABLE "NotificationInbox" ADD CONSTRAINT "NotificationInbox_account_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"(id) ON DELETE CASCADE;
ALTER TABLE "NotificationInbox" ADD CONSTRAINT "NotificationInbox_revision_check" CHECK (revision > 0);
ALTER TABLE "NotificationIntent" ADD CONSTRAINT "NotificationIntent_booking_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"(id) ON DELETE RESTRICT;
ALTER TABLE "NotificationIntent" ADD CONSTRAINT "NotificationIntent_state_check" CHECK (
  state IN ('QUEUED','IN_FLIGHT','DELIVERED','RETRYABLE_FAILED','UNKNOWN','DEAD_LETTER','SKIPPED_STALE','CANCELLED')
  AND channel IN ('EMAIL','ANDROID','IN_APP') AND revision > 0 AND "templateVersion" > 0
  AND "attemptCount" BETWEEN 0 AND 6
  AND ("scheduleRevision" IS NULL OR ("scheduleRevision" > 0 AND "bookingId" IS NOT NULL))
  AND ((state = 'IN_FLIGHT' AND "leaseId" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL)
    OR (state = 'UNKNOWN' AND "leaseId" IS NOT NULL AND "leaseExpiresAt" IS NULL)
    OR (state NOT IN ('IN_FLIGHT','UNKNOWN') AND "leaseId" IS NULL AND "leaseExpiresAt" IS NULL))
  AND jsonb_typeof(data) = 'object'
  AND data - ARRAY['referenceId','revision','totalVnd','eventDate']::text[] = '{}'::jsonb
);
ALTER TABLE "NotificationAttempt" ADD CONSTRAINT "NotificationAttempt_outcome_check" CHECK (
  outcome IN ('CLAIMED','DELIVERED','RETRYABLE_FAILED','UNKNOWN','DEAD_LETTER','CANCELLED','SKIPPED_STALE')
  AND ("errorCode" IS NULL OR "errorCode" ~ '^[A-Z][A-Z0-9_]{0,79}$')
);
ALTER TABLE "NotificationEventReceipt" ADD CONSTRAINT "NotificationEventReceipt_ids_check"
  CHECK (jsonb_typeof("intentIds") = 'array');

CREATE FUNCTION notification_evidence_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Notification evidence is append-only';
END;
$$;
CREATE TRIGGER notification_attempt_immutable BEFORE UPDATE OR DELETE ON "NotificationAttempt"
  FOR EACH ROW EXECUTE FUNCTION notification_evidence_immutable();
CREATE TRIGGER notification_receipt_immutable BEFORE UPDATE OR DELETE ON "NotificationEventReceipt"
  FOR EACH ROW EXECUTE FUNCTION notification_evidence_immutable();
CREATE FUNCTION notification_intent_source_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF ROW(NEW.id,NEW."eventId",NEW.owner,NEW."bookingId",NEW."recipientId",NEW.channel,
    NEW.purpose,NEW."templateVersion",NEW."scheduledAt",NEW."scheduleRevision",NEW.data,
    NEW."payloadDigest",NEW."createdAt") IS DISTINCT FROM
    ROW(OLD.id,OLD."eventId",OLD.owner,OLD."bookingId",OLD."recipientId",OLD.channel,
    OLD.purpose,OLD."templateVersion",OLD."scheduledAt",OLD."scheduleRevision",OLD.data,
    OLD."payloadDigest",OLD."createdAt") THEN
    RAISE EXCEPTION 'Notification source is immutable';
  END IF;
  IF NEW IS DISTINCT FROM OLD AND NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'Notification revision must advance once';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER notification_intent_source_immutable BEFORE UPDATE ON "NotificationIntent"
  FOR EACH ROW EXECUTE FUNCTION notification_intent_source_immutable();
CREATE TRIGGER notification_intent_delete_guard BEFORE DELETE ON "NotificationIntent"
  FOR EACH ROW EXECUTE FUNCTION notification_evidence_immutable();

-- Private backend stores must not become Supabase Data API surfaces.
DO $$
DECLARE table_name text; api_role text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['NotificationRecipient','NotificationIntent',
    'NotificationEventReceipt','NotificationAttempt','NotificationPreference',
    'NotificationInstallation','NotificationInbox','NotificationCommand'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    FOREACH api_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
        EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', table_name, api_role);
      END IF;
    END LOOP;
  END LOOP;
END;
$$;
