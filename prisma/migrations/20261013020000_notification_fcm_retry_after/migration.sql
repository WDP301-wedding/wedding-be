-- Persist provider backoff separately from the worker's bounded retry schedule.
ALTER TABLE "NotificationPushDelivery" ADD COLUMN "retryNotBefore" TIMESTAMPTZ(6);
