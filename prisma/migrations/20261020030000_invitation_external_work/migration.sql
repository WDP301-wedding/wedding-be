CREATE TABLE "InvitationExternalWork" (
  "bookingId" UUID NOT NULL,
  "intentDigest" CHAR(64) NOT NULL,
  "token" UUID NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "reservedFiles" INTEGER NOT NULL DEFAULT 0,
  "reservedBytes" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "InvitationExternalWork_pkey" PRIMARY KEY ("bookingId", "intentDigest"),
  CONSTRAINT "InvitationExternalWork_reservation_check" CHECK (
    "reservedFiles" BETWEEN 0 AND 1 AND "reservedBytes" BETWEEN 0 AND 26214400
  )
);
CREATE UNIQUE INDEX "InvitationExternalWork_token_key" ON "InvitationExternalWork"("token");
CREATE INDEX "InvitationExternalWork_bookingId_expiresAt_idx" ON "InvitationExternalWork"("bookingId", "expiresAt");
