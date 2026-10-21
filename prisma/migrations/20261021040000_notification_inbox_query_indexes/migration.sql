-- Additive access paths for unread visibility and the bounded retention batch.
-- Keep this migration atomic; fail instead of waiting behind a long-running writer.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE INDEX "NotificationInbox_unread_account_booking_idx"
ON "NotificationInbox"("accountId", "bookingId") WHERE "readAt" IS NULL;

CREATE INDEX "NotificationInbox_createdAt_id_idx"
ON "NotificationInbox"("createdAt", "id");

COMMIT;
