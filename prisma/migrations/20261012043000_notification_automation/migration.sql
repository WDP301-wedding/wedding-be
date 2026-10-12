ALTER TABLE "NotificationIntent" ADD COLUMN "nextReconcileAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "NotificationIntent_state_nextReconcileAt_idx" ON "NotificationIntent"(state,"nextReconcileAt");
CREATE TABLE "NotificationScheduleScan" (
  kind TEXT PRIMARY KEY CHECK (kind IN ('D3_REMINDER','COMPLETION','MEDIA_CUTOFF')),
  "dueBefore" TIMESTAMPTZ(6) NOT NULL,
  cursor VARCHAR(1024),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
);
CREATE TABLE "NotificationDueCommand" (
  id UUID PRIMARY KEY,
  "bookingId" UUID NOT NULL REFERENCES "Booking"(id) ON DELETE RESTRICT,
  "expectedRevision" INTEGER NOT NULL CHECK ("expectedRevision" > 0),
  "requestedAt" TIMESTAMPTZ(6) NOT NULL,
  state TEXT NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','DONE','CONFLICT'))
);
CREATE UNIQUE INDEX "NotificationDueCommand_bookingId_expectedRevision_key" ON "NotificationDueCommand"("bookingId", "expectedRevision");
CREATE INDEX "NotificationDueCommand_state_requestedAt_idx" ON "NotificationDueCommand"(state,"requestedAt");
CREATE FUNCTION notification_due_command_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR ROW(NEW.id,NEW."bookingId",NEW."expectedRevision",NEW."requestedAt") IS DISTINCT FROM
    ROW(OLD.id,OLD."bookingId",OLD."expectedRevision",OLD."requestedAt") OR OLD.state <> 'PENDING'
    OR NEW.state NOT IN ('DONE','CONFLICT') THEN
    RAISE EXCEPTION 'Notification due command identity is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notification_due_command_immutable BEFORE UPDATE OR DELETE ON "NotificationDueCommand"
FOR EACH ROW EXECUTE FUNCTION notification_due_command_guard();
ALTER TABLE "NotificationScheduleScan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationDueCommand" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "NotificationScheduleScan","NotificationDueCommand" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "NotificationScheduleScan","NotificationDueCommand" FROM authenticated; END IF;
END $$;
