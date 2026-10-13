CREATE TABLE "NotificationDueCommand" (
 "id" UUID PRIMARY KEY, "bookingId" UUID NOT NULL REFERENCES "Booking"("id") ON DELETE RESTRICT,
 "expectedRevision" INTEGER NOT NULL CHECK ("expectedRevision">0), "dueAt" TIMESTAMPTZ NOT NULL,
 "requestedAt" TIMESTAMPTZ NOT NULL, "outcome" TEXT NOT NULL DEFAULT 'RETRY_PENDING', "lastErrorCode" TEXT
);
CREATE TABLE "IdentityNotificationOutbox" (
 "eventId" UUID PRIMARY KEY, "bookingId" UUID NOT NULL REFERENCES "Booking"("id") ON DELETE RESTRICT,
 "eventType" TEXT NOT NULL, "payload" JSONB NOT NULL, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE FUNCTION notification_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'notification evidence is append-only'; END $$;
CREATE TRIGGER "NotificationAttempt_immutable" BEFORE UPDATE OR DELETE ON "NotificationAttempt" FOR EACH ROW EXECUTE FUNCTION notification_append_only();
CREATE TRIGGER "NotificationReceipt_immutable" BEFORE UPDATE OR DELETE ON "NotificationReceipt" FOR EACH ROW EXECUTE FUNCTION notification_append_only();
CREATE TRIGGER "IdentityNotificationOutbox_immutable" BEFORE UPDATE OR DELETE ON "IdentityNotificationOutbox" FOR EACH ROW EXECUTE FUNCTION notification_append_only();
