CREATE TABLE "PasswordOtpChallenge" (
  "id" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "purpose" TEXT NOT NULL CHECK ("purpose" IN ('RESET', 'CHANGE')),
  "sessionId" UUID,
  "codeHash" TEXT NOT NULL CHECK (length("codeHash") = 64),
  "credentialFingerprint" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" BETWEEN 0 AND 5),
  "status" "CredentialStatus" NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "consumedAt" TIMESTAMPTZ(6),
  CONSTRAINT "PasswordOtpChallenge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PasswordOtpChallenge_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE,
  CONSTRAINT "PasswordOtpChallenge_purpose_session_check" CHECK (("purpose" = 'RESET' AND "sessionId" IS NULL) OR ("purpose" = 'CHANGE' AND "sessionId" IS NOT NULL))
);
CREATE INDEX "PasswordOtpChallenge_accountId_purpose_createdAt_idx" ON "PasswordOtpChallenge"("accountId", "purpose", "createdAt" DESC);
CREATE INDEX "PasswordOtpChallenge_expiresAt_idx" ON "PasswordOtpChallenge"("expiresAt");
