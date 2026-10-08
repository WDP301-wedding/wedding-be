-- Credential retries rotate a hash and its delivery intent together; raw tokens are never stored.
ALTER TABLE "WorkspaceInvitation"
ADD COLUMN "deliveryIntentId" UUID NOT NULL DEFAULT gen_random_uuid();
