BEGIN;

CREATE TYPE "BookingPhase" AS ENUM (
  'DRAFT',
  'AWAITING_DEPOSIT',
  'CONFIRMED',
  'CANCELLED',
  'COMPLETED'
);

CREATE TYPE "BookingInvitationIntentStatus" AS ENUM ('PENDING', 'ISSUED');

CREATE TABLE "Consultation" (
  "id" UUID NOT NULL,
  "managerAccountId" UUID NOT NULL,
  "intendedEmailNormalized" TEXT NOT NULL,
  "intendedEmail" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "note" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "Consultation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Consultation_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "Consultation_email_check" CHECK (
    char_length("intendedEmail") BETWEEN 3 AND 320
    AND "intendedEmailNormalized" = lower(btrim("intendedEmail"))
  ),
  CONSTRAINT "Consultation_display_check" CHECK (
    char_length(btrim("displayName")) BETWEEN 1 AND 120
    AND ("note" IS NULL OR char_length(btrim("note")) BETWEEN 0 AND 2000)
  )
);

CREATE TABLE "Booking" (
  "id" UUID NOT NULL,
  "consultationId" UUID NOT NULL,
  "hallId" UUID NOT NULL,
  "eventDate" DATE NOT NULL,
  "shiftCode" "RestaurantShiftCode" NOT NULL,
  "phase" "BookingPhase" NOT NULL DEFAULT 'DRAFT',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "planningHeadcount" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "Booking_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Booking_revision_headcount_check" CHECK (
    "revision" > 0 AND "planningHeadcount" BETWEEN 0 AND 10000
  )
);

CREATE TABLE "BookingProposalSnapshot" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "bookingId" UUID NOT NULL,
  "hallId" UUID NOT NULL,
  "hallName" TEXT NOT NULL,
  "hallDescription" TEXT NOT NULL,
  "hallMaxGuests" INTEGER NOT NULL,
  "shiftCode" "RestaurantShiftCode" NOT NULL,
  "shiftStartTime" TIME(0) NOT NULL,
  "shiftEndTime" TIME(0) NOT NULL,
  "menuPackageId" UUID NOT NULL,
  "menuPackageVersionId" UUID NOT NULL,
  "menuVersionNumber" INTEGER NOT NULL,
  "menuName" TEXT NOT NULL,
  "menuDescription" TEXT NOT NULL,
  "menuPriceVndPerTable" DECIMAL(18,0) NOT NULL,
  "tableCount" INTEGER NOT NULL,
  "planningHeadcount" INTEGER NOT NULL,
  "baseChargeVnd" DECIMAL(18,0) NOT NULL,
  "depositAmountVnd" DECIMAL(18,0) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BookingProposalSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BookingProposalSnapshot_bounds_check" CHECK (
    "hallMaxGuests" BETWEEN 1 AND 10000
    AND "menuVersionNumber" > 0
    AND "tableCount" BETWEEN 1 AND 500
    AND "planningHeadcount" BETWEEN 0 AND 10000
    AND "menuPriceVndPerTable" >= 0
    AND "baseChargeVnd" = "menuPriceVndPerTable" * "tableCount"
    AND "depositAmountVnd" = ceil("baseChargeVnd" * 0.30)
  ),
  CONSTRAINT "BookingProposalSnapshot_shift_check" CHECK ("shiftStartTime" < "shiftEndTime")
);

CREATE TABLE "BookingInvitationIntent" (
  "id" UUID NOT NULL,
  "consultationId" UUID NOT NULL,
  "intendedEmail" TEXT NOT NULL,
  "managerAccountId" UUID NOT NULL,
  "requestId" UUID NOT NULL,
  "status" "BookingInvitationIntentStatus" NOT NULL DEFAULT 'PENDING',
  "invitationId" UUID,
  "failureCount" INTEGER NOT NULL DEFAULT 0,
  "issuedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "BookingInvitationIntent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BookingInvitationIntent_state_check" CHECK (
    "failureCount" >= 0
    AND (("status" = 'PENDING' AND "invitationId" IS NULL AND "issuedAt" IS NULL)
      OR ("status" = 'ISSUED' AND "invitationId" IS NOT NULL AND "issuedAt" IS NOT NULL))
  )
);

CREATE UNIQUE INDEX "Booking_consultationId_key" ON "Booking"("consultationId");
CREATE INDEX "Booking_hallId_eventDate_shiftCode_idx" ON "Booking"("hallId", "eventDate", "shiftCode");
CREATE INDEX "Booking_phase_eventDate_idx" ON "Booking"("phase", "eventDate");
CREATE UNIQUE INDEX "BookingProposalSnapshot_bookingId_key" ON "BookingProposalSnapshot"("bookingId");
CREATE INDEX "BookingProposalSnapshot_hallId_shiftCode_idx" ON "BookingProposalSnapshot"("hallId", "shiftCode");
CREATE INDEX "BookingProposalSnapshot_menuPackageVersionId_idx" ON "BookingProposalSnapshot"("menuPackageVersionId");
CREATE UNIQUE INDEX "BookingInvitationIntent_consultationId_key" ON "BookingInvitationIntent"("consultationId");
CREATE UNIQUE INDEX "BookingInvitationIntent_invitationId_key" ON "BookingInvitationIntent"("invitationId");
CREATE INDEX "BookingInvitationIntent_status_createdAt_idx" ON "BookingInvitationIntent"("status", "createdAt");
CREATE INDEX "Consultation_managerAccountId_createdAt_idx" ON "Consultation"("managerAccountId", "createdAt" DESC);
CREATE INDEX "Consultation_intendedEmailNormalized_idx" ON "Consultation"("intendedEmailNormalized");

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_consultationId_fkey"
  FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BookingProposalSnapshot" ADD CONSTRAINT "BookingProposalSnapshot_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BookingProposalSnapshot" ADD CONSTRAINT "BookingProposalSnapshot_hallId_fkey"
  FOREIGN KEY ("hallId") REFERENCES "Hall"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BookingProposalSnapshot" ADD CONSTRAINT "BookingProposalSnapshot_menuPackageVersionId_fkey"
  FOREIGN KEY ("menuPackageVersionId") REFERENCES "MenuPackageVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BookingInvitationIntent" ADD CONSTRAINT "BookingInvitationIntent_consultationId_fkey"
  FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION reject_booking_proposal_snapshot_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'booking proposal snapshots are immutable' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BookingProposalSnapshot_immutable_trigger"
BEFORE UPDATE OR DELETE ON "BookingProposalSnapshot"
FOR EACH ROW EXECUTE FUNCTION reject_booking_proposal_snapshot_mutation();

COMMIT;
