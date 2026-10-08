BEGIN;

ALTER TABLE "BookingProposalSnapshot"
  ADD COLUMN "commercialRevisionId" UUID,
  ADD COLUMN "commercialAcceptedAt" TIMESTAMPTZ(6);

-- The proposal stays immutable; only its first acceptance can be attached.
CREATE OR REPLACE FUNCTION reject_booking_proposal_snapshot_mutation() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."commercialRevisionId" IS NULL
    AND OLD."commercialAcceptedAt" IS NULL
    AND NEW."commercialRevisionId" IS NOT NULL AND NEW."commercialAcceptedAt" IS NOT NULL
    AND (to_jsonb(NEW) - 'commercialRevisionId' - 'commercialAcceptedAt') =
        (to_jsonb(OLD) - 'commercialRevisionId' - 'commercialAcceptedAt') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'booking proposal snapshots and accepted commercial evidence are immutable'
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

-- Preserve the commercial source ID already returned by the previous reader.
-- Existing dual-approved timelines provide the historical acceptance evidence.
UPDATE "BookingProposalSnapshot" p
SET "commercialRevisionId" = p."id", "commercialAcceptedAt" = accepted."acceptedAt"
FROM (
  SELECT "bookingId", MIN(GREATEST("managerApprovedAt", "coupleApprovedAt")) AS "acceptedAt"
  FROM "BookingTimelineRevision"
  WHERE "managerApprovedAt" IS NOT NULL AND "coupleApprovedAt" IS NOT NULL
  GROUP BY "bookingId"
) accepted
WHERE accepted."bookingId" = p."bookingId";

CREATE UNIQUE INDEX "BookingProposalSnapshot_commercialRevisionId_key"
  ON "BookingProposalSnapshot"("commercialRevisionId");
ALTER TABLE "BookingProposalSnapshot" ADD CONSTRAINT "BookingProposalSnapshot_commercial_acceptance_check"
  CHECK (("commercialRevisionId" IS NULL) = ("commercialAcceptedAt" IS NULL));

COMMIT;
