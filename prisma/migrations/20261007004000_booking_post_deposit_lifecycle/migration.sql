BEGIN;

CREATE TYPE "BookingCancellationRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "Booking"
  ADD COLUMN "cancelledAt" TIMESTAMPTZ(6),
  ADD COLUMN "completedAt" TIMESTAMPTZ(6);

CREATE TABLE "BookingCancellationRequest" (
  "id" UUID NOT NULL,
  "bookingId" UUID NOT NULL,
  "status" "BookingCancellationRequestStatus" NOT NULL DEFAULT 'PENDING',
  "reason" TEXT NOT NULL,
  "requestedByAccountId" UUID NOT NULL,
  "requestedAt" TIMESTAMPTZ(6) NOT NULL,
  "decidedByAccountId" UUID,
  "decisionReason" TEXT,
  "decidedAt" TIMESTAMPTZ(6),
  CONSTRAINT "BookingCancellationRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BookingCancellationRequest_reason_check" CHECK (
    char_length(btrim("reason")) BETWEEN 1 AND 500
    AND ("decisionReason" IS NULL OR char_length(btrim("decisionReason")) BETWEEN 1 AND 500)
  ),
  CONSTRAINT "BookingCancellationRequest_state_check" CHECK (
    ("status" = 'PENDING' AND "decidedByAccountId" IS NULL AND "decidedAt" IS NULL)
    OR ("status" <> 'PENDING' AND "decidedByAccountId" IS NOT NULL AND "decidedAt" IS NOT NULL)
  )
);

CREATE TABLE "BookingHeadcountEvidence" (
  "bookingId" UUID NOT NULL,
  "sourceRsvpRevisionId" UUID NOT NULL,
  "sourceSequence" INTEGER NOT NULL,
  "expectedAttendees" INTEGER NOT NULL,
  "appliedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "BookingHeadcountEvidence_pkey" PRIMARY KEY ("bookingId"),
  CONSTRAINT "BookingHeadcountEvidence_sourceRsvpRevisionId_key" UNIQUE ("sourceRsvpRevisionId"),
  CONSTRAINT "BookingHeadcountEvidence_values_check" CHECK (
    "sourceSequence" >= 0 AND "expectedAttendees" BETWEEN 0 AND 10000
  )
);

CREATE UNIQUE INDEX "BookingCancellationRequest_one_pending_key"
  ON "BookingCancellationRequest"("bookingId") WHERE "status" = 'PENDING';
CREATE INDEX "BookingCancellationRequest_status_requestedAt_idx"
  ON "BookingCancellationRequest"("status", "requestedAt");
CREATE INDEX "BookingHeadcountEvidence_sourceSequence_idx"
  ON "BookingHeadcountEvidence"("sourceSequence");

ALTER TABLE "BookingCancellationRequest" ADD CONSTRAINT "BookingCancellationRequest_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BookingHeadcountEvidence" ADD CONSTRAINT "BookingHeadcountEvidence_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
