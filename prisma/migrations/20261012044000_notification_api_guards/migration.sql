ALTER TABLE "NotificationInstallation" ALTER COLUMN "pushToken" DROP NOT NULL;
ALTER TABLE "NotificationInstallation" ADD CONSTRAINT notification_active_token CHECK (NOT enabled OR "pushToken" IS NOT NULL);
ALTER TABLE "NotificationRecipient" ADD COLUMN "nextRetentionAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "NotificationRecipient" DROP CONSTRAINT "NotificationRecipient_scope_check";
ALTER TABLE "NotificationRecipient" ADD CONSTRAINT "NotificationRecipient_scope_check" CHECK (
  revision > 0 AND (("accountId" IS NOT NULL AND "guestId" IS NULL)
    OR ("accountId" IS NULL AND "guestId" IS NOT NULL AND "bookingId" IS NOT NULL AND ("deliveryEmail" IS NOT NULL OR NOT enabled)))
);
CREATE FUNCTION notification_command_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Notification command receipts are immutable'; END $$;
CREATE TRIGGER notification_command_immutable BEFORE UPDATE ON "NotificationCommand"
FOR EACH ROW EXECUTE FUNCTION notification_command_guard();
CREATE FUNCTION notification_inbox_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id,NEW."intentId",NEW."accountId",NEW."bookingId",NEW."createdAt") IS DISTINCT FROM
    ROW(OLD.id,OLD."intentId",OLD."accountId",OLD."bookingId",OLD."createdAt") OR
    NEW.revision <> OLD.revision+1 OR OLD."readAt" IS NOT NULL OR NEW."readAt" IS NULL THEN
    RAISE EXCEPTION 'Notification inbox source/read revision is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notification_inbox_source_guard BEFORE UPDATE ON "NotificationInbox"
FOR EACH ROW EXECUTE FUNCTION notification_inbox_guard();
