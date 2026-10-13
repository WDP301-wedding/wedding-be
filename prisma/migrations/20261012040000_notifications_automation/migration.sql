CREATE TABLE "NotificationIntent" (
 "id" UUID PRIMARY KEY, "eventId" UUID NOT NULL, "bookingId" UUID NOT NULL REFERENCES "Booking"("id") ON DELETE RESTRICT,
 "purpose" VARCHAR(100) NOT NULL, "recipientId" UUID NOT NULL, "accountId" UUID REFERENCES "Account"("id") ON DELETE RESTRICT,
 "channel" TEXT NOT NULL CHECK ("channel" IN ('EMAIL','PUSH')), "templateVersion" TEXT NOT NULL,
 "scheduleRevision" INTEGER, "scheduledAt" TIMESTAMPTZ NOT NULL,
 "state" TEXT NOT NULL DEFAULT 'QUEUED' CHECK ("state" IN ('QUEUED','IN_FLIGHT','DELIVERED','RETRYABLE_FAILED','UNKNOWN','DEAD_LETTER','SKIPPED_STALE','CANCELLED')),
 "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision">0), "attemptCount" INTEGER NOT NULL DEFAULT 0 CHECK ("attemptCount" BETWEEN 0 AND 6),
 "leaseToken" UUID, "leaseUntil" TIMESTAMPTZ, "nextAttemptAt" TIMESTAMPTZ NOT NULL,
 "providerMessageId" TEXT, "credentialId" UUID REFERENCES "GuestInvitationCredential"("id") ON DELETE RESTRICT,
 "ciphertext" TEXT, "secretExpiresAt" TIMESTAMPTZ, "readAt" TIMESTAMPTZ, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("eventId","channel","recipientId","templateVersion"),
 CHECK (("leaseToken" IS NULL)=("leaseUntil" IS NULL)),
 CHECK ("ciphertext" IS NULL OR ("credentialId" IS NOT NULL AND "secretExpiresAt" IS NOT NULL))
);
CREATE INDEX "NotificationIntent_due" ON "NotificationIntent"("state","nextAttemptAt");
CREATE INDEX "NotificationIntent_inbox" ON "NotificationIntent"("accountId","id");
CREATE TABLE "NotificationAttempt" (
 "id" UUID PRIMARY KEY, "intentId" UUID NOT NULL REFERENCES "NotificationIntent"("id") ON DELETE RESTRICT,
 "attemptNumber" INTEGER NOT NULL CHECK ("attemptNumber" BETWEEN 1 AND 6), "outcome" TEXT NOT NULL,
 "providerMessageId" TEXT, "errorCode" TEXT, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("intentId","attemptNumber","outcome")
);
CREATE TABLE "NotificationPreference" (
 "accountId" UUID PRIMARY KEY REFERENCES "Account"("id") ON DELETE RESTRICT,
 "reminderEmail" BOOLEAN NOT NULL DEFAULT true, "reminderPush" BOOLEAN NOT NULL DEFAULT true, "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision">0)
);
CREATE TABLE "NotificationInstallation" (
 "id" UUID PRIMARY KEY, "accountId" UUID NOT NULL REFERENCES "Account"("id") ON DELETE RESTRICT,
 "sessionId" UUID NOT NULL REFERENCES "Session"("id") ON DELETE RESTRICT, "tokenDigest" CHAR(64) NOT NULL UNIQUE,
 "ciphertext" TEXT, "active" BOOLEAN NOT NULL DEFAULT true, "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision">0),
 CHECK (NOT "active" OR "ciphertext" IS NOT NULL)
);
CREATE INDEX "NotificationInstallation_account" ON "NotificationInstallation"("accountId","active");
CREATE TABLE "NotificationRecipient" (
 "bookingId" UUID NOT NULL REFERENCES "Booking"("id") ON DELETE RESTRICT,
 "accountId" UUID NOT NULL REFERENCES "Account"("id") ON DELETE RESTRICT,
 "purpose" TEXT NOT NULL CHECK ("purpose" IN ('OPERATIONS','FINANCE','PRINT')),
 "enabled" BOOLEAN NOT NULL DEFAULT true, "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision">0), PRIMARY KEY ("bookingId","accountId","purpose")
);
CREATE TABLE "NotificationReceipt" (
 "eventId" UUID PRIMARY KEY, "producer" TEXT NOT NULL, "bookingId" UUID NOT NULL REFERENCES "Booking"("id") ON DELETE RESTRICT,
 "eventType" TEXT NOT NULL, "sourceSequence" INTEGER NOT NULL, "outcome" TEXT NOT NULL, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "NotificationCheckpoint" (
 "producer" TEXT NOT NULL, "bookingId" UUID NOT NULL REFERENCES "Booking"("id") ON DELETE RESTRICT,
 "stream" TEXT NOT NULL, "sourceSequence" INTEGER NOT NULL, PRIMARY KEY ("producer","bookingId","stream")
);
CREATE TABLE "NotificationCommand" (
 "accountId" UUID NOT NULL REFERENCES "Account"("id") ON DELETE RESTRICT, "key" UUID NOT NULL,
 "commandDigest" CHAR(64) NOT NULL, "result" JSONB NOT NULL, PRIMARY KEY ("accountId","key")
);
