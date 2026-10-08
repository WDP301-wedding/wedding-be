ALTER TABLE "Account" ADD COLUMN "displayName" TEXT, ADD COLUMN "profileRevision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Account" ADD CONSTRAINT "Account_profile_revision_positive" CHECK ("profileRevision" > 0);
CREATE TABLE "ConsultationRequest" (
  "id" UUID PRIMARY KEY,
  "submissionId" UUID NOT NULL UNIQUE,
  "payloadHash" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "preferredDate" DATE,
  "expectedGuests" INTEGER,
  "message" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'NEW' CHECK ("status" IN ('NEW', 'CONVERTED', 'CLOSED')),
  "consultationId" UUID UNIQUE REFERENCES "Consultation"("id") ON DELETE RESTRICT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "ConsultationRequest_expected_guests" CHECK ("expectedGuests" IS NULL OR "expectedGuests" BETWEEN 1 AND 10000),
  CONSTRAINT "ConsultationRequest_conversion" CHECK (("status" = 'CONVERTED') = ("consultationId" IS NOT NULL))
);
CREATE INDEX "ConsultationRequest_status_created" ON "ConsultationRequest"("status", "createdAt", "id");
