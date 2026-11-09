CREATE TABLE "StaffInvitation" (
  "id" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "issuedByAccountId" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "status" "WorkspaceInvitationStatus" NOT NULL DEFAULT 'ACTIVE',
  "deliveryStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "acceptedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StaffInvitation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StaffInvitation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StaffInvitation_issuedByAccountId_fkey" FOREIGN KEY ("issuedByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StaffInvitation_deliveryStatus_check" CHECK ("deliveryStatus" IN ('UNKNOWN', 'ACCEPTED', 'FAILED'))
);
CREATE UNIQUE INDEX "StaffInvitation_tokenHash_key" ON "StaffInvitation"("tokenHash");
CREATE UNIQUE INDEX "StaffInvitation_active_account_key" ON "StaffInvitation"("accountId") WHERE "status" = 'ACTIVE';
CREATE INDEX "StaffInvitation_accountId_createdAt_idx" ON "StaffInvitation"("accountId", "createdAt" DESC);
