BEGIN;

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "AccountRoleType" AS ENUM ('MANAGER', 'STAFF', 'COUPLE');

-- CreateEnum
CREATE TYPE "ConsultationAccessLevel" AS ENUM ('RESTRICTED', 'FULL');

-- CreateEnum
CREATE TYPE "WorkspaceInvitationStatus" AS ENUM ('ACTIVE', 'ACCEPTED', 'REVOKED', 'SUPERSEDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SessionClientKind" AS ENUM ('WEB', 'ANDROID');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED', 'COMPROMISED');

-- CreateEnum
CREATE TYPE "CredentialStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'REVOKED', 'EXPIRED');

-- CreateTable
CREATE TABLE "Account" (
    "id" UUID NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "displayEmail" TEXT NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "disabledAt" TIMESTAMPTZ(6),
    "piiRetentionEligibleAt" TIMESTAMPTZ(6),
    "piiAnonymizedAt" TIMESTAMPTZ(6),
    "legalHoldUntil" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Account_email_normalized_check" CHECK (
      "emailNormalized" = lower(btrim("emailNormalized"))
      AND char_length("emailNormalized") BETWEEN 3 AND 320
      AND position('@' IN "emailNormalized") > 1
    ),
    CONSTRAINT "Account_status_disabled_at_check" CHECK (
      ("status" = 'DISABLED') = ("disabledAt" IS NOT NULL)
    )
);

-- CreateTable
CREATE TABLE "PasswordCredential" (
    "accountId" UUID NOT NULL,
    "algorithm" TEXT NOT NULL,
    "version" SMALLINT NOT NULL,
    "cost" INTEGER NOT NULL,
    "blockSize" INTEGER NOT NULL,
    "parallelization" INTEGER NOT NULL,
    "keyLengthBytes" SMALLINT NOT NULL,
    "maxMemoryBytes" INTEGER NOT NULL,
    "saltEncoded" TEXT NOT NULL,
    "derivedKeyEncoded" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PasswordCredential_pkey" PRIMARY KEY ("accountId"),
    CONSTRAINT "PasswordCredential_scrypt_metadata_check" CHECK (
      "algorithm" = 'scrypt'
      AND "version" = 1
      AND "cost" >= 2
      AND ("cost" & ("cost" - 1)) = 0
      AND "blockSize" > 0
      AND "parallelization" > 0
      AND "keyLengthBytes" BETWEEN 16 AND 128
      AND "maxMemoryBytes" > (
        128::bigint * "cost" * "blockSize"
        + 1024::bigint * "blockSize" * "parallelization"
      )
    ),
    CONSTRAINT "PasswordCredential_encoding_check" CHECK (
      "saltEncoded" ~ '^[A-Za-z0-9_-]+$'
      AND "derivedKeyEncoded" ~ '^[A-Za-z0-9_-]+$'
    )
);

-- CreateTable
CREATE TABLE "AccountRole" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "role" "AccountRoleType" NOT NULL,
    "grantedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultationAccess" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "consultationId" UUID NOT NULL,
    "bookingId" UUID,
    "level" "ConsultationAccessLevel" NOT NULL DEFAULT 'RESTRICTED',
    "promotedAt" TIMESTAMPTZ(6),
    "sourcePaymentId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ConsultationAccess_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ConsultationAccess_promotion_check" CHECK (
      ("level" = 'RESTRICTED' AND "promotedAt" IS NULL AND "sourcePaymentId" IS NULL)
      OR ("level" = 'FULL' AND "promotedAt" IS NOT NULL AND "sourcePaymentId" IS NOT NULL)
    )
);

-- CreateTable
CREATE TABLE "WorkspaceInvitation" (
    "id" UUID NOT NULL,
    "consultationId" UUID NOT NULL,
    "recipientEmailNormalized" TEXT NOT NULL,
    "resolvedAccountId" UUID,
    "issuedByAccountId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "WorkspaceInvitationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "supersededAt" TIMESTAMPTZ(6),
    "expiredAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "WorkspaceInvitation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WorkspaceInvitation_email_normalized_check" CHECK (
      "recipientEmailNormalized" = lower(btrim("recipientEmailNormalized"))
      AND char_length("recipientEmailNormalized") BETWEEN 3 AND 320
      AND position('@' IN "recipientEmailNormalized") > 1
    ),
    CONSTRAINT "WorkspaceInvitation_sequence_check" CHECK ("sequence" > 0),
    CONSTRAINT "WorkspaceInvitation_expiry_check" CHECK ("expiresAt" > "createdAt"),
    CONSTRAINT "WorkspaceInvitation_token_hash_check" CHECK (
      "tokenHash" ~ '^[A-Za-z0-9_-]{43}$'
    )
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "clientKind" "SessionClientKind" NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "refreshFamilyId" UUID NOT NULL,
    "idleExpiresAt" TIMESTAMPTZ(6) NOT NULL,
    "absoluteExpiresAt" TIMESTAMPTZ(6) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(6),
    "revocationReason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Session_expiry_check" CHECK (
      "idleExpiresAt" <= "absoluteExpiresAt" AND "absoluteExpiresAt" > "createdAt"
    )
);

-- CreateTable
CREATE TABLE "AccessCredential" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "CredentialStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessCredential_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AccessCredential_token_hash_check" CHECK ("tokenHash" ~ '^[A-Za-z0-9_-]{43}$'),
    CONSTRAINT "AccessCredential_expiry_check" CHECK ("expiresAt" > "createdAt")
);

-- CreateTable
CREATE TABLE "RefreshCredential" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "predecessorId" UUID,
    "tokenHash" TEXT NOT NULL,
    "status" "CredentialStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "consumedAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshCredential_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RefreshCredential_not_self_successor_check" CHECK ("predecessorId" IS NULL OR "predecessorId" <> "id"),
    CONSTRAINT "RefreshCredential_token_hash_check" CHECK ("tokenHash" ~ '^[A-Za-z0-9_-]{43}$'),
    CONSTRAINT "RefreshCredential_expiry_check" CHECK ("expiresAt" > "createdAt")
);

-- CreateTable
CREATE TABLE "PasswordResetCredential" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "CredentialStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "consumedAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "expiredAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetCredential_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PasswordResetCredential_token_hash_check" CHECK ("tokenHash" ~ '^[A-Za-z0-9_-]{43}$'),
    CONSTRAINT "PasswordResetCredential_expiry_check" CHECK ("expiresAt" > "createdAt")
);

-- CreateTable
CREATE TABLE "AccountRetentionEligibilityFact" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "consultationId" UUID NOT NULL,
    "sourceBusinessRecordId" UUID NOT NULL,
    "eligibleAfter" TIMESTAMPTZ(6) NOT NULL,
    "recordedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountRetentionEligibilityFact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_emailNormalized_key" ON "Account"("emailNormalized");
CREATE INDEX "Account_status_idx" ON "Account"("status");
CREATE INDEX "Account_piiRetentionEligibleAt_idx" ON "Account"("piiRetentionEligibleAt");
CREATE INDEX "AccountRole_role_idx" ON "AccountRole"("role");
CREATE UNIQUE INDEX "AccountRole_accountId_role_key" ON "AccountRole"("accountId", "role");
CREATE UNIQUE INDEX "ConsultationAccess_bookingId_key" ON "ConsultationAccess"("bookingId");
CREATE UNIQUE INDEX "ConsultationAccess_sourcePaymentId_key" ON "ConsultationAccess"("sourcePaymentId");
CREATE INDEX "ConsultationAccess_consultationId_level_idx" ON "ConsultationAccess"("consultationId", "level");
CREATE UNIQUE INDEX "ConsultationAccess_accountId_consultationId_key" ON "ConsultationAccess"("accountId", "consultationId");
CREATE UNIQUE INDEX "WorkspaceInvitation_tokenHash_key" ON "WorkspaceInvitation"("tokenHash");
CREATE INDEX "WorkspaceInvitation_recipientEmailNormalized_createdAt_idx" ON "WorkspaceInvitation"("recipientEmailNormalized", "createdAt" DESC);
CREATE INDEX "WorkspaceInvitation_status_expiresAt_idx" ON "WorkspaceInvitation"("status", "expiresAt");
CREATE UNIQUE INDEX "WorkspaceInvitation_consultationId_recipientEmailNormalized_key" ON "WorkspaceInvitation"("consultationId", "recipientEmailNormalized", "sequence");
CREATE UNIQUE INDEX "WorkspaceInvitation_active_consultation_email_key" ON "WorkspaceInvitation"("consultationId", "recipientEmailNormalized") WHERE ("status" = 'ACTIVE');
CREATE UNIQUE INDEX "Session_refreshFamilyId_key" ON "Session"("refreshFamilyId");
CREATE INDEX "Session_accountId_status_idx" ON "Session"("accountId", "status");
CREATE INDEX "Session_status_idleExpiresAt_idx" ON "Session"("status", "idleExpiresAt");
CREATE INDEX "Session_status_absoluteExpiresAt_idx" ON "Session"("status", "absoluteExpiresAt");
CREATE UNIQUE INDEX "AccessCredential_tokenHash_key" ON "AccessCredential"("tokenHash");
CREATE INDEX "AccessCredential_sessionId_status_idx" ON "AccessCredential"("sessionId", "status");
CREATE INDEX "AccessCredential_status_expiresAt_idx" ON "AccessCredential"("status", "expiresAt");
CREATE UNIQUE INDEX "RefreshCredential_predecessorId_key" ON "RefreshCredential"("predecessorId");
CREATE UNIQUE INDEX "RefreshCredential_tokenHash_key" ON "RefreshCredential"("tokenHash");
CREATE INDEX "RefreshCredential_sessionId_status_idx" ON "RefreshCredential"("sessionId", "status");
CREATE INDEX "RefreshCredential_status_expiresAt_idx" ON "RefreshCredential"("status", "expiresAt");
CREATE UNIQUE INDEX "PasswordResetCredential_tokenHash_key" ON "PasswordResetCredential"("tokenHash");
CREATE INDEX "PasswordResetCredential_accountId_status_idx" ON "PasswordResetCredential"("accountId", "status");
CREATE INDEX "PasswordResetCredential_status_expiresAt_idx" ON "PasswordResetCredential"("status", "expiresAt");
CREATE UNIQUE INDEX "AccountRetentionEligibilityFact_sourceBusinessRecordId_key" ON "AccountRetentionEligibilityFact"("sourceBusinessRecordId");
CREATE INDEX "AccountRetentionEligibilityFact_accountId_eligibleAfter_idx" ON "AccountRetentionEligibilityFact"("accountId", "eligibleAfter");
CREATE UNIQUE INDEX "AccountRetentionEligibilityFact_accountId_consultationId_key" ON "AccountRetentionEligibilityFact"("accountId", "consultationId");

-- AddForeignKey
ALTER TABLE "PasswordCredential" ADD CONSTRAINT "PasswordCredential_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountRole" ADD CONSTRAINT "AccountRole_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsultationAccess" ADD CONSTRAINT "ConsultationAccess_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceInvitation" ADD CONSTRAINT "WorkspaceInvitation_resolvedAccountId_fkey" FOREIGN KEY ("resolvedAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkspaceInvitation" ADD CONSTRAINT "WorkspaceInvitation_issuedByAccountId_fkey" FOREIGN KEY ("issuedByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccessCredential" ADD CONSTRAINT "AccessCredential_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RefreshCredential" ADD CONSTRAINT "RefreshCredential_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RefreshCredential" ADD CONSTRAINT "RefreshCredential_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES "RefreshCredential"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PasswordResetCredential" ADD CONSTRAINT "PasswordResetCredential_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountRetentionEligibilityFact" ADD CONSTRAINT "AccountRetentionEligibilityFact_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
